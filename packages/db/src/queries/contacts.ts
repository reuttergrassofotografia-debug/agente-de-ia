import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Contact } from '../types.js'

export async function getOrCreateContact(
  db: SupabaseClient<Database>,
  instanceId: string,
  phone: string,
  name?: string,
): Promise<Contact> {
  const { data, error } = await db
    .from('contacts')
    .upsert(
      { instance_id: instanceId, phone, name: name ?? null },
      { onConflict: 'instance_id,phone' },
    )
    .select('*')
    .single()
  if (error || !data) throw new Error(`getOrCreateContact failed: ${error?.message}`)
  return data
}
