export function loadEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'REDIS_URL',
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
  ] as const

  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  // packages/llm/src/tools.ts reads these directly from process.env based on each agent's
  // configured model — without this check, a missing key doesn't surface until the first
  // message is processed, and only as a per-job failure in job_failures.
  if (!process.env['OPENAI_API_KEY'] && !process.env['ANTHROPIC_API_KEY']) {
    throw new Error('Missing environment variables: at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY must be set')
  }

  return {
    SUPABASE_URL: process.env['SUPABASE_URL']!,
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    REDIS_URL: process.env['REDIS_URL']!,
    EVOLUTION_API_URL: process.env['EVOLUTION_API_URL']!,
    EVOLUTION_API_KEY: process.env['EVOLUTION_API_KEY']!,
  }
}

export type Env = ReturnType<typeof loadEnv>
