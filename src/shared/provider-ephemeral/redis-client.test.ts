import { afterEach, describe, expect, it } from 'vitest'

import { createProviderEphemeralRedis } from './redis-client'

const clients: ReturnType<typeof createProviderEphemeralRedis>[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})

describe('createProviderEphemeralRedis', () => {
  it('scopes a private CA to the dedicated Redis TLS connection', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nprivate-ca\n-----END CERTIFICATE-----'
    const client = createProviderEphemeralRedis(
      'rediss://repkey:secret@provider-redis.internal:6379',
      ca,
    )
    clients.push(client)

    expect(client.options.tls).toMatchObject({ ca })
    expect(client.options.disableClientInfo).toBe(true)
  })

  it('uses the platform trust store when no private CA is configured', () => {
    const client = createProviderEphemeralRedis(
      'rediss://repkey:secret@provider-redis.example:6379',
    )
    clients.push(client)

    expect(client.options.tls).toBe(true)
  })
})
