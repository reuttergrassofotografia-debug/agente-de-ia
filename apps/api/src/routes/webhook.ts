import type { FastifyInstance } from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Queue } from 'bullmq'
import {
  getInstanceByName,
  getAgentByInstanceId,
  getOrCreateContact,
  getOrCreateConversation,
  type Database,
} from '@agente/db'
import { enqueueMessage, type MessageJob } from '@agente/queue'
import { WebhookPayloadSchema } from '../schemas/webhook.js'
import { fetchAndStoreMedia } from '../lib/fetch-and-store-media.js'

interface WebhookDeps {
  db: SupabaseClient<Database>
  queue: Queue<MessageJob>
}

function extractContent(msg: Record<string, unknown> | undefined): { content: string; isText: boolean } | null {
  if (!msg) return null

  // Text messages
  const text = (msg['conversation'] as string | undefined)
    ?? ((msg['extendedTextMessage'] as Record<string, unknown> | undefined)?.['text'] as string | undefined)
  if (text) return { content: text, isText: true }

  // Audio / PTT (voice notes) — use || so explicit null falls through to check pttMessage
  if (msg['audioMessage'] || msg['pttMessage']) return { content: '[Áudio]', isText: false }

  // Image
  const imageMsg = msg['imageMessage'] as Record<string, unknown> | undefined
  if (imageMsg) {
    const caption = imageMsg['caption'] as string | undefined
    return { content: caption ? `[Imagem] ${caption}` : '[Imagem]', isText: false }
  }

  // Video
  const videoMsg = msg['videoMessage'] as Record<string, unknown> | undefined
  if (videoMsg) {
    const caption = videoMsg['caption'] as string | undefined
    return { content: caption ? `[Vídeo] ${caption}` : '[Vídeo]', isText: false }
  }

  // Document
  const docMsg = msg['documentMessage'] as Record<string, unknown> | undefined
  if (docMsg) {
    const fileName = docMsg['fileName'] as string | undefined
    return { content: fileName ? `[Documento] ${fileName}` : '[Documento]', isText: false }
  }

  // Sticker
  if (msg['stickerMessage']) return { content: '[Sticker]', isText: false }

  // Reactions (just acknowledge, don't save)
  if (msg['reactionMessage']) return null

  return null
}

export function registerWebhookRoute(app: FastifyInstance, { db, queue }: WebhookDeps): void {
  app.post('/webhook', async (request, reply) => {
    const parseResult = WebhookPayloadSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid payload', details: parseResult.error.format() })
    }
    const payload = parseResult.data

    const apikey = payload.apikey ?? (request.headers['apikey'] as string | undefined)
    const instance = await getInstanceByName(db, payload.instance)
    if (!apikey || !instance || apikey !== instance.webhook_secret) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Group messages are saved so the CRM can show them, but the AI never auto-replies in groups
    const isGroup = payload.data.key.remoteJid.endsWith('@g.us')

    const msg = payload.data.message as Record<string, unknown> | undefined
    const extracted = extractContent(msg)
    if (!extracted) return reply.status(200).send({ ok: true, skipped: 'unsupported-type' })

    const { content, isText } = extracted

    const agent = await getAgentByInstanceId(db, instance.id)
    if (!agent) return reply.status(200).send({ ok: true, skipped: 'no-agent' })

    const phone = payload.data.key.remoteJid.split('@')[0] ?? payload.data.key.remoteJid

    // For fromMe messages, pushName is the user's own WhatsApp name — never use it as the contact name.
    // In groups, pushName is the participant who sent the message, not the group name — never use it either.
    const contactName = payload.data.key.fromMe || isGroup ? undefined : payload.data.pushName
    const contact = await getOrCreateContact(db, instance.id, phone, contactName, isGroup)

    // Group message sender attribution — pushName here is correctly the participant's name
    // (message-level identity), not the contact-level name that was intentionally skipped above.
    const senderPhone = isGroup ? payload.data.key.participant?.split('@')[0] ?? null : null
    const senderName = isGroup ? payload.data.pushName ?? null : null

    // Fetch group name once (when not yet stored)
    if (isGroup && !contact.name) {
      try {
        const evoUrl = process.env['EVOLUTION_API_URL']!
        const evoKey = process.env['EVOLUTION_API_KEY']!
        const r = await fetch(
          `${evoUrl}/group/findGroupInfos/${payload.instance}?groupJid=${payload.data.key.remoteJid}`,
          { headers: { apikey: evoKey } },
        )
        if (r.ok) {
          const info = await r.json() as { subject?: string }
          if (info.subject) {
            await db.from('contacts').update({ name: info.subject }).eq('id', contact.id)
          }
        }
      } catch { /* group name is optional — contact keeps the group JID as phone */ }
    }

    // Fetch WhatsApp profile picture once (when not yet stored) — individual contacts only,
    // fetchProfilePictureUrl expects a phone number, not a group JID
    if (!isGroup && !contact.profile_picture_url) {
      try {
        const evoUrl = process.env['EVOLUTION_API_URL']!
        const evoKey = process.env['EVOLUTION_API_KEY']!
        const r = await fetch(
          `${evoUrl}/chat/fetchProfilePictureUrl/${payload.instance}?number=${phone}`,
          { headers: { apikey: evoKey } },
        )
        if (r.ok) {
          const pic = await r.json() as { profilePictureUrl?: string }
          if (pic.profilePictureUrl) {
            await db.from('contacts').update({ profile_picture_url: pic.profilePictureUrl }).eq('id', contact.id)
          }
        }
      } catch { /* profile picture is optional */ }
    }

    const conversation = await getOrCreateConversation(db, contact.id, instance.id, agent.id)

    if (payload.data.key.fromMe) {
      // Message sent from the business WhatsApp (phone or CRM).
      // Use upsert to silently ignore duplicates (Evolution API fires webhooks twice sometimes,
      // and the CRM already saves with the evolution_message_id returned by the API).
      await db.from('messages').upsert({
        conversation_id: conversation.id,
        role: 'assistant',
        content,
        evolution_message_id: payload.data.key.id,
        status: 'delivered',
      }, { onConflict: 'evolution_message_id', ignoreDuplicates: true })
      await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
      return reply.status(200).send({ ok: true, fromMe: true })
    }

    // Use upsert to handle duplicate webhook deliveries from Evolution API
    const { data: upserted } = await db.from('messages').upsert({
      conversation_id: conversation.id,
      role: 'user',
      content,
      evolution_message_id: payload.data.key.id,
      status: 'pending',
      sender_phone: senderPhone,
      sender_name: senderName,
    }, { onConflict: 'evolution_message_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle()

    // If ignoreDuplicates skipped the insert (message already exists), don't re-enqueue
    if (!upserted) return reply.status(200).send({ ok: true, skipped: 'duplicate' })

    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

    // Fire-and-forget: fetchAndStoreMedia never throws (it has its own internal try/catch), and
    // the webhook must respond quickly regardless of how long the media download/upload takes —
    // waiting here risks Evolution API treating a slow response as a timeout and retrying delivery.
    if (!isText) void fetchAndStoreMedia(db, payload.instance, payload.data.key.id, upserted.id)

    // CRITICAL: never enqueue group messages for the LLM — the AI must not auto-reply in groups
    if (isGroup) return reply.status(200).send({ ok: true, groupSaved: true })

    // Only enqueue text messages for LLM processing — agent can't process audio/images
    if (!isText) return reply.status(200).send({ ok: true, mediaSaved: true })

    await enqueueMessage(queue, {
      instanceId: instance.id,
      contactId: contact.id,
      messageId: upserted.id,
      conversationId: conversation.id,
      evolutionInstanceName: payload.instance,
      contactPhone: phone,
      conversationTriggered: conversation.agent_triggered,
    })

    return reply.status(200).send({ ok: true, jobEnqueued: true })
  })
}
