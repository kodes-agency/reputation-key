// sync-property-reviews job handler behavior.
// BQC-3.2: the BQC-0.4 in-handler capability stop control moved to the
// dispatch gate (src/shared/jobs/delayed-execution-gate.ts) — see
// gated-dispatch.test.ts and architecture/delayed-policy-delegation.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews.job'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const JOB_DATA = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  organizationId: 'org-1',
  connectionId: '22222222-2222-4222-8222-222222222222',
  locationName: 'accounts/111/locations/222',
}

function makeSyncResult() {
  return {
    isErr: () => false,
    value: {
      partialFailure: false,
      fetched: 0,
      created: 0,
      updated: 0,
      refreshed: 0,
      failed: 0,
      repliesMirrored: 0,
    },
  }
}

describe('sync-property-reviews job handler', () => {
  it('runs the use case without an in-handler capability gate (delegated to dispatch)', async () => {
    const syncReviews = vi.fn().mockResolvedValue(makeSyncResult())
    const handler = createSyncPropertyReviewsHandler({
      syncReviews: syncReviews as never,
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(syncReviews).toHaveBeenCalledTimes(1)
  })
})
