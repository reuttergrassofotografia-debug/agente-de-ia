import type { ConnectionOptions } from 'bullmq'

export function createRedisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url)
  const opts: ConnectionOptions = {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  }
  return opts
}
