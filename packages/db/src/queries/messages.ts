import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Message, MessageInsert, MessageStatus, JobFailureInsert } from '../types.js'

export async function createMessage(
  db: SupabaseClient<Database>,
  data: MessageInsert,
): Promise<Message> {
  const { data: created, error } = await db
    .from('messages')
    .insert({ ...data, status: data.status ?? 'pending' })
    .select('*')
    .single()
  if (error || !created) throw new Error(`createMessage failed: ${error?.message}`)
  return created
}

// Idempotent counterpart to createMessage for LLM-generated replies: reply_to_message_id has a
// partial unique index, so a BullMQ retry that reaches this point again (e.g. after a prior
// attempt's evolution.sendText succeeded but a later step failed) reuses the row from the first
// attempt instead of inserting a second reply and sending it to the customer again.
export async function getOrCreateAssistantReply(
  db: SupabaseClient<Database>,
  data: { conversation_id: string; content: string; reply_to_message_id: string },
): Promise<{ message: Message; isNew: boolean }> {
  const { data: created } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: data.conversation_id,
        role: 'assistant',
        content: data.content,
        status: 'pending',
        reply_to_message_id: data.reply_to_message_id,
      },
      { onConflict: 'reply_to_message_id', ignoreDuplicates: true },
    )
    .select('*')
    .single()

  if (created) return { message: created, isNew: true }

  const { data: existing, error } = await db
    .from('messages')
    .select('*')
    .eq('reply_to_message_id', data.reply_to_message_id)
    .single()
  if (error || !existing) throw new Error(`getOrCreateAssistantReply failed: ${error?.message}`)
  return { message: existing, isNew: false }
}

export async function updateMessageStatus(
  db: SupabaseClient<Database>,
  messageId: string,
  status: MessageStatus,
  errorMsg?: string,
): Promise<void> {
  const payload: { status: MessageStatus; error?: string | null } = { status }
  if (errorMsg !== undefined) payload.error = errorMsg
  const { error } = await db.from('messages').update(payload).eq('id', messageId)
  if (error) throw new Error(`updateMessageStatus failed: ${error.message}`)
}

export async function getConversationMessages(
  db: SupabaseClient<Database>,
  conversationId: string,
): Promise<Message[]> {
  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`getConversationMessages failed: ${error.message}`)
  return data ?? []
}

// Counts assistant replies sent by an agent (across all its conversations) since `since`, to
// enforce Agent.daily_message_limit. Two queries instead of an embedded join, matching the
// multi-step pattern already used in queries/scheduled.ts.
export async function countAgentRepliesSince(
  db: SupabaseClient<Database>,
  agentId: string,
  since: string,
): Promise<number> {
  const { data: convs, error: convError } = await db
    .from('conversations')
    .select('id')
    .eq('agent_id', agentId)
  if (convError) throw new Error(`countAgentRepliesSince failed: ${convError.message}`)
  const conversationIds = (convs ?? []).map((c) => c.id)
  if (conversationIds.length === 0) return 0

  const { count, error } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', conversationIds)
    .eq('role', 'assistant')
    .gte('created_at', since)
  if (error) throw new Error(`countAgentRepliesSince failed: ${error.message}`)
  return count ?? 0
}

export async function createJobFailure(
  db: SupabaseClient<Database>,
  data: JobFailureInsert,
): Promise<void> {
  const { error } = await db.from('job_failures').insert(data)
  if (error) throw new Error(`createJobFailure failed: ${error.message}`)
}
