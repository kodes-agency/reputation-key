// BQC-0.4 — publish job must honor the capability stop control.
// An enqueued publish must not call Google after the capability is switched off.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPublishReplyHandler } from './publish-reply.job'
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

function makeDeps() {
  return {
    replyRepo: { findById: vi.fn().mockResolvedValue(null) },
    reviewRepo: { findById: vi.fn() },
    googleReviewApi: { replyToReview: vi.fn() },
    events: { emit: vi.fn() },
    clock: () => new Date('2026-07-17T00:00:00Z'),
    idGen: () => 'reply-1',
    staffPublicApi: {},
  }
}

const JOB_DATA = { replyId: 'reply-1', organizationId: 'org-1' }

describe('publish-reply job capability gate (BQC-0.4)', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('does not touch repos or Google when property.publish_reply is switched off', async () => {
    initCapabilityPolicyStore(
      makeStore({
        isCapabilityGloballyEnabled: (cap) => cap !== 'property.publish_reply',
      }),
    )
    const deps = makeDeps()
    const handler = createPublishReplyHandler(deps as never)

    await handler({ id: 'job-1', data: JOB_DATA, attemptsMade: 0 } as never)

    expect(deps.replyRepo.findById).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('proceeds past the gate when the capability is enabled', async () => {
    initCapabilityPolicyStore(makeStore())
    const deps = makeDeps()
    const handler = createPublishReplyHandler(deps as never)

    await handler({ id: 'job-1', data: JOB_DATA, attemptsMade: 0 } as never)

    // Gate passed: the handler consulted the repository (reply not found → clean skip).
    expect(deps.replyRepo.findById).toHaveBeenCalledTimes(1)
  })
})
