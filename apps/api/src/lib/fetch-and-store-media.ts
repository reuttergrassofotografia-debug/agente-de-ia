import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@agente/db'

// Best-effort: downloads a non-text message's media from the Evolution API and stores it in
// the `whatsapp-media` Supabase Storage bucket, then records the path on the message row.
// Never throws — a media fetch/upload failure must not affect the rest of webhook processing;
// the text placeholder already saved on the message row is enough to not lose the message.
export async function fetchAndStoreMedia(
  db: SupabaseClient<Database>,
  evolutionInstanceName: string,
  evolutionMessageId: string,
  messageDbId: string,
): Promise<void> {
  try {
    const evoUrl = process.env['EVOLUTION_API_URL']!
    const evoKey = process.env['EVOLUTION_API_KEY']!
    const r = await fetch(`${evoUrl}/chat/getBase64FromMediaMessage/${evolutionInstanceName}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: evoKey },
      body: JSON.stringify({ message: { key: { id: evolutionMessageId } } }),
    })
    if (!r.ok) return
    const data = await r.json() as { base64?: string; mimetype?: string }
    if (!data.base64 || !data.mimetype) return
    const buffer = Buffer.from(data.base64, 'base64')
    const path = messageDbId
    const { error: uploadError } = await db.storage
      .from('whatsapp-media')
      .upload(path, buffer, { contentType: data.mimetype })
    if (uploadError) return
    await db.from('messages').update({ media_path: path, media_mimetype: data.mimetype }).eq('id', messageDbId)
  } catch { /* media is best-effort */ }
}
