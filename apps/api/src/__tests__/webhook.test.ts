import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Queue } from 'bullmq'
import type { Database, MessageJob } from '@agente/db'

const mockGetInstanceByName = vi.fn()
const mockGetAgentByInstanceId = vi.fn()
const mockGetOrCreateContact = vi.fn()
const mockGetOrCreateConversation = vi.fn()
const mockCreateMessage = vi.fn()
const mockEnqueueMessage = vi.fn()
const mockExtractMessageText = vi.fn()

vi.mock('@agente/db', () => ({
  getInstanceByName: (...args: unknown[]) => mockGetInstanceByName(...args),
  getAgentByInstanceId: (...args: unknown[]) => mockGetAgentByInstanceId(...args),
  getOrCreateContact: (...args: unknown[]) => mockGetOrCreateContact(...args),
  getOrCreateConversation: (...args: unknown[]) => mockGetOrCreateConversation(...args),
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
}))

vi.mock('@agente/queue', () => ({
  enqueueMessage: (...args: unknown[]) => mockEnqueueMessage(...args),
}))

vi.mock('@agente/evolution', () => ({
  extractMessageText: (...args: unknown[]) => mockExtractMessageText(...args),
}))

const VALID_PAYLOAD = {
  event: 'messages.upsert',
  instance: 'test-instance',
  data: {
    key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'ev-msg-1' },
    message: { conversation: 'Hello!' },
    pushName: 'Test User',
  },
}

const INSTANCE = {
  id: 'inst-1', name: 'Test', evolution_instance_name: 'test-instance',
  webhook_secret: 'correct-secret', status: 'connected', created_at: '2026-01-01T00:00:00Z',
}

const AGENT = {
  id: 'agent-1', instance_id: 'inst-1', name: 'Bot', model: 'gpt-4o',
  system_prompt: 'You are helpful.', temperature: 0.7, tools: [], is_active: true,
  business_hours: null, off_hours_message: null, typing_delay_ms: 0,
  daily_message_limit: null, created_at: '2026-01-01T00:00:00Z',
}

async function buildApp() {
  const { registerWebhookRoute } = await import('../routes/webhook.js')
  const app = Fastify({ logger: false })
  const mockDb = {} as SupabaseClient<Database>
  const mockQueue = {} as Queue<MessageJob>
  registerWebhookRoute(app, { db: mockDb, queue: mockQueue })
  await app.ready()
  return app
}

describe('POST /webhook', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetInstanceByName.mockResolvedValue(INSTANCE)
    mockGetAgentByInstanceId.mockResolvedValue(AGENT)
    mockGetOrCreateContact.mockResolvedValue({ id: 'contact-1', phone: '5511999999999', instance_id: 'inst-1', name: 'Test User', created_at: '' })
    mockGetOrCreateConversation.mockResolvedValue({ id: 'conv-1', contact_id: 'contact-1', instance_id: 'inst-1', agent_id: 'agent-1', status: 'active', last_message_at: null, created_at: '' })
    mockCreateMessage.mockResolvedValue({ id: 'msg-1' })
    mockEnqueueMessage.mockResolvedValue('job-1')
    mockExtractMessageText.mockReturnValue('Hello!')
  })

  it('returns 401 when apikey header is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/webhook', payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when apikey does not match webhook_secret', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'wrong-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when payload is malformed', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: { event: 'messages.upsert' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 200 and ignores fromMe messages', async () => {
    const app = await buildApp()
    const payload = { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, key: { ...VALID_PAYLOAD.data.key, fromMe: true } } }
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('returns 200 and ignores non-text messages', async () => {
    mockExtractMessageText.mockReturnValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('returns 200 and enqueues job for valid text message', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEnqueueMessage).toHaveBeenCalledOnce()
    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversation_id: 'conv-1',
        role: 'user',
        content: 'Hello!',
        evolution_message_id: 'ev-msg-1',
      }),
    )
  })

  it('returns 200 and skips if no active agent', async () => {
    mockGetAgentByInstanceId.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })
})
