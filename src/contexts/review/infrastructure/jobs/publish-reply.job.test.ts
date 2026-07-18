// publish-reply job handler behavior.
// BQC-3.2: the BQC-0.4 in-handler capability stop control moved to the
// dispatch gate (src/shared/jobs/delayed-execution-gate.ts) — see
// gated-dispatch.test.ts and architecture/delayed-policy-delegation.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { createPublishReplyHandler } from './publish-reply.job'

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

describe('publish-reply job handler', () => {
  it('runs without an in-handler capability gate (delegated to dispatch)', async () => {
    const deps = makeDeps()
    const handler = createPublishReplyHandler(deps as never)

    await handler({ id: 'job-1', data: JOB_DATA, attemptsMade: 0 } as never)

    // No gate in the handler: the repository is consulted directly
    // (reply not found → clean skip).
    expect(deps.replyRepo.findById).toHaveBeenCalledTimes(1)
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })
})
