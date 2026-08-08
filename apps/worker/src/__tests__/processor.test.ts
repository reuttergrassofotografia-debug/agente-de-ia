import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvolutionClient } from '@agente/evolution'
import type { Database } from '@agente/db'
import type { MessageJob } from '@agente/queue'

const mockGetAgentByInstanceId = vi.fn()
const mockGetConversation = vi.fn()
const mockGetConversationMessages = vi.fn()
const mockGetOrCreateAssistantReply = vi.fn()
const mockCountAgentRepliesSince = vi.fn()
const mockUpdateMessageStatus = vi.fn()
const mockActivateConversationAgent = vi.fn()
const mockRunAgent = vi.fn()

vi.mock('@agente/db', () => ({
  getAgentByInstanceId: (...args: unknown[]) => mockGetAgentByInstanceId(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  getOrCreateAssistantReply: (...args: unknown[]) => mockGetOrCreateAssistantReply(...args),
  countAgentRepliesSince: (...args: unknown[]) => mockCountAgentRepliesSince(...args),
  updateMessageStatus: (...args: unknown[]) => mockUpdateMessageStatus(...args),
  activateConversationAgent: (...args: unknown[]) => mockActivateConversationAgent(...args),
}))

vi.mock('@agente/llm', () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...args),
}))

const AGENT = {
  id: 'agent-1', instance_id: 'inst-1', name: 'Bot', model: 'gpt-4o',
  system_prompt: 'You are helpful.', temperature: 0.7, tools: [], is_active: true,
  business_hours: null, off_hours_message: null, typing_delay_ms: 0,
  daily_message_limit: null, created_at: '2026-01-01T00:00:00Z',
}

const JOB_DATA: MessageJob = {
  instanceId: 'inst-1',
  contactId: 'contact-1',
  messageId: 'msg-1',
  conversationId: 'conv-1',
  evolutionInstanceName: 'test-instance',
  contactPhone: '5511999999999',
  conversationTriggered: false,
}

const makeJob = (data = JOB_DATA) => ({ data, opts: { attempts: 4 } } as unknown as Job<MessageJob>)

const MESSAGES = [
  { id: 'msg-0', role: 'user', content: 'Olá', status: 'delivered', error: null, evolution_message_id: 'ev-0', conversation_id: 'conv-1', created_at: '' },
  { id: 'msg-1', role: 'user', content: 'Oi de novo', status: 'pending', error: null, evolution_message_id: 'ev-1', conversation_id: 'conv-1', created_at: '' },
]

describe('processMessage', () => {
  let mockEvolution: { sendText: ReturnType<typeof vi.fn> }
  let mockDb: SupabaseClient<Database>

  beforeEach(() => {
    vi.resetAllMocks()
    mockEvolution = { sendText: vi.fn().mockResolvedValue(undefined) }
    mockDb = {} as SupabaseClient<Database>
    mockGetAgentByInstanceId.mockResolvedValue(AGENT)
    mockGetConversation.mockResolvedValue({
      id: 'conv-1', contact_id: 'contact-1', instance_id: 'inst-1', agent_id: 'agent-1',
      status: 'active', last_message_at: null, agent_triggered: false, created_at: '',
    })
    mockGetConversationMessages.mockResolvedValue(MESSAGES)
    mockGetOrCreateAssistantReply.mockImplementation(async (_db, { content }) => ({
      message: { id: 'msg-reply-1', status: 'pending', content },
      isNew: true,
    }))
    mockCountAgentRepliesSince.mockResolvedValue(0)
    mockUpdateMessageStatus.mockResolvedValue(undefined)
    mockRunAgent.mockResolvedValue({ text: 'Olá! Como posso ajudar?' })
  })

  it('skips and marks skipped when agent not found', async () => {
    mockGetAgentByInstanceId.mockResolvedValue(null)
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })
    expect(mockUpdateMessageStatus).toHaveBeenCalledWith(mockDb, 'msg-1', 'skipped')
    expect(mockRunAgent).not.toHaveBeenCalled()
  })

  it('skips when agent is inactive', async () => {
    mockGetAgentByInstanceId.mockResolvedValue({ ...AGENT, is_active: false })
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })
    expect(mockUpdateMessageStatus).toHaveBeenCalledWith(mockDb, 'msg-1', 'skipped')
    expect(mockRunAgent).not.toHaveBeenCalled()
  })

  it('skips and sends off_hours_message when outside business hours', async () => {
    // Saturday with only Monday configured = outside hours
    const agent = { ...AGENT, business_hours: { mon: ['09:00', '18:00'] as [string, string] }, off_hours_message: 'Fechado!' }
    mockGetAgentByInstanceId.mockResolvedValue(agent)
    const { processMessage } = await import('../processor.js')
    // Saturday = day index 6, which is not 'mon' → outside hours
    vi.setSystemTime(new Date('2026-06-27T12:00:00')) // Saturday
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })
    expect(mockEvolution.sendText).toHaveBeenCalledWith('test-instance', '5511999999999', 'Fechado!')
    expect(mockUpdateMessageStatus).toHaveBeenCalledWith(mockDb, 'msg-1', 'skipped')
    vi.useRealTimers()
  })

  it('processes message: sets processing → runs LLM → persists reply → sends → sets delivered', async () => {
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })

    expect(mockUpdateMessageStatus).toHaveBeenNthCalledWith(1, mockDb, 'msg-1', 'processing')
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentConfig: AGENT,
        history: [{ role: 'user', content: 'Olá' }],
        userMessage: 'Oi de novo',
      }),
    )
    expect(mockGetOrCreateAssistantReply).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ conversation_id: 'conv-1', content: 'Olá! Como posso ajudar?', reply_to_message_id: 'msg-1' }),
    )
    expect(mockEvolution.sendText).toHaveBeenCalledWith('test-instance', '5511999999999', 'Olá! Como posso ajudar?')
    expect(mockUpdateMessageStatus).toHaveBeenNthCalledWith(2, mockDb, 'msg-reply-1', 'delivered')
    expect(mockUpdateMessageStatus).toHaveBeenNthCalledWith(3, mockDb, 'msg-1', 'delivered')
  })

  it('does not resend when retrying a job whose reply was already delivered', async () => {
    mockGetOrCreateAssistantReply.mockResolvedValue({
      message: { id: 'msg-reply-1', status: 'delivered', content: 'Olá! Como posso ajudar?' },
      isNew: false,
    })
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })

    expect(mockEvolution.sendText).not.toHaveBeenCalled()
    expect(mockUpdateMessageStatus).toHaveBeenCalledWith(mockDb, 'msg-1', 'delivered')
  })

  it('resends when retrying a job whose reply row exists but was never delivered', async () => {
    mockGetOrCreateAssistantReply.mockResolvedValue({
      message: { id: 'msg-reply-1', status: 'pending', content: 'Olá! Como posso ajudar?' },
      isNew: false,
    })
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })

    expect(mockEvolution.sendText).toHaveBeenCalledWith('test-instance', '5511999999999', 'Olá! Como posso ajudar?')
    expect(mockUpdateMessageStatus).toHaveBeenCalledWith(mockDb, 'msg-reply-1', 'delivered')
  })

  it('skips without replying once the daily message limit is reached', async () => {
    mockGetAgentByInstanceId.mockResolvedValue({ ...AGENT, daily_message_limit: 3 })
    mockCountAgentRepliesSince.mockResolvedValue(3)
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })

    expect(mockRunAgent).not.toHaveBeenCalled()
    expect(mockEvolution.sendText).not.toHaveBeenCalled()
    expect(mockUpdateMessageStatus).toHaveBeenCalledWith(mockDb, 'msg-1', 'skipped')
  })

  it('replies normally while under the daily message limit', async () => {
    mockGetAgentByInstanceId.mockResolvedValue({ ...AGENT, daily_message_limit: 3 })
    mockCountAgentRepliesSince.mockResolvedValue(2)
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })

    expect(mockEvolution.sendText).toHaveBeenCalledWith('test-instance', '5511999999999', 'Olá! Como posso ajudar?')
  })

  it('waits typing_delay_ms before sending the reply', async () => {
    mockGetAgentByInstanceId.mockResolvedValue({ ...AGENT, typing_delay_ms: 500 })
    vi.useFakeTimers()
    const { processMessage } = await import('../processor.js')
    const done = processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })

    await vi.advanceTimersByTimeAsync(499)
    expect(mockEvolution.sendText).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await done

    expect(mockEvolution.sendText).toHaveBeenCalledWith('test-instance', '5511999999999', 'Olá! Como posso ajudar?')
    vi.useRealTimers()
  })

  it('filters tool messages out of history', async () => {
    const messagesWithTool = [
      { id: 'msg-0', role: 'user', content: 'Olá', status: 'delivered', error: null, evolution_message_id: 'ev-0', conversation_id: 'conv-1', created_at: '' },
      { id: 'msg-t', role: 'tool', content: '{"result":true}', status: 'delivered', error: null, evolution_message_id: null, conversation_id: 'conv-1', created_at: '' },
      { id: 'msg-1', role: 'user', content: 'Oi de novo', status: 'pending', error: null, evolution_message_id: 'ev-1', conversation_id: 'conv-1', created_at: '' },
    ]
    mockGetConversationMessages.mockResolvedValue(messagesWithTool)
    const { processMessage } = await import('../processor.js')
    await processMessage(makeJob(), { db: mockDb, evolution: mockEvolution as unknown as EvolutionClient })
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({ history: [{ role: 'user', content: 'Olá' }] }),
    )
  })
})
