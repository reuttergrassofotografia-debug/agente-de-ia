import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Conversation } from '../types.js'

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
    .eq('status', 'active')
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
