import type { Job } from 'bullmq'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvolutionClient } from '@agente/evolution'
import {
  getAgentByInstanceId,
  getConversation,
  getConversationMessages,
  getOrCreateAssistantReply,
  countAgentRepliesSince,
  updateMessageStatus,
  activateConversationAgent,
  type Database,
} from '@agente/db'
import { runAgent } from '@agente/llm'
import type { MessageJob } from '@agente/queue'
import { isWithinBusinessHours, startOfBusinessDay } from './businessHours.js'

interface ProcessorDeps {
  db: SupabaseClient<Database>
  evolution: EvolutionClient
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function processMessage(job: Job<MessageJob>, { db, evolution }: ProcessorDeps): Promise<void> {
  const { instanceId, messageId, conversationId, evolutionInstanceName, contactPhone, conversationTriggered } = job.data

  const conversation = await getConversation(db, conversationId)
  if (conversation?.status === 'paused') {
    await updateMessageStatus(db, messageId, 'skipped')
    return
  }

  const agent = await getAgentByInstanceId(db, instanceId)

  if (!agent || !agent.is_active) {
    await updateMessageStatus(db, messageId, 'skipped')
    return
  }

  if (!isWithinBusinessHours(agent.business_hours)) {
    if (agent.off_hours_message) {
      await evolution.sendText(evolutionInstanceName, contactPhone, agent.off_hours_message)
    }
    await updateMessageStatus(db, messageId, 'skipped')
    return
  }

  if (agent.daily_message_limit !== null) {
    const sentToday = await countAgentRepliesSince(db, agent.id, startOfBusinessDay().toISOString())
    if (sentToday >= agent.daily_message_limit) {
      await updateMessageStatus(db, messageId, 'skipped')
      return
    }
  }

  // Trigger phrase check: skip until trigger is detected (accent-insensitive)
  if (agent.trigger_phrase && !conversationTriggered) {
    const allMessages = await getConversationMessages(db, conversationId)
    const currentMsg = allMessages.find((m) => m.id === messageId)
    const text = currentMsg?.content ?? ''
    const triggered = stripAccents(text).includes(stripAccents(agent.trigger_phrase))
    if (!triggered) {
      await updateMessageStatus(db, messageId, 'skipped')
      return
    }
    await activateConversationAgent(db, conversationId)
  }

  await updateMessageStatus(db, messageId, 'processing')

  const allMessages = await getConversationMessages(db, conversationId)
  const currentIndex = allMessages.findIndex((m) => m.id === messageId)
  const history = allMessages
    .slice(0, currentIndex)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const userMessage = allMessages[currentIndex]?.content ?? ''

  const { text } = await runAgent({ agentConfig: agent, history, userMessage })

  // reply_to_message_id has a unique index, so a retry of this job reuses the reply row (and
  // its already-sent status) from any prior attempt instead of generating and sending a new one.
  const { message: reply, isNew } = await getOrCreateAssistantReply(db, {
    conversation_id: conversationId,
    content: text,
    reply_to_message_id: messageId,
  })

  if (isNew || reply.status !== 'delivered') {
    if (agent.typing_delay_ms > 0) await sleep(agent.typing_delay_ms)
    await evolution.sendText(evolutionInstanceName, contactPhone, reply.content)
    await updateMessageStatus(db, reply.id, 'delivered')
  }

  await updateMessageStatus(db, messageId, 'delivered')
}
