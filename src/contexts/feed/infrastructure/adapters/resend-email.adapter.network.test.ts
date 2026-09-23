// The Resend adapter against the REAL `resend` SDK and a real local socket.
//
// `resend-email.adapter.test.ts` mocks the SDK, which can only restate our
// belief about what it does. The defect this file pins lived exactly there:
// on a connectivity failure resend@6 RETURNS `{ statusCode: null }` instead of
// throwing, the adapter passed that on, and the policy called it permanent — so
// a reset connection dropped urgent mail and whole digests with no retry. Both
// failures below are loopback-only and deterministic.

import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createResendEmailAdapter } from './resend-email.adapter'
import { createMockLogger } from '#/shared/testing/mock-logger'

const request = {
  to: 'manager@example.com',
  subject: 'Approve a reply at Riverside Hotel',
  html: '<p>Approve a reply</p>',
  text: 'Approve a reply',
  idempotencyKey: 'notification-1:email',
}

const servers: Server[] = []

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP server address')
  }
  return `http://127.0.0.1:${address.port}`
}

const adapterAt = (baseUrl: string) =>
  createResendEmailAdapter({
    config: {
      apiKey: 're_live_0123456789abcdef',
      baseUrl,
      from: 'Reputation Key <notifications@test.example>',
      appBaseUrl: 'https://app.test',
    },
    logger: createMockLogger(),
    clock: () => new Date('2026-08-28T12:00:00.000Z'),
  })

describe('resend email adapter over a failing network (real SDK)', () => {
  beforeEach(() => {
    // The SDK prints every failure outside production; keep the run readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('retries a connection reset before any answer', async () => {
    const baseUrl = await serve((incoming) => incoming.socket.destroy())

    const outcome = await adapterAt(baseUrl).send(request)

    expect(outcome).toEqual({
      kind: 'rejected',
      classification: 'transient',
      providerCode: 'application_error',
    })
  })

  it('retries an answer lost mid-body, when the provider may already have accepted', async () => {
    const baseUrl = await serve((_incoming, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': '64',
      })
      response.write('{"id":"prov-', () => response.socket?.destroy())
    })

    const outcome = await adapterAt(baseUrl).send(request)

    expect(outcome).toMatchObject({ kind: 'rejected', classification: 'transient' })
  })
})
