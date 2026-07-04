// One-off script: backfill profile_picture_url for contacts created before the
// webhook started fetching WhatsApp profile pictures.
//
// Usage (from apps/api): npm run backfill:photos
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_API_URL and
// EVOLUTION_API_KEY in the root .env (same vars the API already uses).
import { createSupabaseClient } from '@agente/db'

const DELAY_MS = 400

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const evoUrl = process.env['EVOLUTION_API_URL']
  const evoKey = process.env['EVOLUTION_API_KEY']
  if (!evoUrl || !evoKey) {
    throw new Error('EVOLUTION_API_URL and EVOLUTION_API_KEY must be set')
  }

  const db = createSupabaseClient()

  const { data: instances, error: instancesError } = await db
    .from('instances')
    .select('id, evolution_instance_name')
  if (instancesError) throw new Error(`Failed to load instances: ${instancesError.message}`)
  const instanceNameById = new Map(instances.map((i) => [i.id, i.evolution_instance_name]))

  const { data: contacts, error: contactsError } = await db
    .from('contacts')
    .select('id, phone, instance_id')
    .is('profile_picture_url', null)
  if (contactsError) throw new Error(`Failed to load contacts: ${contactsError.message}`)

  console.log(`Found ${contacts.length} contact(s) without profile picture`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const contact of contacts) {
    const instanceName = instanceNameById.get(contact.instance_id)
    if (!instanceName) {
      console.warn(`[skip] ${contact.phone}: no instance found for instance_id=${contact.instance_id}`)
      skipped++
      continue
    }

    try {
      // Same endpoint the webhook uses for new contacts
      const res = await fetch(
        `${evoUrl}/chat/fetchProfilePictureUrl/${instanceName}?number=${contact.phone}`,
        { headers: { apikey: evoKey } },
      )

      if (!res.ok) {
        console.warn(`[skip] ${contact.phone}: Evolution API returned ${res.status}`)
        skipped++
      } else {
        const pic = await res.json() as { profilePictureUrl?: string }
        if (pic.profilePictureUrl) {
          const { error: updateError } = await db
            .from('contacts')
            .update({ profile_picture_url: pic.profilePictureUrl })
            .eq('id', contact.id)
          if (updateError) throw new Error(updateError.message)
          console.log(`[ok]   ${contact.phone}: profile picture saved`)
          updated++
        } else {
          console.log(`[skip] ${contact.phone}: no profile picture available`)
          skipped++
        }
      }
    } catch (err) {
      // Log and keep going — one bad contact must not abort the whole backfill
      console.error(`[fail] ${contact.phone}:`, err instanceof Error ? err.message : err)
      failed++
    }

    // Small delay between calls so we don't hammer the Evolution API
    await sleep(DELAY_MS)
  }

  console.log(`Done. updated=${updated} skipped=${skipped} failed=${failed} total=${contacts.length}`)
}

main().catch((err) => {
  console.error('Backfill aborted:', err)
  process.exitCode = 1
})
