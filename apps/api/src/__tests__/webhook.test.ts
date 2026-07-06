import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Queue } from 'bullmq'
import type { Database } from '@agente/db'
import type { MessageJob } from '@agente/queue'

const mockGetInstanceByName = vi.fn()
const mockGetAgentByInstanceId = vi.fn()
const mockGetOrCreateContact = vi.fn()
const mockGetOrCreateConversation = vi.fn()
const mockEnqueueMessage = vi.fn()

vi.mock('@agente/db', () => ({
  getInstanceByName: (...args: unknown[]) => mockGetInstanceByName(...args),
  getAgentByInstanceId: (...args: unknown[]) => mockGetAgentByInstanceId(...args),
  getOrCreateContact: (...args: unknown[]) => mockGetOrCreateContact(...args),
  getOrCreateConversation: (...args: unknown[]) => mockGetOrCreateConversation(...args),
}))

vi.mock('@agente/queue', () => ({
  enqueueMessage: (...args: unknown[]) => mockEnqueueMessage(...args),
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

const GROUP_PAYLOAD = {
  event: 'messages.upsert',
  instance: 'test-instance',
  data: {
    key: { remoteJid: '120363123456789012@g.us', fromMe: false, id: 'ev-msg-g1' },
    message: { conversation: 'Hello group!' },
    pushName: 'Some Participant',
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
  daily_message_limit: null, trigger_phrase: null, created_at: '2026-01-01T00:00:00Z',
}

const CONTACT = {
  id: 'contact-1', phone: '5511999999999', instance_id: 'inst-1', name: 'Test User',
  profile_picture_url: 'https://pps.whatsapp.net/pic.jpg', is_group: false, created_at: '',
}

const GROUP_CONTACT = {
  id: 'contact-g1', phone: '120363123456789012', instance_id: 'inst-1', name: 'Test Group',
  profile_picture_url: null, is_group: true, created_at: '',
}

const CONVERSATION = {
  id: 'conv-1', contact_id: 'contact-1', instance_id: 'inst-1', agent_id: 'agent-1',
  status: 'active', last_message_at: null, agent_triggered: false, created_at: '',
}

// Minimal Supabase client mock supporting the chains used by the webhook route:
//   db.from('messages').upsert(...).select('id').maybeSingle()   (incoming messages)
//   await db.from('messages').upsert(...)                        (fromMe messages)
//   db.from('contacts'|'conversations').update(...).eq(...)
function makeMockDb() {
  const state = { upsertedId: 'msg-1' as string | null }
  const messagesUpsert = vi.fn(() => ({
    select: () => ({
      maybeSingle: async () => ({ data: state.upsertedId ? { id: state.upsertedId } : null, error: null }),
    }),
    then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
  }))
  const messagesUpdate = vi.fn(() => ({ eq: async () => ({ data: null, error: null }) }))
  const update = vi.fn(() => ({ eq: async () => ({ data: null, error: null }) }))
  const from = vi.fn((table: string) => (table === 'messages' ? { upsert: messagesUpsert, update: messagesUpdate } : { update }))
  const upload = vi.fn(async () => ({ error: null }))
  const storage = { from: vi.fn(() => ({ upload })) }
  return { db: { from, storage } as unknown as SupabaseClient<Database>, messagesUpsert, messagesUpdate, update, upload, state }
}

async function buildApp() {
  const { registerWebhookRoute } = await import('../routes/webhook.js')
  const app = Fastify({ logger: false })
  const mock = makeMockDb()
  const mockQueue = {} as Queue<MessageJob>
  registerWebhookRoute(app, { db: mock.db, queue: mockQueue })
  await app.ready()
  return { app, ...mock }
}

describe('POST /webhook', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    mockGetInstanceByName.mockResolvedValue(INSTANCE)
    mockGetAgentByInstanceId.mockResolvedValue(AGENT)
    mockGetOrCreateContact.mockResolvedValue(CONTACT)
    mockGetOrCreateConversation.mockResolvedValue(CONVERSATION)
    mockEnqueueMessage.mockResolvedValue('job-1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when apikey header is missing', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/webhook', payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when apikey does not match webhook_secret', async () => {
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'wrong-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when payload is malformed', async () => {
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: { event: 'messages.upsert' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('saves fromMe messages as assistant without enqueueing', async () => {
    const { app, messagesUpsert } = await buildApp()
    const payload = { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, key: { ...VALID_PAYLOAD.data.key, fromMe: true } } }
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'Hello!' }),
      expect.anything(),
    )
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('returns 200 and ignores unsupported message types', async () => {
    const { app, messagesUpsert } = await buildApp()
    const payload = { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, message: { reactionMessage: {} } } }
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(messagesUpsert).not.toHaveBeenCalled()
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('returns 200 and enqueues job for valid text message', async () => {
    const { app, messagesUpsert } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEnqueueMessage).toHaveBeenCalledOnce()
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-1',
        role: 'user',
        content: 'Hello!',
        evolution_message_id: 'ev-msg-1',
      }),
      expect.anything(),
    )
  })

  it('saves media messages without enqueueing', async () => {
    const { app, messagesUpsert } = await buildApp()
    const payload = { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, message: { audioMessage: {} } } }
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: '[Áudio]' }),
      expect.anything(),
    )
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('returns 200 and skips duplicate message deliveries', async () => {
    const { app, state } = await buildApp()
    state.upsertedId = null
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, skipped: 'duplicate' })
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('returns 200 and skips if no active agent', async () => {
    mockGetAgentByInstanceId.mockResolvedValue(null)
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('saves group messages as group contact but never enqueues the LLM job', async () => {
    mockGetOrCreateContact.mockResolvedValue(GROUP_CONTACT)
    const { app, messagesUpsert } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: GROUP_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, groupSaved: true })
    // Contact created with the group JID as phone, isGroup=true and no pushName
    // (pushName in groups is the participant, not the group name)
    expect(mockGetOrCreateContact).toHaveBeenCalledWith(
      expect.anything(), 'inst-1', '120363123456789012', undefined, true,
    )
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'Hello group!', evolution_message_id: 'ev-msg-g1' }),
      expect.anything(),
    )
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('saves fromMe group messages as assistant without enqueueing', async () => {
    mockGetOrCreateContact.mockResolvedValue(GROUP_CONTACT)
    const { app, messagesUpsert } = await buildApp()
    const payload = { ...GROUP_PAYLOAD, data: { ...GROUP_PAYLOAD.data, key: { ...GROUP_PAYLOAD.data.key, fromMe: true } } }
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'Hello group!' }),
      expect.anything(),
    )
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('fetches the group name from the Evolution API when the group contact has no name', async () => {
    mockGetOrCreateContact.mockResolvedValue({ ...GROUP_CONTACT, name: null })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ subject: 'My Group' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { app, update } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: GROUP_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/group/findGroupInfos/test-instance?groupJid=120363123456789012@g.us'),
      expect.anything(),
    )
    expect(update).toHaveBeenCalledWith({ name: 'My Group' })
    expect(mockEnqueueMessage).not.toHaveBeenCalled()
  })

  it('captures sender phone and name for group messages', async () => {
    mockGetOrCreateContact.mockResolvedValue(GROUP_CONTACT)
    const payload = {
      ...GROUP_PAYLOAD,
      data: { ...GROUP_PAYLOAD.data, key: { ...GROUP_PAYLOAD.data.key, participant: '5511988887777@s.whatsapp.net' } },
    }
    const { app, messagesUpsert } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ sender_phone: '5511988887777', sender_name: 'Some Participant' }),
      expect.anything(),
    )
  })

  it('does not set sender_phone/sender_name for individual (non-group) messages', async () => {
    const { app, messagesUpsert } = await buildApp()
    await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ sender_phone: null, sender_name: null }),
      expect.anything(),
    )
  })

  it('fetches and stores media for non-text messages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('getBase64FromMediaMessage')) {
        return { ok: true, json: async () => ({ base64: Buffer.from('fake').toString('base64'), mimetype: 'audio/ogg' }) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const payload = { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, message: { audioMessage: {} } } }
    const { app, upload, messagesUpdate } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    await new Promise(resolve => setImmediate(resolve))
    expect(upload).toHaveBeenCalledWith('msg-1', expect.any(Buffer), { contentType: 'audio/ogg' })
    expect(messagesUpdate).toHaveBeenCalledWith({ media_path: 'msg-1', media_mimetype: 'audio/ogg' })
  })
})
