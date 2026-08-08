import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Instance, Agent, Message, Contact } from '../types.js'

function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    ...overrides,
  }
  return chain
}

function makeDb(chain: Record<string, unknown>): SupabaseClient<Database> {
  return { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>
}

describe('getInstanceByName', () => {
  it('returns instance when found', async () => {
    const { getInstanceByName } = await import('../queries/instances.js')
    const instance: Instance = {
      id: 'inst-1', name: 'Test', evolution_instance_name: 'test',
      webhook_secret: 'sec', status: 'connected', created_at: '2026-01-01T00:00:00Z',
    }
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: instance, error: null }) })
    const result = await getInstanceByName(makeDb(chain), 'test')
    expect(result).toEqual(instance)
  })

  it('returns null when not found', async () => {
    const { getInstanceByName } = await import('../queries/instances.js')
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }) })
    const result = await getInstanceByName(makeDb(chain), 'missing')
    expect(result).toBeNull()
  })
})

describe('getAgentByInstanceId', () => {
  it('returns active agent', async () => {
    const { getAgentByInstanceId } = await import('../queries/agents.js')
    const agent: Agent = {
      id: 'agent-1', instance_id: 'inst-1', name: 'Bot', model: 'gpt-4o',
      system_prompt: 'You are helpful.', temperature: 0.7, tools: [],
      is_active: true, business_hours: null, off_hours_message: null,
      typing_delay_ms: 1000, daily_message_limit: null, created_at: '2026-01-01T00:00:00Z',
    }
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: agent, error: null }) })
    const result = await getAgentByInstanceId(makeDb(chain), 'inst-1')
    expect(result).toEqual(agent)
  })

  it('returns null when no active agent', async () => {
    const { getAgentByInstanceId } = await import('../queries/agents.js')
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }) })
    const result = await getAgentByInstanceId(makeDb(chain), 'inst-1')
    expect(result).toBeNull()
  })
})

describe('createMessage', () => {
  it('inserts message and returns it', async () => {
    const { createMessage } = await import('../queries/messages.js')
    const created: Message = {
      id: 'msg-1', conversation_id: 'conv-1', role: 'user', content: 'Hello',
      status: 'pending', error: null, evolution_message_id: 'ev-1',
      media_path: null, media_mimetype: null, sender_phone: null, sender_name: null,
      reply_to_message_id: null, created_at: '2026-01-01T00:00:00Z',
    }
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: created, error: null }),
    }
    const result = await createMessage(makeDb(chain), {
      conversation_id: 'conv-1', role: 'user', content: 'Hello', evolution_message_id: 'ev-1',
    })
    expect(result).toEqual(created)
  })
})

describe('getOrCreateAssistantReply', () => {
  it('returns the inserted row and isNew=true on first attempt', async () => {
    const { getOrCreateAssistantReply } = await import('../queries/messages.js')
    const created: Message = {
      id: 'reply-1', conversation_id: 'conv-1', role: 'assistant', content: 'Oi!',
      status: 'pending', error: null, evolution_message_id: null,
      media_path: null, media_mimetype: null, sender_phone: null, sender_name: null,
      reply_to_message_id: 'msg-1', created_at: '2026-01-01T00:00:00Z',
    }
    const chain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: created, error: null }),
    }
    const result = await getOrCreateAssistantReply(makeDb(chain), {
      conversation_id: 'conv-1', content: 'Oi!', reply_to_message_id: 'msg-1',
    })
    expect(result).toEqual({ message: created, isNew: true })
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ reply_to_message_id: 'msg-1', role: 'assistant' }),
      { onConflict: 'reply_to_message_id', ignoreDuplicates: true },
    )
  })

  it('refetches and returns isNew=false when a retry hits the unique index', async () => {
    const { getOrCreateAssistantReply } = await import('../queries/messages.js')
    const existing: Message = {
      id: 'reply-1', conversation_id: 'conv-1', role: 'assistant', content: 'Oi!',
      status: 'delivered', error: null, evolution_message_id: null,
      media_path: null, media_mimetype: null, sender_phone: null, sender_name: null,
      reply_to_message_id: 'msg-1', created_at: '2026-01-01T00:00:00Z',
    }
    let call = 0
    const chain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(() => {
        call += 1
        return Promise.resolve(call === 1 ? { data: null, error: null } : { data: existing, error: null })
      }),
    }
    const result = await getOrCreateAssistantReply(makeDb(chain), {
      conversation_id: 'conv-1', content: 'Oi!', reply_to_message_id: 'msg-1',
    })
    expect(result).toEqual({ message: existing, isNew: false })
  })
})

describe('countAgentRepliesSince', () => {
  it('counts assistant messages across the agent\'s conversations since the given instant', async () => {
    const { countAgentRepliesSince } = await import('../queries/messages.js')
    const conversationsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'conv-1' }, { id: 'conv-2' }], error: null }),
    }
    const messagesChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 5, error: null }),
    }
    const from = vi.fn((table: string) => (table === 'conversations' ? conversationsChain : messagesChain))
    const db = { from } as unknown as SupabaseClient<Database>

    const result = await countAgentRepliesSince(db, 'agent-1', '2026-01-01T00:00:00.000Z')

    expect(result).toBe(5)
    expect(conversationsChain.eq).toHaveBeenCalledWith('agent_id', 'agent-1')
    expect(messagesChain.in).toHaveBeenCalledWith('conversation_id', ['conv-1', 'conv-2'])
    expect(messagesChain.eq).toHaveBeenCalledWith('role', 'assistant')
    expect(messagesChain.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00.000Z')
  })

  it('returns 0 without querying messages when the agent has no conversations', async () => {
    const { countAgentRepliesSince } = await import('../queries/messages.js')
    const conversationsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const messagesChain = { select: vi.fn() }
    const from = vi.fn((table: string) => (table === 'conversations' ? conversationsChain : messagesChain))
    const db = { from } as unknown as SupabaseClient<Database>

    const result = await countAgentRepliesSince(db, 'agent-1', '2026-01-01T00:00:00.000Z')

    expect(result).toBe(0)
    expect(messagesChain.select).not.toHaveBeenCalled()
  })
})

describe('updateMessageStatus', () => {
  it('updates status field', async () => {
    const { updateMessageStatus } = await import('../queries/messages.js')
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    await expect(updateMessageStatus(makeDb(chain), 'msg-1', 'delivered')).resolves.toBeUndefined()
    expect(chain.update).toHaveBeenCalledWith({ status: 'delivered' })
  })

  it('includes error field when provided', async () => {
    const { updateMessageStatus } = await import('../queries/messages.js')
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    await updateMessageStatus(makeDb(chain), 'msg-1', 'failed', 'LLM timeout')
    expect(chain.update).toHaveBeenCalledWith({ status: 'failed', error: 'LLM timeout' })
  })
})

describe('getOrCreateContact', () => {
  it('does not overwrite name when name_edited_by_user is true', async () => {
    const { getOrCreateContact } = await import('../queries/contacts.js')
    const existing: Contact = {
      id: 'contact-1', instance_id: 'inst-1', phone: '5511999998888',
      name: 'Nome Editado Manualmente', profile_picture_url: null, is_group: false,
      notes: null, name_edited_by_user: true, created_at: '2026-01-01T00:00:00Z',
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
      update: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }
    const result = await getOrCreateContact(makeDb(chain), 'inst-1', '5511999998888', 'PushName Novo')
    expect(result).toEqual(existing)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it('overwrites name from pushName when name_edited_by_user is false', async () => {
    const { getOrCreateContact } = await import('../queries/contacts.js')
    const existing: Contact = {
      id: 'contact-1', instance_id: 'inst-1', phone: '5511999998888',
      name: 'Nome Antigo', profile_picture_url: null, is_group: false,
      notes: null, name_edited_by_user: false, created_at: '2026-01-01T00:00:00Z',
    }
    const updated: Contact = { ...existing, name: 'PushName Novo' }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    }
    const result = await getOrCreateContact(makeDb(chain), 'inst-1', '5511999998888', 'PushName Novo')
    expect(result).toEqual(updated)
    expect(chain.update).toHaveBeenCalledWith({ name: 'PushName Novo' })
  })
})
