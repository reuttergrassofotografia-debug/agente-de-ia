import type { Job } from 'bullmq'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvolutionClient } from '@agente/evolution'
import {
  getAgentByInstanceId,
  getConversationMessages,
  createMessage,
  updateMessageStatus,
  type Database,
} from '@agente/db'
import { runAgent } from '@agente/llm'
import type { MessageJob } from '@agente/queue'
import { isWithinBusinessHours } from './businessHours.js'

interface ProcessorDeps {
  db: SupabaseClient<Database>
  evolution: EvolutionClient
}

export async function processMessage(job: Job<MessageJob>, { db, evolution }: ProcessorDeps): Promise<void> {
  const { instanceId, messageId, conversationId, evolutionInstanceName, contactPhone } = job.data

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

  await updateMessageStatus(db, messageId, 'processing')

  const allMessages = await getConversationMessages(db, conversationId)
  const currentIndex = allMessages.findIndex((m) => m.id === messageId)
  const history = allMessages
    .slice(0, currentIndex)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const userMessage = allMessages[currentIndex]?.content ?? ''

  const { text } = await runAgent({ agentConfig: agent, history, userMessage })

  await createMessage(db, {
    conversation_id: conversationId,
    role: 'assistant',
    content: text,
    status: 'delivered',
  })

  await evolution.sendText(evolutionInstanceName, contactPhone, text)

  await updateMessageStatus(db, messageId, 'delivered')
}
