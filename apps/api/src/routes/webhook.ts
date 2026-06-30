import type { FastifyInstance } from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Queue } from 'bullmq'
import {
  getInstanceByName,
  getAgentByInstanceId,
  getOrCreateContact,
  getOrCreateConversation,
  createMessage,
  type Database,
} from '@agente/db'
import { enqueueMessage, type MessageJob } from '@agente/queue'
import { WebhookPayloadSchema } from '../schemas/webhook.js'

interface WebhookDeps {
  db: SupabaseClient<Database>
  queue: Queue<MessageJob>
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

    const msg = payload.data.message as Record<string, unknown> | undefined
    const text = (msg?.['conversation'] as string | undefined)
      ?? ((msg?.['extendedTextMessage'] as Record<string, unknown> | undefined)?.['text'] as string | undefined)
      ?? null
    if (!text) return reply.status(200).send({ ok: true, skipped: 'non-text' })

    const agent = await getAgentByInstanceId(db, instance.id)
    if (!agent) return reply.status(200).send({ ok: true, skipped: 'no-agent' })

    const phone = payload.data.key.remoteJid.split('@')[0] ?? payload.data.key.remoteJid

    if (payload.data.key.fromMe) {
      // Message sent from the business WhatsApp (phone or CRM).
      // If the CRM already saved it (with this evolution_message_id), skip to avoid duplicate.
      const evolId = payload.data.key.id
      const { data: existing } = await db
        .from('messages')
        .select('id')
        .eq('evolution_message_id', evolId)
        .maybeSingle()
      if (existing) return reply.status(200).send({ ok: true, skipped: 'already-saved' })

      const contact = await getOrCreateContact(db, instance.id, phone, payload.data.pushName)
      const conversation = await getOrCreateConversation(db, contact.id, instance.id, agent.id)
      await createMessage(db, {
        conversation_id: conversation.id,
        role: 'assistant',
        content: text,
        evolution_message_id: evolId,
        status: 'delivered',
      })
      return reply.status(200).send({ ok: true, fromMe: true })
    }

    const contact = await getOrCreateContact(db, instance.id, phone, payload.data.pushName)
    const conversation = await getOrCreateConversation(db, contact.id, instance.id, agent.id)
    const message = await createMessage(db, {
      conversation_id: conversation.id,
      role: 'user',
      content: text,
      evolution_message_id: payload.data.key.id,
    })

    await enqueueMessage(queue, {
      instanceId: instance.id,
      contactId: contact.id,
      messageId: message.id,
      conversationId: conversation.id,
      evolutionInstanceName: payload.instance,
      contactPhone: phone,
      conversationTriggered: conversation.agent_triggered,
    })

    return reply.status(200).send({ ok: true, jobEnqueued: true })
  })
}
