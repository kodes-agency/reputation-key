import { Redis } from 'ioredis'

export function createProviderEphemeralRedis(url: string, ca?: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 1,
    enableAutoPipelining: false,
    ...(ca ? { tls: { ca } } : {}),
  })
}
