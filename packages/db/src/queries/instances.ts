import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Instance, InstanceStatus } from '../types.js'

export async function getInstanceByName(
  db: SupabaseClient<Database>,
  evolutionInstanceName: string,
): Promise<Instance | null> {
  const { data, error } = await db
    .from('instances')
    .select('*')
    .eq('evolution_instance_name', evolutionInstanceName)
    .single()
  if (error) return null
  return data
}

export async function updateInstanceStatus(
  db: SupabaseClient<Database>,
  instanceId: string,
  status: InstanceStatus,
): Promise<void> {
  const { error } = await db.from('instances').update({ status }).eq('id', instanceId)
  if (error) throw new Error(`updateInstanceStatus failed: ${error.message}`)
}
