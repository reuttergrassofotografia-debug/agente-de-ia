import { describe, it, expect, vi } from 'vitest'
import type { Agent } from '@agente/db'

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ text: 'Hello, how can I help?' }),
}))

vi.mock('../tools.js', () => ({
  TOOL_REGISTRY: {},
  resolveModel: vi.fn().mockReturnValue({ modelId: 'gpt-4o' }),
}))

const MOCK_AGENT: Agent = {
  id: 'agent-1', instance_id: 'inst-1', name: 'Bot', model: 'gpt-4o',
  system_prompt: 'You are a helpful assistant.', temperature: 0.7, tools: [],
  is_active: true, business_hours: null, off_hours_message: null,
  typing_delay_ms: 0, daily_message_limit: null, created_at: '2026-01-01T00:00:00Z',
}

describe('runAgent', () => {
  it('calls generateText with system prompt and history', async () => {
    const { runAgent } = await import('../agent.js')
    const { generateText } = await import('ai')

    const result = await runAgent({
      agentConfig: MOCK_AGENT,
      history: [{ role: 'user', content: 'Previous message' }],
      userMessage: 'New message',
    })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a helpful assistant.',
        messages: expect.arrayContaining([
          { role: 'user', content: 'Previous message' },
          { role: 'user', content: 'New message' },
        ]),
        maxSteps: 5,
      }),
    )
    expect(result.text).toBe('Hello, how can I help?')
  })
})
