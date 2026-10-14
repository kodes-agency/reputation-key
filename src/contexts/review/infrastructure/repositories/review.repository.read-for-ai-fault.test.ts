// Review context — what readForAi answers when the database fails (S10-06).
//
// Review analysis settles every source status other than `available` and
// `expired` as a terminal `policy_disabled` skip: the review leaves the
// aggregates for good. `readForAi` used to catch every exception and answer
// `policy_unavailable`, so a pool timeout, a reset connection or a deadlock
// during the one primary-key read was settled as a merchant decision. A
// database fault is not an answer about the source: it is thrown, and the
// consumer or the backlog drain retries the analysis. What the row itself
// makes impossible stays an answer.

import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { AiReviewSourceRequest } from '../../application/ports/ai-review-source.port'
import { createReviewRepository } from './review.repository'

const READ: AiReviewSourceRequest = {
  organizationId: organizationId('org-read-for-ai-fault-1111111111111'),
  propertyId: propertyId('7f600000-0000-4000-8000-000000000001'),
  reviewId: reviewId('7f600000-0000-4000-8000-0000000000a1'),
  expected: { kind: 'analysis', sourceEpoch: 0, sourceRevision: 1, analysisSequence: 1 },
}

function databaseThatFails(message: string): Database {
  return {
    transaction: () => Promise.reject(new Error(message)),
  } as unknown as Database
}

describe('reviewRepository.readForAi when the database fails', () => {
  it('rejects with the database error instead of answering policy_unavailable', async () => {
    const repo = createReviewRepository(
      databaseThatFails('Connection terminated unexpectedly'),
      () => new Date('2026-10-14T09:00:00.000Z'),
    )

    await expect(repo.readForAi(READ)).rejects.toThrow(
      'Connection terminated unexpectedly',
    )
  })
})
