import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Instance, Agent, Message } from '../types.js'

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
      status: 'pending', error: null, evolution_message_id: 'ev-1', created_at: '2026-01-01T00:00:00Z',
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
