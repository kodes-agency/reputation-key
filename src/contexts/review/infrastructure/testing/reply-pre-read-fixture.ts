// Test-only: the read of Google that precedes a publish claim, as production
// builds it, on PostgreSQL.
//
// The use case, the sync observation writer, the Review repository, the Review
// command store and the Google reply observation store are the real ones. Only
// the parts that need the worker's secrets or another context are stand-ins:
// the provider-subject keyring (no stable identity is ever matched, a Review is
// found by its external id) and the Property's source epoch.

import type { Database } from '#/shared/db'
import { reviewId } from '#/shared/domain/ids'
import type { GoogleReviewApiPort } from '../../application/ports/google-review-api.port'
import {
  readReviewBeforePublish,
  type ReadReviewBeforePublish,
} from '../../application/use-cases/read-review-before-publish'
import { createReviewProviderObservationWriter } from '../../application/use-cases/sync-reviews'
import { createGoogleReplyObservationStore } from '../google-reply-observation-store'
import { createReviewRepository } from '../repositories/review.repository'
import { createAtomicReviewCommandStore } from '../review-command-store'

export function createReplyPreReadForTests(
  input: Readonly<{
    db: Database
    googleReviewApi: GoogleReviewApiPort
    clock: () => Date
    /** The Property's current source epoch. */
    sourceEpoch: () => number | Promise<number>
    /**
     * Tells apart two runs of a suite that share a database and replay the same
     * reply ids, cycles and attempts. A read is keyed by those, and a key may be
     * replayed only with the same review content, which a later run of the suite
     * may no longer have.
     */
    runSalt?: () => string
  }>,
): ReadReviewBeforePublish {
  const { db, clock } = input
  const reviewRepo = createReviewRepository(db, clock)
  const observationWriter = createReviewProviderObservationWriter({
    reviewRepo: { ...reviewRepo, findStableIdentityByProviderSubjects: async () => null },
    clock,
    idGen: () => reviewId(crypto.randomUUID()),
    commandStore: createAtomicReviewCommandStore(db, clock),
    googleReplyObservationStore: createGoogleReplyObservationStore(db),
    historyCutoffs: { readHistoryCutoff: async () => null },
  })
  const read = readReviewBeforePublish({
    googleReviewApi: input.googleReviewApi,
    propertySourceEpoch: {
      getSourceEpoch: async () => ({ sourceEpoch: await input.sourceEpoch() }),
    },
    observationWriter,
    subjectKeyService: {
      acquireDeriver: async () => ({
        activeVersion: 'test-v1',
        retiringVersion: null,
        inventoryGeneration: 1,
        deriveCandidates: () =>
          [
            {
              contractVersion: 'review-provider-subject-v1' as const,
              keyVersion: 'test-v1',
              locatorHmac: new Uint8Array(32),
              verifierHmac: new Uint8Array(32),
            },
          ] as const,
      }),
      stageTrustedNext: async () => {},
      activateTrustedNext: async () => {},
      removeRetiring: async () => {},
    },
  })
  return (request) =>
    read(
      input.runSalt === undefined
        ? request
        : { ...request, readKey: `${request.readKey}:${input.runSalt()}` },
    )
}
