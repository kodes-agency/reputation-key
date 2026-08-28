// Review context — on-google-account-disconnected consumer tests (BQC-3.8).
//
// The consumer translates the integration fact into the publication
// cancellation use case with cause 'disconnect'. Registration is pinned in
// the catalogue guards (review.event-handlers consumer row).

import { describe, it, expect, vi } from 'vitest'
import { onGoogleAccountDisconnected } from './on-google-account-disconnected'
import type { IntegrationGoogleAccountDisconnected } from '#/contexts/integration/application/public-api'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { ReviewEventLogger } from './on-google-account-disconnected'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const ORG_ID = organizationId('org-1')
const CONN_ID = googleConnectionId('conn-1')
const logger: ReviewEventLogger = { info: vi.fn() }

const disconnectedEvent: IntegrationGoogleAccountDisconnected = {
  _tag: 'integration.google_account.disconnected',
  eventId: 'evt-1',
  connectionId: CONN_ID,
  organizationId: ORG_ID,
  occurredAt: new Date('2026-07-17T00:00:00Z'),
  correlationId: null,
}

describe('review onGoogleAccountDisconnected', () => {
  it('runs the publication cancellation for the connection with cause disconnect', async () => {
    const cancelPublicationsForConnection = vi.fn(async () => ({
      reviewsScanned: 3,
      cancelled: 2,
      batches: 1,
    }))
    const handler = onGoogleAccountDisconnected({
      cancelPublicationsForConnection,
      logger,
    })

    await handler(disconnectedEvent)

    expect(cancelPublicationsForConnection).toHaveBeenCalledTimes(1)
    expect(cancelPublicationsForConnection).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      cause: 'disconnect',
    })
    expect(logger.info).toHaveBeenCalledTimes(2)
  })

  it('propagates a use-case failure (the bus isolates handler errors; cancellation is idempotent)', async () => {
    const cancelPublicationsForConnection = vi.fn(async () => {
      throw new Error('db down')
    })
    const handler = onGoogleAccountDisconnected({
      cancelPublicationsForConnection,
      logger,
    })

    await expect(handler(disconnectedEvent)).rejects.toThrow('db down')
  })
})
