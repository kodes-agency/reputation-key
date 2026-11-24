// Test-only: the shared fixture of the Google reply observation integration
// suites. Each suite file calls installObservationFixture() itself, so every file
// truncates the evidence tables and restarts the read-generation sequence.

import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import {
  REPUTATION_FIXTURE_EXPIRES,
  REPUTATION_FIXTURE_NOW,
  buildTestReply,
  buildTestReview,
} from '#/shared/testing/reputation-fixtures'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { Reply, Review } from '../domain/review-types'
import { createReviewRepository } from '../reviews/review-repository.server'
import { createReplyRepository } from '../replies/reply-repository.server'
import {
  seedReviewAndReplyAtStage,
  type PublicationStage,
} from '../replies/reply-publication.test-fixtures'
import type { RecordGoogleReplyObservation } from './google-reply-observation-store.port.server'

export const ORG = organizationId('org-rpl-observation-integration')
export const PROP_A = propertyId('a1000000-0000-0000-0000-000000000001')
export const PROP_B = propertyId('a1000000-0000-0000-0000-000000000002')
export const REVIEW_A = reviewId('a1000000-0000-0000-0000-000000000010')
export const REVIEW_B = reviewId('a1000000-0000-0000-0000-000000000011')
export const REPLY_A = replyId('a1000000-0000-0000-0000-000000000020')
export const REPLY_B = replyId('a1000000-0000-0000-0000-000000000021')
export const USER = userId('user-rpl-observation-integration')
export const NOW = REPUTATION_FIXTURE_NOW
export const EXPIRES = REPUTATION_FIXTURE_EXPIRES

let lease: TestLease | undefined
let nextReadGeneration = 0

/** The leased pool of the running suite file. */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    if (!lease) throw new Error('installObservationFixture() has not started')
    const value: unknown = Reflect.get(lease.pool, property)
    return typeof value === 'function' ? value.bind(lease.pool) : value
  },
})

export function makeReview(
  id: typeof REVIEW_A | typeof REVIEW_B,
  externalId: string,
  property = PROP_A,
) {
  return buildTestReview({
    id,
    organizationId: ORG,
    propertyId: property,
    externalId,
  })
}

export function makeReply(
  id: typeof REPLY_A | typeof REPLY_B,
  review: typeof REVIEW_A | typeof REVIEW_B,
  text = 'Thank you for your review!',
): Reply {
  return buildTestReply({
    id,
    reviewId: review,
    organizationId: ORG,
    createdBy: USER,
    text,
  })
}

async function resetFixture(): Promise<void> {
  nextReadGeneration = 0
  await pool.query(
    'TRUNCATE google_reply_observation_heads, google_reply_observations, reply_publication_attempts, reply_publication_authorizations CASCADE',
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  const slug = 'rpl-observation-integration'
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'RPL Observation Integration', $2, NOW())`,
    [ORG, slug],
  )
  for (const [id, slugPart] of [
    [PROP_A, 'a'],
    [PROP_B, 'b'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties
        (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())`,
      [id, ORG, `Observation Property ${slugPart}`, `rpl-observation-${slugPart}`],
    )
  }
}

/** Registers the lease and per-test reset hooks of the calling suite file. */
export function installObservationFixture(): void {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  })
  beforeEach(resetFixture)
  afterAll(async () => {
    await resetFixture()
    await lease?.release()
    lease = undefined
  })
}

export function seedReviewAndReply(input: {
  reviewId?: typeof REVIEW_A | typeof REVIEW_B
  replyId?: typeof REPLY_A | typeof REPLY_B
  externalId?: string
  propertyId?: typeof PROP_A | typeof PROP_B
  claim?: boolean
  providerPending?: boolean
  text?: string
}): Promise<{ review: Review; reply: Reply }> {
  const id = input.reviewId ?? REVIEW_A
  const stage: PublicationStage =
    input.claim === false
      ? 'authorized'
      : input.providerPending === false
        ? 'sending'
        : 'pending_observation'
  return seedReviewAndReplyAtStage({
    organizationId: ORG,
    userId: USER,
    now: NOW,
    review: makeReview(id, input.externalId ?? `external-${id}`, input.propertyId),
    reply: makeReply(input.replyId ?? REPLY_A, id, input.text),
    stage,
  })
}

export function observationInput(
  review: Review,
  overrides: Record<string, unknown> = {},
): RecordGoogleReplyObservation {
  return {
    organizationId: ORG,
    propertyId: review.propertyId,
    reviewId: review.id,
    sourceEpoch: review.sourceEpoch,
    materialReviewRevision: review.sourceRevision,
    readGeneration: ++nextReadGeneration,
    observationKey: sha256Hex('google-reply-observation-1'),
    source: 'provider_snapshot' as const,
    observedText: 'Thank you for your review!',
    providerUpdatedAt: NOW,
    observedAt: NOW,
    contentExpiresAt: EXPIRES,
    ...overrides,
  } as RecordGoogleReplyObservation
}

/** An observation whose idempotency key is derived from `keyLabel`. */
export const observe = (
  review: Review,
  keyLabel: string,
  overrides: Record<string, unknown> = {},
): RecordGoogleReplyObservation =>
  observationInput(review, { observationKey: sha256Hex(keyLabel), ...overrides })

/** Overrides that make an observation a targeted read of one attempt. */
export const targeted = (attemptNumber = 1, publicationCycle = 1) => ({
  source: 'targeted_reconciliation' as const,
  publicationTarget: { replyId: REPLY_A, publicationCycle, attemptNumber },
})

export const storedReply = () =>
  createReplyRepository(getDb(), () => new Date()).findById(REPLY_A, ORG)

export async function cancellationFacts(): Promise<number> {
  const rows = await pool.query(
    `SELECT 1 FROM outbox_events
     WHERE organization_id = $1 AND event_type = 'review.reply.publication_cancelled'`,
    [ORG],
  )
  return rows.rows.length
}

export async function attemptOutcome(): Promise<unknown> {
  const rows = await pool.query(
    `SELECT outcome, confirmed_observation_revision
     FROM reply_publication_attempts WHERE reply_id = $1`,
    [REPLY_A],
  )
  return rows.rows[0]
}

/** Moves REVIEW_A to a new material revision. */
export function advanceReviewMaterially(
  text: string,
  upsertKey: string,
): Promise<Review> {
  const later = new Date(NOW.getTime() + 1_000)
  return createReviewRepository(
    getDb(),
    () => new Date(),
    undefined,
    replyScopeEffects,
  ).upsert(
    {
      ...makeReview(REVIEW_A, `external-${REVIEW_A}`),
      text,
      sourceUpdatedAt: later,
      lastFetchedAt: later,
      contentExpiresAt: new Date(EXPIRES.getTime() + 1_000),
    },
    later,
    sha256Hex(upsertKey),
  )
}

/** A send from before the evidence chain: the reply is ambiguous and has no
 * attempt or authorization row. */
export async function seedLegacyUncertainSend(): Promise<{ review: Review }> {
  const { review } = await seedReviewAndReply({})
  await pool.query('DELETE FROM reply_publication_attempts WHERE reply_id = $1', [
    REPLY_A,
  ])
  await pool.query('DELETE FROM reply_publication_authorizations WHERE reply_id = $1', [
    REPLY_A,
  ])
  await pool.query(
    `UPDATE replies
     SET status = 'publish_failed', publication_state = 'ambiguous',
         publication_last_error_class = 'ambiguous', reconcile_due_at = $2
     WHERE id = $1`,
    [REPLY_A, NOW],
  )
  return { review }
}
