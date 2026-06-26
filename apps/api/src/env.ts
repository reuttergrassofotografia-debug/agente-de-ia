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

  return {
    SUPABASE_URL: process.env['SUPABASE_URL']!,
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    REDIS_URL: process.env['REDIS_URL']!,
    EVOLUTION_API_URL: process.env['EVOLUTION_API_URL']!,
    EVOLUTION_API_KEY: process.env['EVOLUTION_API_KEY']!,
    PORT: Number(process.env['PORT'] ?? 3000),
  }
}

export type Env = ReturnType<typeof loadEnv>
