import type { ConnectionOptions } from 'bullmq'

export function createRedisConnection(url: string): ConnectionOptions {
  // Parse redis://[user:pass@]host[:port]
  const withoutScheme = url.replace(/^redis:\/\//, '')
  const hostPart = withoutScheme.includes('@') ? withoutScheme.split('@')[1]! : withoutScheme
  const [host, portStr] = hostPart.split(':')
  return {
    host: host ?? 'localhost',
    port: portStr ? parseInt(portStr) : 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
}
