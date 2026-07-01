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
    // Only update name if the contact has no name yet and we have one
    if (name && !existing.name) {
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

  // Create new contact
  const { data, error } = await db
    .from('contacts')
    .insert({ instance_id: instanceId, phone, name: name ?? null })
    .select('*')
    .single()

  if (error || !data) throw new Error(`getOrCreateContact failed: ${error?.message}`)
  return data
}
