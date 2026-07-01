import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Contact } from '../types.js'

export async function getOrCreateContact(
  db: SupabaseClient<Database>,
  instanceId: string,
  phone: string,
  name?: string,
): Promise<Contact> {
  // Check if contact already exists
  const { data: existing } = await db
    .from('contacts')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('phone', phone)
    .maybeSingle()

  if (existing) {
    // Always update name when caller has one — name is only passed for fromMe:false messages
    // so it is always the real contact display name, never the business owner's name
    if (name && name !== existing.name) {
      const { data: updated } = await db
        .from('contacts')
        .update({ name })
        .eq('id', existing.id)
        .select('*')
        .single()
      return updated ?? existing
    }
    return existing
  }

  // ignoreDuplicates:true prevents a concurrent insert from overwriting the name set by a racing webhook
  const { data } = await db
    .from('contacts')
    .upsert(
      { instance_id: instanceId, phone, name: name ?? null },
      { onConflict: 'instance_id,phone', ignoreDuplicates: true },
    )
    .select('*')
    .single()

  if (data) return data

  // Row was ignored because a concurrent insert won the race — fetch the existing row
  const { data: refetched, error } = await db
    .from('contacts')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('phone', phone)
    .single()

  if (error || !refetched) throw new Error(`getOrCreateContact failed: ${error?.message}`)
  return refetched
}
