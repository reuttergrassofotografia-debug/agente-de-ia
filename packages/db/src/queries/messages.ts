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

export async function createJobFailure(
  db: SupabaseClient<Database>,
  data: JobFailureInsert,
): Promise<void> {
  const { error } = await db.from('job_failures').insert(data)
  if (error) throw new Error(`createJobFailure failed: ${error.message}`)
}
