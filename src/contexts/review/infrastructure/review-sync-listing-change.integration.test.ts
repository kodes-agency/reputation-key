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
//
// The same holds when the listing moves while a scan is still reading its
// pages: Google's total (or average) differing from page to page, or one
// review on two pages. On the closed beta on 2026-10-20 the largest location
// (75 pages, about 15 minutes a run) failed two runs in a row as
// `total_changed`, at page 7 and at page 65, because guests posted while it
// was listing; the two runs after them completed.

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
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
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

/** One scan of a listing: a single page, or each of its pages in order. */
type Scan = GoogleReviewPage | readonly GoogleReviewPage[]
type Listing = Readonly<{ main: Scan; confirmation: Scan }>

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
  listReviewsPage: vi.fn(async ({ runId, phase, pageIndex }) => {
    if (!runOrder.includes(runId)) runOrder.push(runId)
    const listing = listings[Math.min(runOrder.indexOf(runId), listings.length - 1)]
    if (!listing) throw new Error('No listing for this run')
    const scan = phase === 'main' ? listing.main : listing.confirmation
    const found = 'reviews' in scan ? scan : scan[pageIndex]
    if (!found) throw new Error('No such page in this listing')
    return found
  }),
  readReviewsHead: vi.fn(),
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
  findFailureState: vi.fn(async () => null),
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

/** The queued steps as the worker runs them, one after the other, until none
 * is left or a step fails the job. `untilFailed` stops after the first run that
 * ends failed, leaving the step it queued for the next call. */
async function drain(untilFailed = false): Promise<Sync> {
  const outcomes: unknown[] = []
  for (let steps = 0; queued.length > 0; steps += 1) {
    if (steps === MAX_STEPS) throw new Error('The sync never settled')
    const data = queued.shift()
    try {
      const outcome = await handler({ id: `step-${steps}`, data } as never)
      outcomes.push(outcome)
      if (untilFailed && (outcome as { status?: unknown }).status === 'failed') {
        return { outcomes, thrown: null }
      }
    } catch (error) {
      return { outcomes, thrown: error }
    }
  }
  return { outcomes, thrown: null }
}

/** One sync as the worker runs it, from its first step. */
function sync(start: SyncPropertyReviewsJobData = SYNC): Promise<Sync> {
  queued = [start]
  return drain()
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

/** A cursor the snapshot tables accept; the fake listing ignores its value. */
const NEXT_PAGE = `v1.${'A'.repeat(43)}`

const page = (
  reviews: readonly GoogleReview[],
  total: number,
  nextCursorRef: string | null = null,
  averageRating = 5,
): GoogleReviewPage => ({
  reviews,
  totalReviewCount: total,
  averageRating,
  nextCursorRef,
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

  it('counts afresh after a completed run, and skips a run lost to a cursor store restart or to a connection waiting for a reconnect', async () => {
    const changedRun = async (
      code: 'confirmation_set_changed' | 'cursor_lost' | 'connection_unusable',
    ) => {
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
    // The connection broke under the next one: it never compared its listings.
    await expect(changedRun('connection_unusable')).resolves.toBe('connection_unusable')
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

  // The run is part-way through a confirmation of two pages when the second one
  // shows a review the main listing did not have. Its removal candidate was
  // already confirmed missing, and stays so on a run that is over: only a run
  // whose own two listings agree may remove it.
  it('removes a vanished review only on the fresh run whose listings agree, never on the changed one', async () => {
    const hidden = guestReview('listing-change-hidden')
    listings = [steady([first, second, hidden])]
    await expect(sync()).resolves.toMatchObject({ thrown: null })
    // An earlier run missed it two days ago, so the next run may make it a
    // candidate, and a targeted read finds it gone from Google.
    await db.execute(sql`
      UPDATE review_provider_subjects s
      SET first_missing_at = now() - ${`${2 * DAY_MS} milliseconds`}::interval,
          first_missing_snapshot_run_id = ${crypto.randomUUID()}
      FROM reviews r
      WHERE r.id = s.review_id AND r.organization_id = ${ORG}
        AND r.external_id = ${hidden.externalId}
    `)

    runOrder = []
    listings = [
      {
        main: [page([first], 2, NEXT_PAGE), page([second], 2)],
        confirmation: [page([first], 2, NEXT_PAGE), page([second, posted], 2)],
      },
      steady([first, second, posted]),
    ]
    queued = [SYNC]
    const changed = await drain(true)

    expect(changed.thrown).toBeNull()
    expect(changed.outcomes.at(-1)).toMatchObject({
      status: 'failed',
      code: 'listing_changed',
    })
    expect(await runCodes()).toEqual(['completed', 'listing_changed'])
    expect(await storedSourceState(hidden)).toMatchObject({
      source_content_state: 'active',
    })

    const { outcomes, thrown } = await drain()

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['completed', 'listing_changed', 'completed'])
    const [changedRunId, freshRunId] = runOrder
    const candidates = await db.execute(sql`
      SELECT c.run_id, c.state FROM review_provider_deletion_candidates c
      JOIN review_provider_snapshot_runs run ON run.id = c.run_id
      WHERE run.organization_id = ${ORG} ORDER BY run.started_at
    `)
    expect(candidates.rows).toEqual([
      { run_id: changedRunId, state: 'confirmed_missing' },
      { run_id: freshRunId, state: 'confirmed_missing' },
    ])
    // The changed run confirmed the candidate but never applied it: the review
    // went only when the fresh run, whose two listings agreed, completed.
    expect(await storedSourceState(hidden)).toBeUndefined()
    await expect(
      snapshotRepository.applyDeletionBatch({ runId: changedRunId ?? '', limit: 100 }),
    ).rejects.toMatchObject({ code: 'snapshot_run_not_deleting' })

    // A step of the changed run still queued when it ended finds it over,
    // applies nothing and starts one more fresh run rather than resuming it.
    queued = []
    const stale = await handler({
      id: 'step-stale',
      data: { ...SYNC, runId: changedRunId },
    } as never)
    expect(stale).toMatchObject({
      status: 'failed',
      code: 'listing_changed',
      alreadyFailed: true,
    })
    expect(queued).toEqual([{ ...SYNC, sourceEpoch: 0 }])
    expect(await runCodes()).toEqual(['completed', 'listing_changed', 'completed'])
  })

  // Only the Property's own runs in its own source epoch count: another
  // Property, or the Property's earlier epoch, hitting a changed listing says
  // nothing about this one.
  it('counts only the runs of the same Property and source epoch', async () => {
    const other = propertyId('75000000-0000-4000-8000-00000000a002')
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
      VALUES (${other}, ${ORG}, 'Listing change neighbour', 'listing-change-2', 'UTC', 0)
    `)
    const changedRun = async (property: typeof PROPERTY, sourceEpoch: number) => {
      const run = await snapshotRepository.startOrResume({
        organizationId: ORG,
        propertyId: property,
        sourceEpoch,
        observationOrigin: 'ongoing',
      })
      const failed = await snapshotRepository.failRun({
        runId: run.id,
        organizationId: ORG,
        code: 'confirmation_set_changed',
      })
      return failed.failureCode
    }

    await expect(changedRun(other, 0)).resolves.toBe('listing_changed')
    await expect(changedRun(other, 0)).resolves.toBe('listing_changed')
    await expect(changedRun(other, 0)).resolves.toBe('confirmation_set_changed')

    await expect(changedRun(PROPERTY, 1)).resolves.toBe('listing_changed')
    await expect(changedRun(PROPERTY, 1)).resolves.toBe('listing_changed')
    await expect(changedRun(PROPERTY, 1)).resolves.toBe('confirmation_set_changed')

    // Neither neighbour's three changes nor the other epoch's count here.
    await expect(changedRun(PROPERTY, 0)).resolves.toBe('listing_changed')
    await expect(changedRun(PROPERTY, 0)).resolves.toBe('listing_changed')
    await expect(changedRun(PROPERTY, 0)).resolves.toBe('confirmation_set_changed')
  })

  // The first import is the only sync a person waits for. Its quiet restart
  // stays an import, and no notice reaches them: the run that failed says so
  // as a temporary failure, which Feed ignores, and the fresh run completes.
  it('keeps a first import an import across the restart and ends it as completed', async () => {
    listings = [POSTED_MID_RUN, steady([first, second, posted])]
    const initiator = {
      kind: 'system' as const,
      id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
    }

    const { thrown, outcomes } = await sync({ ...SYNC, initiator })

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    const origins = await db.execute(sql`
      SELECT observation_origin, failure_code FROM review_provider_snapshot_runs
      WHERE organization_id = ${ORG} ORDER BY started_at
    `)
    expect(origins.rows).toEqual([
      { observation_origin: 'historical_onboarding', failure_code: 'listing_changed' },
      { observation_origin: 'historical_onboarding', failure_code: null },
    ])
    const facts = await db.execute(sql`
      SELECT payload->>'outcome' AS outcome, payload->>'failureReason' AS reason
      FROM outbox_events
      WHERE event_type = 'review.property_history_import.finished'
        AND organization_id = ${ORG}
      ORDER BY created_at, id
    `)
    expect(facts.rows).toEqual([
      { outcome: 'failed', reason: 'temporary' },
      { outcome: 'completed', reason: null },
    ])
  })
})

/** A listing whose confirmation scan is never reached. */
const mainOnly = (main: Scan): Listing => ({ main, confirmation: page([], 0) })

const hidden = guestReview('listing-change-hidden')

/** A guest posted between the requests for page 1 and page 2: Google's total
 * is 3 on the first page and 4 on the second. */
const TOTAL_GREW_MID_SCAN = mainOnly([
  page([first], 3, NEXT_PAGE),
  page([second, posted], 4),
])

/** Google's average moves between two pages while its total holds (a guest
 * changed a rating). */
const AVERAGE_MOVED_MID_SCAN = mainOnly([
  page([first], 2, NEXT_PAGE, 5),
  page([second], 2, null, 4.5),
])

/** A review posted (or edited, which moves it to the top of Google's list)
 * between the two requests shifts the page boundary by one: `second` closes
 * page 1 and opens page 2. Google's total holds, as a re-rated or edited review
 * does not change it. */
const REVIEW_ON_TWO_PAGES = mainOnly([
  page([first, second], 3, NEXT_PAGE),
  page([second, posted], 3),
])

/** The total moves while the confirmation scan reads its second page. */
const TOTAL_GREW_MID_CONFIRMATION: Listing = {
  main: page([first, second], 2),
  confirmation: [page([first], 2, NEXT_PAGE), page([second], 3)],
}

describe('a Google listing that moves while a scan is reading its pages (real PostgreSQL)', () => {
  // The largest beta location failed two runs in a row as `total_changed`
  // (2026-10-20, expected 3,716 at page 7 and 3,717 at page 65); each was a
  // Sentry error, an alert, a dead letter and a repair latch.
  it('restarts the sync at once, without a failure, when the total grows between two pages, and removes nothing', async () => {
    listings = [steady([first, second, hidden])]
    await expect(sync()).resolves.toMatchObject({ thrown: null })
    // An earlier run missed `hidden` two days ago, so a run that listed it
    // missing again, in a listing that agrees with Google's total, could make
    // it a removal candidate.
    const earlierMiss = crypto.randomUUID()
    await db.execute(sql`
      UPDATE review_provider_subjects s
      SET first_missing_at = now() - ${`${2 * DAY_MS} milliseconds`}::interval,
          first_missing_snapshot_run_id = ${earlierMiss}
      FROM reviews r
      WHERE r.id = s.review_id AND r.organization_id = ${ORG}
        AND r.external_id = ${hidden.externalId}
    `)

    runOrder = []
    discoveryRepo.markSyncSucceeded.mockClear()
    listings = [TOTAL_GREW_MID_SCAN, steady([first, second, posted, hidden])]
    queued = [SYNC]
    const changed = await drain(true)

    expect(changed.thrown).toBeNull()
    expect(changed.outcomes.at(-1)).toMatchObject({
      status: 'failed',
      code: 'listing_changed',
    })
    expect(await runCodes()).toEqual(['completed', 'listing_changed'])
    // The fresh run is queued at once under the same initiator, as a new run.
    expect(queued).toEqual([{ ...SYNC, sourceEpoch: 0 }])
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_snapshot_listing_changed', expected: 3, listed: 1, confirmed: 0 },
      expect.any(String),
    )
    expect(logger.error).not.toHaveBeenCalled()
    // The run that moved never reached its apply step: it recorded no removal
    // candidate and no first miss, and removed nothing.
    const candidates = await db.execute(sql`
      SELECT c.state FROM review_provider_deletion_candidates c
      JOIN review_provider_snapshot_runs run ON run.id = c.run_id
      WHERE run.organization_id = ${ORG} AND run.failure_code = 'listing_changed'
    `)
    expect(candidates.rows).toEqual([])
    const miss = await db.execute(sql`
      SELECT s.first_missing_snapshot_run_id FROM review_provider_subjects s
      JOIN reviews r ON r.id = s.review_id
      WHERE r.organization_id = ${ORG} AND r.external_id = ${hidden.externalId}
    `)
    expect(miss.rows).toEqual([{ first_missing_snapshot_run_id: earlierMiss }])
    expect(await storedSourceState(hidden)).toMatchObject({
      source_content_state: 'active',
    })

    const { outcomes, thrown } = await drain()

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['completed', 'listing_changed', 'completed'])
    expect(discoveryRepo.markSyncSucceeded).toHaveBeenCalledTimes(1)
    expect(await storedSourceState(hidden)).toMatchObject({
      source_content_state: 'active',
    })
  })

  it('restarts quietly when the total grows while the confirmation scan is reading', async () => {
    listings = [TOTAL_GREW_MID_CONFIRMATION, steady([first, second, posted])]

    const { outcomes, thrown } = await sync()

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['listing_changed', 'completed'])
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
  })

  it('restarts quietly when only the average moves between two pages', async () => {
    listings = [AVERAGE_MOVED_MID_SCAN, steady([first, second])]

    const { outcomes, thrown } = await sync()

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['listing_changed', 'completed'])
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
  })

  it('restarts quietly when a review shifts onto the next page of the main scan', async () => {
    listings = [REVIEW_ON_TWO_PAGES, steady([first, second, posted])]

    const { outcomes, thrown } = await sync()

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['listing_changed', 'completed'])
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
  })

  // Three runs in a row whose total moved is a listing that does not hold
  // still, not guests posting: loud, and under the code that says what moved.
  it.each([
    { name: 'total', listing: TOTAL_GREW_MID_SCAN, code: 'total_changed' },
    { name: 'average', listing: AVERAGE_MOVED_MID_SCAN, code: 'average_changed' },
    { name: 'page boundary', listing: REVIEW_ON_TWO_PAGES, code: 'duplicate_resource' },
  ])(
    'fails loudly on the third run in a row whose $name moved, and stays loud',
    async ({ listing, code }) => {
      listings = [listing]

      const loud = await sync()

      expect(failureCode(loud.thrown)).toBe(code)
      expect(await runCodes()).toEqual(['listing_changed', 'listing_changed', code])
      expect(discoveryRepo.markDiscoveryDeferred).toHaveBeenCalledWith(
        PROPERTY,
        expect.any(Date),
        expect.any(Date),
        code,
      )

      // The next poll's run moves again: loud at once, with no quiet restart.
      const next = await sync()
      expect(failureCode(next.thrown)).toBe(code)
      expect((await runCodes()).slice(3)).toEqual([code])
    },
  )

  // However the listing moved, it counts towards the same run of changes: a
  // moved total, then a changed confirmation set, then a moved total again.
  it('counts moves of every kind together towards the third run', async () => {
    listings = [TOTAL_GREW_MID_SCAN, POSTED_MID_RUN, TOTAL_GREW_MID_SCAN]

    const loud = await sync()

    expect(failureCode(loud.thrown)).toBe('total_changed')
    expect(await runCodes()).toEqual([
      'listing_changed',
      'listing_changed',
      'total_changed',
    ])
  })

  it('counts afresh after a completed run', async () => {
    listings = [
      TOTAL_GREW_MID_SCAN,
      TOTAL_GREW_MID_SCAN,
      steady([first, second, posted]),
      TOTAL_GREW_MID_SCAN,
      steady([first, second, posted]),
    ]

    // Two moves, then a run that holds still.
    const earlier = await sync()
    expect(earlier.thrown).toBeNull()
    expect(earlier.outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect(await runCodes()).toEqual(['listing_changed', 'listing_changed', 'completed'])

    // The next poll's first move is quiet again: the two before it do not count.
    const later = await sync()
    expect(later.thrown).toBeNull()
    expect(later.outcomes.at(-1)).toMatchObject({ status: 'completed' })
    expect((await runCodes()).slice(3)).toEqual(['listing_changed', 'completed'])
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
  })

  // The same review twice on ONE page is Google's page being broken, not the
  // listing moving between requests: it never restarts quietly.
  it('fails loudly at once when a single page lists a review twice', async () => {
    listings = [mainOnly(page([first, first], 2))]

    const loud = await sync()

    expect(failureCode(loud.thrown)).toBe('duplicate_resource')
    expect(await runCodes()).toEqual(['duplicate_resource'])
    expect(queued).toEqual([])
    expect(discoveryRepo.markDiscoveryDeferred).toHaveBeenCalledWith(
      PROPERTY,
      expect.any(Date),
      expect.any(Date),
      'duplicate_resource',
    )
  })

  // The store counts what the runs ended with: moves of every kind, and a
  // stored `total_changed` from before runs of this kind restarted quietly.
  it('counts earlier runs of every kind and is broken by any other failure', async () => {
    const failedRun = async (
      code:
        | 'total_changed'
        | 'average_changed'
        | 'set_mismatch'
        | 'confirmation_set_changed'
        | 'duplicate_resource',
    ) => {
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

    await expect(failedRun('total_changed')).resolves.toBe('listing_changed')
    await expect(failedRun('average_changed')).resolves.toBe('listing_changed')
    await expect(failedRun('confirmation_set_changed')).resolves.toBe(
      'confirmation_set_changed',
    )
    await expect(failedRun('total_changed')).resolves.toBe('total_changed')
    // Another failure ends the run of changes; the next change is quiet again.
    await expect(failedRun('set_mismatch')).resolves.toBe('set_mismatch')
    await expect(failedRun('average_changed')).resolves.toBe('listing_changed')
  })

  it('records a duplicate resource asked for outright as itself, whatever came before', async () => {
    const failedRun = async (code: 'duplicate_resource' | 'set_mismatch') => {
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

    await expect(failedRun('duplicate_resource')).resolves.toBe('duplicate_resource')
    await expect(failedRun('set_mismatch')).resolves.toBe('set_mismatch')
    await expect(failedRun('duplicate_resource')).resolves.toBe('duplicate_resource')
  })

  // The first import is the only sync a person waits for. A moved total
  // restarts it as an import and tells nobody: the run that failed says so as a
  // temporary failure, which Feed ignores, and the fresh run completes.
  it('keeps a first import an import across the restart and ends it as completed', async () => {
    listings = [TOTAL_GREW_MID_SCAN, steady([first, second, posted])]
    const initiator = {
      kind: 'system' as const,
      id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
    }

    const { thrown, outcomes } = await sync({ ...SYNC, initiator })

    expect(thrown).toBeNull()
    expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
    const origins = await db.execute(sql`
      SELECT observation_origin, failure_code FROM review_provider_snapshot_runs
      WHERE organization_id = ${ORG} ORDER BY started_at
    `)
    expect(origins.rows).toEqual([
      { observation_origin: 'historical_onboarding', failure_code: 'listing_changed' },
      { observation_origin: 'historical_onboarding', failure_code: null },
    ])
    const facts = await db.execute(sql`
      SELECT payload->>'outcome' AS outcome, payload->>'failureReason' AS reason
      FROM outbox_events
      WHERE event_type = 'review.property_history_import.finished'
        AND organization_id = ${ORG}
      ORDER BY created_at, id
    `)
    expect(facts.rows).toEqual([
      { outcome: 'failed', reason: 'temporary' },
      { outcome: 'completed', reason: null },
    ])
  })
})
