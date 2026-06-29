import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Conversation, ConversationStatus } from '../types.js'

export async function getConversation(
  db: SupabaseClient<Database>,
  conversationId: string,
): Promise<Conversation | null> {
  const { data } = await db.from('conversations').select('*').eq('id', conversationId).single()
  return data ?? null
}

export async function setConversationStatus(
  db: SupabaseClient<Database>,
  conversationId: string,
  status: ConversationStatus,
): Promise<void> {
  const { error } = await db.from('conversations').update({ status }).eq('id', conversationId)
  if (error) throw new Error(`setConversationStatus failed: ${error.message}`)
}

export async function getOrCreateConversation(
  db: SupabaseClient<Database>,
  contactId: string,
  instanceId: string,
  agentId: string,
): Promise<Conversation> {
  const { data: existing } = await db
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .eq('instance_id', instanceId)
    .in('status', ['active', 'paused'])
    .single()
  if (existing) return existing

  const { data, error } = await db
    .from('conversations')
    .insert({ contact_id: contactId, instance_id: instanceId, agent_id: agentId, status: 'active' })
    .select('*')
    .single()
  if (error || !data) throw new Error(`getOrCreateConversation failed: ${error?.message}`)
  return data
}

export async function activateConversationAgent(
  db: SupabaseClient<Database>,
  conversationId: string,
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ agent_triggered: true })
    .eq('id', conversationId)
  if (error) throw new Error(`activateConversationAgent failed: ${error.message}`)
}
