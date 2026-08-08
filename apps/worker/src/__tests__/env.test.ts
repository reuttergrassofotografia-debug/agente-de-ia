import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const REQUIRED = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  REDIS_URL: 'redis://localhost:6379',
  EVOLUTION_API_URL: 'https://evolution.local',
  EVOLUTION_API_KEY: 'evo-key',
}

describe('loadEnv', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...REQUIRED }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('throws when a Supabase/Redis/Evolution variable is missing', async () => {
    delete process.env['REDIS_URL']
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-x'
    const { loadEnv } = await import('../env.js')
    expect(() => loadEnv()).toThrow(/REDIS_URL/)
  })

  it('throws when neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set', async () => {
    const { loadEnv } = await import('../env.js')
    expect(() => loadEnv()).toThrow(/OPENAI_API_KEY.*ANTHROPIC_API_KEY/)
  })

  it('succeeds when only ANTHROPIC_API_KEY is set', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-x'
    const { loadEnv } = await import('../env.js')
    expect(() => loadEnv()).not.toThrow()
  })

  it('succeeds when only OPENAI_API_KEY is set', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-x'
    const { loadEnv } = await import('../env.js')
    expect(() => loadEnv()).not.toThrow()
  })
})
