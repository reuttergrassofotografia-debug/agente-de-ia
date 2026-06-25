import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Agent } from '../types.js'

export async function getAgentByInstanceId(
  db: SupabaseClient<Database>,
  instanceId: string,
): Promise<Agent | null> {
  const { data, error } = await db
    .from('agents')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('is_active', true)
    .single()
  if (error) return null
  return data
}
