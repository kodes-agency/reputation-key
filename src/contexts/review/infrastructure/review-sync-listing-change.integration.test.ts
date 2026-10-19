// A Google listing that changes between a snapshot run's two scans, against
// real PostgreSQL.
//
// A snapshot run lists a location twice, and the second (confirmation) listing
// must return exactly the reviews the first did before the run may remove
// anything. On the closed beta on 2026-10-19 the largest location (3,714
// reviews, 75 pages, about three minutes a listing) failed one run in 189 as
// `confirmation_set_changed`: a guest most likely posted while the run was
// between its two listings. The next run completed, but the failed one became a
// Sentry error, an alert, a dead letter and a repair latch.
//
// These tests drive the real sync job handler, snapshot use case, snapshot
// repository and Review observation writer with a fake Google listing. They
// prove that one change ends the run as `listing_changed` with a fresh run
// queued and no failure, that a listing that keeps changing is loud again, and
// that a run whose listing changed removes nothing.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deriveReviewProviderSubject } from '#/shared/review-provider-subject-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleReview } from '../domain/types'
import type {
  GoogleReviewApiPort,
  GoogleReviewPage,
} from '../application/ports/google-review-api.port'
import type { ReviewProviderSubjectKeyService } from '../application/provider-subject-keyring'
import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  type SyncPropertyReviewsJobData,
} from '../application/ports/review-queue.port'
import { createReviewProviderObservationWriter } from '../application/use-cases/sync-reviews'
import { runReviewProviderSnapshot } from '../application/use-cases/run-review-provider-snapshot'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createSyncPropertyReviewsHandler } from './jobs/sync-property-reviews.job'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewProviderSnapshotRepository } from './repositories/review-provider-snapshot.repository'
import { createReviewRepository } from './repositories/review.repository'

const ORG = organizationId('review-listing-change-org')
const PROPERTY = propertyId('75000000-0000-4000-8000-00000000a001')
const CONNECTION = googleConnectionId('75000000-0000-4000-8000-00000000c001')
const ACCOUNT = 'listing-change-account'
const LOCATION = `accounts/${ACCOUNT}/locations/location-a001`
const TEST_KEY_VERSION = 'listing-change-test-v1'
const TEST_KEY = new Uint8Array(32).fill(9)
const PUBLISHED = new Date('2025-06-01T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
/** A worker steps a run one page at a time; no scenario here needs more. */
const MAX_STEPS = 40

const db = getDb()
let activeKeyVersion = TEST_KEY_VERSION
let insertedTestKey = false

const snapshotRepository = createReviewProviderSnapshotRepository(db, () =>
  crypto.randomUUID(),
)

const observationWriter = createReviewProviderObservationWriter({
  reviewRepo: createReviewRepository(db, () => new Date()),
  clock: () => new Date(),
  idGen: () => reviewId(crypto.randomUUID()),
  commandStore: createAtomicReviewCommandStore(db, () => new Date()),
  googleReplyObservationStore: createGoogleReplyObservationStore(db),
  historyCutoffs: snapshotRepository,
})

type Listing = Readonly<{ main: GoogleReviewPage; confirmation: GoogleReviewPage }>

/**
 * What Google lists for each run, in the order the runs start: the first run
 * reads `listings[0]`, the next `listings[1]`, and every run after the last
 * entry reads the last one again.
 */
let listings: readonly Listing[] = []
let runOrder: string[] = []
/** The reviews a targeted read finds on Google. Everything else is gone. */
let readable: readonly GoogleReview[] = []

const googleReviewApi: GoogleReviewApiPort = {
  listReviewsPage: vi.fn(async ({ runId, phase }) => {
    if (!runOrder.includes(runId)) runOrder.push(runId)
    const listing = listings[Math.min(runOrder.indexOf(runId), listings.length - 1)]
    if (!listing) throw new Error('No listing for this run')
    return phase === 'main' ? listing.main : listing.confirmation
  }),
  getReview: vi.fn(async ({ reviewName }) => {
    const found = readable.find((review) => review.reviewName === reviewName)
    return found
      ? { status: 'found' as const, review: found }
      : { status: 'not_found' as const }
  }),
  discardReviewCursors: vi.fn(async () => undefined),
  replyToReview: vi.fn(async () => ({ providerCorrelationId: null })),
}

const subjectKeyService: ReviewProviderSubjectKeyService = {
  acquireDeriver: async () => ({
    activeVersion: activeKeyVersion,
    retiringVersion: null,
    inventoryGeneration: 1,
    deriveCandidates: (scope) => [
      deriveReviewProviderSubject({
        ...scope,
        keyVersion: activeKeyVersion,
        key: TEST_KEY,
      }),
    ],
  }),
  stageTrustedNext: vi.fn(async () => undefined),
  activateTrustedNext: vi.fn(async () => undefined),
  removeRetiring: vi.fn(async () => undefined),
}

const logger: LoggerPort = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => logger,
}

const propertySourceEpoch = { getSourceEpoch: async () => ({ sourceEpoch: 0 }) }

const discoveryRepo = {
  markDiscoveryDeferred: vi.fn(async () => undefined),
  markSyncSucceeded: vi.fn(async () => undefined),
}

let queued: SyncPropertyReviewsJobData[] = []

const handler = createSyncPropertyReviewsHandler({
  runSnapshot: runReviewProviderSnapshot({
    repository: snapshotRepository,
    googleReviewApi,
    propertySourceEpoch,
    observationWriter,
    subjectKeyService,
    syncActivity: {
      recordNewReviewObserved: vi.fn(async () => undefined),
      recordPushObserved: vi.fn(async () => undefined),
    },
    clock: () => new Date(),
    logger,
  }),
  propertySourceEpoch,
  enqueueContinuation: async (data) => {
    queued.push(data)
  },
  syncActivity: {
    recordNewReviewObserved: vi.fn(async () => undefined),
    recordPushObserved: vi.fn(async () => undefined),
  },
  discoveryRepo,
  clock: () => new Date(),
  hotIntervalMs: 15 * 60 * 1000,
})

const SYNC: SyncPropertyReviewsJobData = {
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONNECTION,
  locationName: LOCATION,
  initiator: { kind: 'system', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
}

type Sync = Readonly<{
  /** What each step resolved with, in order. */
  outcomes: readonly unknown[]
  /** What failed the job, if a step did. */
  thrown: unknown
}>

/** One sync as the worker runs it: each queued step in turn, until none is left
 * or a step fails the job. */
async function sync(): Promise<Sync> {
  queued = [SYNC]
  const outcomes: unknown[] = []
  for (let steps = 0; queued.length > 0; steps += 1) {
    if (steps === MAX_STEPS) throw new Error('The sync never settled')
    const data = queued.shift()
    try {
      outcomes.push(await handler({ id: `step-${steps}`, data } as never))
    } catch (error) {
      return { outcomes, thrown: error }
    }
  }
  return { outcomes, thrown: null }
}

function guestReview(slug: string): GoogleReview {
  return {
    reviewName: `${LOCATION}/reviews/${slug}`,
    externalId: slug,
    externalLocationId: LOCATION,
    reviewerName: `Guest ${slug}`,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text: `Review ${slug}`,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: PUBLISHED,
    sourceCreatedAt: PUBLISHED,
    sourceUpdatedAt: PUBLISHED,
    replyText: null,
    replyUpdatedAt: null,
  }
}

const page = (reviews: readonly GoogleReview[], total: number): GoogleReviewPage => ({
  reviews,
  totalReviewCount: total,
  averageRating: 5,
  nextCursorRef: null,
})

/** Google lists `reviews` twice over, as it counts them. */
const steady = (reviews: readonly GoogleReview[]): Listing => ({
  main: page(reviews, reviews.length),
  confirmation: page(reviews, reviews.length),
})

const first = guestReview('listing-change-first')
const second = guestReview('listing-change-second')
const posted = guestReview('listing-change-posted')

/** The confirmation lists a review the main listing did not, before Google's
 * own count has caught up with it. */
const POSTED_MID_RUN: Listing = {
  main: page([first, second], 2),
  confirmation: page([first, second, posted], 2),
}

async function runCodes(): Promise<readonly (string | null)[]> {
  const result = await db.execute(sql`
    SELECT state, failure_code FROM review_provider_snapshot_runs
    WHERE organization_id = ${ORG} AND property_id = ${PROPERTY}
    ORDER BY started_at, id
  `)
  return result.rows.map((row) =>
    row.state === 'completed' ? 'completed' : (row.failure_code as string | null),
  )
}

async function storedSourceState(review: GoogleReview): Promise<unknown> {
  const result = await db.execute(sql`
    SELECT source_content_state, text FROM reviews
    WHERE organization_id = ${ORG} AND external_id = ${review.externalId}
  `)
  return result.rows[0]
}

const failureCode = (thrown: unknown): unknown =>
  typeof thrown === 'object' && thrown != null && 'failureCode' in thrown
    ? thrown.failureCode
    : thrown

async function clear(): Promise<void> {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM google_reply_observation_heads WHERE organization_id = ${ORG}`,
  )
  await db.execute(
    sql`DELETE FROM google_reply_observations WHERE organization_id = ${ORG}`,
  )
  await db.execute(
    sql`DELETE FROM review_provider_subjects WHERE organization_id = ${ORG}`,
  )
  await db.execute(
    sql`DELETE FROM review_provider_snapshot_runs WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${ORG}`)
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await clear()
  await deleteTestOrganizations(db, [ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Listing change test', ${ORG}, now())
  `)
  const active = await db.execute(sql`
    SELECT key_version FROM review_provider_subject_hmac_key_versions
    WHERE state = 'active'
  `)
  const existing = active.rows[0]?.key_version
  if (existing == null) {
    await db.execute(sql`
      INSERT INTO review_provider_subject_hmac_key_versions
        (key_version, key_digest, state, generation, created_at, activated_at)
      VALUES
        (${TEST_KEY_VERSION}, ${'9'.repeat(64)}, 'active', 999997,
         transaction_timestamp(), transaction_timestamp())
    `)
    insertedTestKey = true
  } else {
    activeKeyVersion = String(existing)
  }
})

beforeEach(async () => {
  await clear()
  await db.execute(sql`
    INSERT INTO google_connections (
      id, organization_id, google_subject, encrypted_access_token,
      encrypted_refresh_token, token_expires_at, scopes, connected_by,
      visibility, status
    ) VALUES (
      ${CONNECTION}, ${ORG}, 'listing-change-subject', 'sealed-access',
      'sealed-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], 'listing-change-user',
      'organization', 'active'
    )
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
    VALUES (${PROPERTY}, ${ORG}, 'Listing change property', 'listing-change', 'UTC', 0)
  `)
  listings = []
  runOrder = []
  readable = []
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.error).mockClear()
  discoveryRepo.markDiscoveryDeferred.mockClear()
  discoveryRepo.markSyncSucceeded.mockClear()
})

afterAll(async () => {
  await clear()
  if (insertedTestKey) {
    await db.execute(sql`
      DELETE FROM review_provider_subject_hmac_key_versions
      WHERE key_version = ${TEST_KEY_VERSION}
    `)
  }
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe('a listing that changes between the two scans of a run (real PostgreSQL)', () => {
  it('restarts the sync at once, without a failure, and the fresh run completes', async () => {
    listings = [POSTED_MID_RUN, steady([first, second, posted])]

    const { outcomes, thrown } = await sync()

    expect(thrown).toBeNull()
    expect(outcomes).toContainEqual(
      expect.objectContaining({ status: 'failed', code: 'listing_changed' }),
    )
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['listing_changed', 'completed'])
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
    expect(discoveryRepo.markSyncSucceeded).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_snapshot_listing_changed', expected: 2, listed: 2, confirmed: 0 },
      expect.any(String),
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('restarts quietly when a review the main listing had is gone from the confirmation', async () => {
    listings = [
      { main: page([first, second], 2), confirmation: page([first], 2) },
      steady([first]),
    ]

    const { outcomes, thrown } = await sync()

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['listing_changed', 'completed'])
    // The fresh run is the first to miss the review, so it removes nothing:
    // a removal needs a miss by an earlier run at least 15 minutes before.
    expect(await storedSourceState(second)).toMatchObject({
      source_content_state: 'active',
    })
  })

  // Three runs in a row is not guests posting but a listing that does not page
  // the same way twice. That stays as loud as every set change used to be.
  it('fails loudly on the third run in a row whose listing changed, and stays loud', async () => {
    listings = [POSTED_MID_RUN]

    const loud = await sync()

    expect(failureCode(loud.thrown)).toBe('confirmation_set_changed')
    expect(await runCodes()).toEqual([
      'listing_changed',
      'listing_changed',
      'confirmation_set_changed',
    ])
    expect(discoveryRepo.markDiscoveryDeferred).toHaveBeenCalledWith(
      PROPERTY,
      expect.any(Date),
      expect.any(Date),
      'confirmation_set_changed',
    )

    // The next poll's run changes again: loud at once, with no quiet restart.
    const next = await sync()
    expect(failureCode(next.thrown)).toBe('confirmation_set_changed')
    expect((await runCodes()).slice(3)).toEqual(['confirmation_set_changed'])
  })

  it('counts afresh after a completed run, and skips a run lost to a cursor store restart', async () => {
    const changedRun = async (code: 'confirmation_set_changed' | 'cursor_lost') => {
      const run = await snapshotRepository.startOrResume({
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceEpoch: 0,
        observationOrigin: 'ongoing',
      })
      const failed = await snapshotRepository.failRun({
        runId: run.id,
        organizationId: ORG,
        code,
      })
      return failed.failureCode
    }

    await expect(changedRun('confirmation_set_changed')).resolves.toBe('listing_changed')
    // A deploy took the next run's cursor: it never got to compare its listings.
    await expect(changedRun('cursor_lost')).resolves.toBe('cursor_lost')
    await expect(changedRun('confirmation_set_changed')).resolves.toBe('listing_changed')
    await expect(changedRun('confirmation_set_changed')).resolves.toBe(
      'confirmation_set_changed',
    )

    listings = [steady([first, second])]
    await expect(sync()).resolves.toMatchObject({ thrown: null })

    await expect(changedRun('confirmation_set_changed')).resolves.toBe('listing_changed')
  })

  // The run had found a stored review missing from Google, confirmed it absent
  // from a listing that agreed with Google's total, and made it a removal
  // candidate. Google then shows it after all: the run removes nothing.
  it('removes nothing on a run whose candidate Google shows again', async () => {
    const hidden = guestReview('listing-change-hidden')
    listings = [steady([first, second, hidden])]
    await expect(sync()).resolves.toMatchObject({ thrown: null })
    // An earlier run missed it two days ago, so this run may make it a candidate.
    await db.execute(sql`
      UPDATE review_provider_subjects s
      SET first_missing_at = now() - ${`${2 * DAY_MS} milliseconds`}::interval,
          first_missing_snapshot_run_id = ${crypto.randomUUID()}
      FROM reviews r
      WHERE r.id = s.review_id AND r.organization_id = ${ORG}
        AND r.external_id = ${hidden.externalId}
    `)

    // Google leaves it out of a listing that agrees with its own total, then a
    // targeted read finds it after all.
    runOrder = []
    readable = [hidden]
    listings = [steady([first, second]), steady([first, second, hidden])]
    const { outcomes, thrown } = await sync()

    expect(thrown).toBeNull()
    expect(outcomes).toContainEqual(
      expect.objectContaining({ status: 'failed', code: 'listing_changed' }),
    )
    expect(await runCodes()).toEqual(['completed', 'listing_changed', 'completed'])
    const candidates = await db.execute(sql`
      SELECT c.state, run.failure_code
      FROM review_provider_deletion_candidates c
      JOIN review_provider_snapshot_runs run ON run.id = c.run_id
      WHERE run.organization_id = ${ORG}
    `)
    expect(candidates.rows).toEqual([
      { state: 'observed', failure_code: 'listing_changed' },
    ])
    expect(await storedSourceState(hidden)).toEqual({
      source_content_state: 'active',
      text: hidden.text,
    })
    // The changed run never reached its apply step and cannot be made to.
    const changedRunId = runOrder[0]
    await expect(
      snapshotRepository.applyDeletionBatch({ runId: changedRunId ?? '', limit: 100 }),
    ).rejects.toMatchObject({ code: 'snapshot_run_not_deleting' })
  })
})
