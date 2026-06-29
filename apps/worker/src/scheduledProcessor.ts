import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvolutionClient } from '@agente/evolution'
import {
  getPendingScheduledMessages,
  updateScheduledMessageStatus,
  createMessage,
  type Database,
} from '@agente/db'

interface ScheduledDeps {
  db: SupabaseClient<Database>
  evolution: EvolutionClient
}

export async function processScheduledMessages({ db, evolution }: ScheduledDeps): Promise<void> {
  const pending = await getPendingScheduledMessages(db)
  if (pending.length === 0) return

  for (const msg of pending) {
    const conv = msg.conversation
    if (!conv) {
      await updateScheduledMessageStatus(db, msg.id, 'failed', 'conversation not found')
      continue
    }

    try {
      // Get the instance to find evolution_instance_name and contact phone
      const { data: instance } = await db
        .from('instances')
        .select('evolution_instance_name')
        .eq('id', conv.instance_id)
        .single()

      const { data: contact } = await db
        .from('contacts')
        .select('phone')
        .eq('id', conv.contact_id)
        .single()

      if (!instance || !contact) throw new Error('instance or contact not found')

      if (msg.media_type === 'audio' && msg.media_base64) {
        await evolution.sendAudio(instance.evolution_instance_name, contact.phone, msg.media_base64)
      } else if (msg.media_type === 'image' && msg.media_base64 && msg.mimetype) {
        await evolution.sendMedia(instance.evolution_instance_name, contact.phone, msg.media_base64, msg.mimetype, msg.content)
      } else {
        await evolution.sendText(instance.evolution_instance_name, contact.phone, msg.content)
      }

      await createMessage(db, {
        conversation_id: msg.conversation_id,
        role: 'assistant',
        content: msg.content,
        status: 'delivered',
      })

      await updateScheduledMessageStatus(db, msg.id, 'sent')
    } catch (err) {
      await updateScheduledMessageStatus(db, msg.id, 'failed', String(err))
    }
  }
}
