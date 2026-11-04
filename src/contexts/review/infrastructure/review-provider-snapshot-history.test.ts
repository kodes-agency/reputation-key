import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { reviewSyncRuns } from '#/shared/db/schema/review-sync.schema'
import { recordProviderFailure } from './repositories/review-provider-snapshot-history'

describe('failed snapshot history', () => {
  it('stores only closed provider diagnostics under the failed snapshot id', async () => {
    const values = vi.fn(async () => undefined)
    const insert = vi.fn(() => ({ values }))
    const tx = { insert } as unknown as Tx
    const startedAt = new Date('2026-11-04T01:00:00Z')
    const terminalAt = new Date('2026-11-04T01:01:00Z')

    await recordProviderFailure(
      tx,
      {
        id: 'snapshot-run-id',
        propertyId: 'property-id',
        sourceEpoch: 2,
        startedAt,
        terminalAt,
        mainPageCount: 3,
        confirmationPageCount: 1,
        mainUniqueCount: 150,
      },
      'provider_rejected',
      {
        providerStatus: 404,
        providerErrorStatus: 'NOT_FOUND',
        dispatch: 'answered',
        ...{
          body: { error: { status: 'NOT_FOUND', message: 'private customer content' } },
          message: 'private resource',
        },
      },
    )

    expect(insert).toHaveBeenCalledWith(reviewSyncRuns)
    expect(values).toHaveBeenCalledWith({
      id: 'snapshot-run-id',
      propertyId: 'property-id',
      source: 'google',
      mode: 'snapshot',
      sourceEpoch: 2,
      startedAt,
      completedAt: terminalAt,
      pageCount: 4,
      reviewCount: 150,
      failedCount: 1,
      errorClass: 'provider_rejected',
      result: JSON.stringify({
        providerStatus: 404,
        providerErrorStatus: 'NOT_FOUND',
        dispatch: 'answered',
      }),
    })
    expect(JSON.stringify(values.mock.calls)).not.toContain('private')
  })
})
