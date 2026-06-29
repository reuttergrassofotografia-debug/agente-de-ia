import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ScheduledMessage, ScheduledMessageInsert } from '../types.js'

export async function createScheduledMessage(
  db: SupabaseClient<Database>,
  data: ScheduledMessageInsert,
): Promise<ScheduledMessage> {
  const { data: created, error } = await db
    .from('scheduled_messages')
    .insert({ media_type: 'text', ...data })
    .select('*')
    .single()
  if (error || !created) throw new Error(`createScheduledMessage failed: ${error?.message}`)
  return created
}

export async function getPendingScheduledMessages(
  db: SupabaseClient<Database>,
): Promise<(ScheduledMessage & { conversation: { instance_id: string; contact_id: string } | null })[]> {
  const { data, error } = await db
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
  if (error) throw new Error(`getPendingScheduledMessages failed: ${error.message}`)
  const rows = (data ?? []) as ScheduledMessage[]
  if (rows.length === 0) return []
  const convIds = [...new Set(rows.map(r => r.conversation_id))]
  const { data: convs } = await db
    .from('conversations')
    .select('id, instance_id, contact_id')
    .in('id', convIds)
  const convMap = new Map((convs ?? []).map(c => [c.id, { instance_id: c.instance_id, contact_id: c.contact_id }]))
  return rows.map(r => ({ ...r, conversation: convMap.get(r.conversation_id) ?? null }))
}

export async function updateScheduledMessageStatus(
  db: SupabaseClient<Database>,
  id: string,
  status: 'sent' | 'failed',
  errorMsg?: string,
): Promise<void> {
  const { error } = await db
    .from('scheduled_messages')
    .update({ status, error: errorMsg ?? null })
    .eq('id', id)
  if (error) throw new Error(`updateScheduledMessageStatus failed: ${error.message}`)
}
