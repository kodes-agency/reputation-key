// BQC-0.4 — sync job must honor the capability stop control.
// An enqueued sync must not call Google after the capability is switched off.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews.job'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'

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

function makeStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: () => true,
    isOrgAllowlisted: () => false,
    isPropertyAllowlisted: () => true,
    isOrgSuspended: () => false,
    isPropertySuspended: () => false,
    ...overrides,
  }
}

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
      failed: 0,
      repliesMirrored: 0,
    },
  }
}

describe('sync-property-reviews job capability gate (BQC-0.4)', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('does not call the use case when property.connect_gbp is switched off', async () => {
    initCapabilityPolicyStore(
      makeStore({
        isCapabilityGloballyEnabled: (cap) => cap !== 'property.connect_gbp',
      }),
    )
    const syncReviews = vi.fn().mockResolvedValue(makeSyncResult())
    const handler = createSyncPropertyReviewsHandler({
      syncReviews: syncReviews as never,
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(syncReviews).not.toHaveBeenCalled()
  })

  it('runs the use case when the capability is enabled', async () => {
    initCapabilityPolicyStore(makeStore())
    const syncReviews = vi.fn().mockResolvedValue(makeSyncResult())
    const handler = createSyncPropertyReviewsHandler({
      syncReviews: syncReviews as never,
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(syncReviews).toHaveBeenCalledTimes(1)
  })
})
