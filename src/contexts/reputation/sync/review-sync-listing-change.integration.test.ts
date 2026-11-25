// A Google listing that changes between a snapshot run's two scans, against
// real PostgreSQL.
//
// A snapshot run lists a location twice, and the second (confirmation) listing
// must return exactly the reviews the first did before the run may remove
// anything. On the largest beta location (3,714 reviews, 75 pages, about three
// minutes a listing) one run in 189 saw `confirmation_set_changed`: a guest
// most likely posted while the run was between its two listings. The next run
// completes, so the changed one must not become a Sentry error, an alert, a
// dead letter or a repair latch.
//
// These tests drive the real sync job handler, snapshot use case, snapshot
// repository and Review observation writer with a fake Google listing. They
// prove that one change ends the run as `listing_changed` with a fresh run
// queued and no failure, that a listing that keeps changing is loud again, and
// that a run whose listing changed removes nothing.
//
// The same holds when the listing moves while a scan is still reading its
// pages: Google's total (or average) differing from page to page, or one
// review on two pages. On the largest beta location (75 pages, about 15 minutes
// a run) guests posting while it was listing caused `total_changed` at page 7
// and at page 65 in two runs in a row; the runs after them completed.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { GoogleReview } from '../domain/review-types'
import type { GoogleReviewPage } from './google-review-api.port.server'
import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
  type SyncPropertyReviewsJobData,
} from './review-queue.port.server'
import { runReviewProviderSnapshot } from './run-review-provider-snapshot.server'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews-job.server'
import { googleReviewFixture, googleReviewPage } from './google-review.test-fixtures'
import {
  clearReviewSnapshotData,
  createFakeGoogleReviewApi,
  createSnapshotWriter,
  createSpyLogger,
  createSubjectKeyHarness,
  insertTestOrganization,
  insertTestProperty,
  seedSnapshotConnection,
} from './review-snapshot-harness.test-fixtures'

const ORG = organizationId('review-listing-change-org')
const PROPERTY = propertyId('75000000-0000-4000-8000-00000000a001')
const CONNECTION = googleConnectionId('75000000-0000-4000-8000-00000000c001')
const ACCOUNT = 'listing-change-account'
const LOCATION = `accounts/${ACCOUNT}/locations/location-a001`
const TEST_KEY_VERSION = 'listing-change-test-v1'
const PUBLISHED = new Date('2025-06-01T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
/** A worker steps a run one page at a time; no scenario here needs more. */
const MAX_STEPS = 40

const db = getDb()
const { snapshotRepository, writer: observationWriter } = createSnapshotWriter(db, {
  clock: () => new Date(),
})
const subjectKeys = createSubjectKeyHarness(db, {
  version: TEST_KEY_VERSION,
  byte: 9,
  generation: 999997,
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

const googleReviewApi = createFakeGoogleReviewApi({
  listReviewsPage: vi.fn(async ({ runId, phase, pageIndex }) => {
    if (!runOrder.includes(runId)) runOrder.push(runId)
    const listing = listings[Math.min(runOrder.indexOf(runId), listings.length - 1)]
    if (!listing) throw new Error('No listing for this run')
    const scan = phase === 'main' ? listing.main : listing.confirmation
    const found = 'reviews' in scan ? scan : scan[pageIndex]
    if (!found) throw new Error('No such page in this listing')
    return found
  }),
  getReview: vi.fn(async ({ reviewName }) => {
    const found = readable.find((review) => review.reviewName === reviewName)
    return found
      ? { status: 'found' as const, review: found }
      : { status: 'not_found' as const }
  }),
})

const logger = createSpyLogger()

const propertySourceEpoch = { getSourceEpoch: async () => ({ sourceEpoch: 0 }) }

const discoveryRepo = {
  markDiscoveryDeferred: vi.fn(async () => undefined),
  findFailureState: vi.fn(async () => null),
  markSyncSucceeded: vi.fn(async () => undefined),
}

const syncActivity = {
  recordNewReviewObserved: vi.fn(async () => undefined),
  recordPushObserved: vi.fn(async () => undefined),
}

let queued: SyncPropertyReviewsJobData[] = []

const handler = createSyncPropertyReviewsHandler({
  runSnapshot: runReviewProviderSnapshot({
    repository: snapshotRepository,
    googleReviewApi,
    propertySourceEpoch,
    observationWriter,
    subjectKeyService: subjectKeys.service,
    syncActivity,
    clock: () => new Date(),
    logger,
  }),
  propertySourceEpoch,
  enqueueContinuation: async (data) => {
    queued.push(data)
  },
  syncActivity,
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

function expectCompleted({ outcomes, thrown }: Sync): void {
  expect(thrown).toBeNull()
  expect(outcomes.at(-1)).toMatchObject({ status: 'completed' })
}

/** The run ended failed as `listing_changed` and no step failed the job. */
function expectChangedRun({ outcomes, thrown }: Sync): void {
  expect(thrown).toBeNull()
  expect(outcomes.at(-1)).toMatchObject({ status: 'failed', code: 'listing_changed' })
}

/** One sync as the worker runs it, from its first step. */
function sync(start: SyncPropertyReviewsJobData = SYNC): Promise<Sync> {
  queued = [start]
  return drain()
}

const guestReview = (slug: string): GoogleReview =>
  googleReviewFixture({ location: LOCATION, slug, publishedAt: PUBLISHED, rating: 5 })

/** A cursor the snapshot tables accept; the fake listing ignores its value. */
const NEXT_PAGE = `v1.${'A'.repeat(43)}`

const page = (
  reviews: readonly GoogleReview[],
  total: number,
  nextCursorRef: string | null = null,
  averageRating = 5,
): GoogleReviewPage => googleReviewPage(reviews, total, nextCursorRef, averageRating)

/** Google lists `reviews` twice over, as it counts them. */
const steady = (reviews: readonly GoogleReview[]): Listing => ({
  main: page(reviews, reviews.length),
  confirmation: page(reviews, reviews.length),
})

const first = guestReview('listing-change-first')
const second = guestReview('listing-change-second')
const posted = guestReview('listing-change-posted')
const hidden = guestReview('listing-change-hidden')

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
    SELECT r.source_content_state, c.text FROM reviews r
    JOIN review_source_contents c ON c.review_id = r.id AND c.organization_id = r.organization_id
      AND c.property_id = r.property_id
    WHERE c.organization_id = ${ORG} AND c.external_id = ${review.externalId}
  `)
  return result.rows[0]
}

const failureCode = (thrown: unknown): unknown =>
  typeof thrown === 'object' && thrown != null && 'failureCode' in thrown
    ? thrown.failureCode
    : thrown

const clear = () => clearReviewSnapshotData(db, ORG)

type FailCode = Parameters<typeof snapshotRepository.failRun>[0]['code']

/** Starts a run of the Property's epoch and fails it with `code`; resolves to
 * the code the store recorded, which says whether it counted as a change. */
async function failRunWith(
  code: FailCode,
  property: typeof PROPERTY = PROPERTY,
  sourceEpoch = 0,
): Promise<string | null | undefined> {
  const run = await snapshotRepository.startOrResume({
    organizationId: ORG,
    propertyId: property,
    sourceEpoch,
    observationOrigin: 'ongoing',
  })
  const failed = await snapshotRepository.failRun({
    runId: run.id,
    organizationId: ORG,
    code,
  })
  return failed.failureCode
}

/** Imports `hidden`, then records that an earlier run missed it two days ago, so
 * the next run that lists it missing again may make it a removal candidate. */
async function importHiddenAfterEarlierMiss(runId = crypto.randomUUID()): Promise<void> {
  listings = [steady([first, second, hidden])]
  await expect(sync()).resolves.toMatchObject({ thrown: null })
  await db.execute(sql`
    UPDATE review_provider_subjects s
    SET first_missing_at = now() - ${`${2 * DAY_MS} milliseconds`}::interval,
        first_missing_snapshot_run_id = ${runId}
    FROM review_source_contents c
    WHERE c.review_id = s.review_id AND c.organization_id = ${ORG}
      AND c.external_id = ${hidden.externalId}
  `)
}

/** A first import, restarted by `listings[0]`, stays an import and ends completed. */
async function expectImportSurvivesRestart(
  restartingListings: readonly Listing[],
): Promise<void> {
  listings = restartingListings
  const initiator = {
    kind: 'system' as const,
    id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
  }

  const { thrown, outcomes } = await sync({ ...SYNC, initiator })

  expectCompleted({ outcomes, thrown })
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
}

const expectHiddenActive = async () =>
  expect(await storedSourceState(hidden)).toMatchObject({
    source_content_state: 'active',
  })

/** The changed run never reached its apply step and cannot be made to. */
async function expectRunCannotApply(runId: string | undefined): Promise<void> {
  await expect(
    snapshotRepository.applyDeletionBatch({ runId: runId ?? '', limit: 100 }),
  ).rejects.toMatchObject({ code: 'snapshot_run_not_deleting' })
}

/** Two quiet restarts, then a loud third, and the next poll is loud at once. */
async function expectLoudOnThirdRun(listing: Listing, code: string): Promise<void> {
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

  // The next poll's run changes again: loud at once, with no quiet restart.
  const next = await sync()
  expect(failureCode(next.thrown)).toBe(code)
  expect((await runCodes()).slice(3)).toEqual([code])
}

beforeAll(async () => {
  await clear()
  await deleteTestOrganizations(db, [ORG])
  await insertTestOrganization(db, ORG, 'Listing change test')
  await subjectKeys.ensureActive()
})

beforeEach(async () => {
  await clear()
  await seedSnapshotConnection(db, {
    id: CONNECTION,
    organizationId: ORG,
    googleSubject: 'listing-change-subject',
    connectedBy: 'listing-change-user',
  })
  await insertTestProperty(db, {
    id: PROPERTY,
    organizationId: ORG,
    name: 'Listing change property',
    slug: 'listing-change',
  })
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
  await subjectKeys.removeInserted()
  await deleteTestOrganizations(db, [ORG])
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

    expectCompleted({ outcomes, thrown })
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
    await expectLoudOnThirdRun(POSTED_MID_RUN, 'confirmation_set_changed')
  })

  it('counts afresh after a completed run, and skips a run lost to a cursor store restart or to a connection waiting for a reconnect', async () => {
    await expect(failRunWith('confirmation_set_changed')).resolves.toBe('listing_changed')
    // A deploy took the next run's cursor: it never got to compare its listings.
    await expect(failRunWith('cursor_lost')).resolves.toBe('cursor_lost')
    // The connection broke under the next one: it never compared its listings.
    await expect(failRunWith('connection_unusable')).resolves.toBe('connection_unusable')
    await expect(failRunWith('confirmation_set_changed')).resolves.toBe('listing_changed')
    await expect(failRunWith('confirmation_set_changed')).resolves.toBe(
      'confirmation_set_changed',
    )

    listings = [steady([first, second])]
    await expect(sync()).resolves.toMatchObject({ thrown: null })

    await expect(failRunWith('confirmation_set_changed')).resolves.toBe('listing_changed')
  })

  // The run had found a stored review missing from Google, confirmed it absent
  // from a listing that agreed with Google's total, and made it a removal
  // candidate. Google then shows it after all: the run removes nothing.
  it('removes nothing on a run whose candidate Google shows again', async () => {
    await importHiddenAfterEarlierMiss()

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
    await expectRunCannotApply(changedRunId)
  })

  // The run is part-way through a confirmation of two pages when the second one
  // shows a review the main listing did not have. Its removal candidate was
  // already confirmed missing, and stays so on a run that is over: only a run
  // whose own two listings agree may remove it.
  it('removes a vanished review only on the fresh run whose listings agree, never on the changed one', async () => {
    await importHiddenAfterEarlierMiss()

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

    expectChangedRun(changed)
    expect(await runCodes()).toEqual(['completed', 'listing_changed'])
    await expectHiddenActive()

    const { outcomes, thrown } = await drain()

    expectCompleted({ outcomes, thrown })
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
    await expectRunCannotApply(changedRunId)

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
      alreadyFailed: { failedAt: expect.any(Date) },
    })
    expect(queued).toEqual([{ ...SYNC, sourceEpoch: 0 }])
    expect(await runCodes()).toEqual(['completed', 'listing_changed', 'completed'])
  })

  // Only the Property's own runs in its own source epoch count: another
  // Property, or the Property's earlier epoch, hitting a changed listing says
  // nothing about this one.
  it('counts only the runs of the same Property and source epoch', async () => {
    const other = propertyId('75000000-0000-4000-8000-00000000a002')
    await insertTestProperty(db, {
      id: other,
      organizationId: ORG,
      name: 'Listing change neighbour',
      slug: 'listing-change-2',
    })
    // The neighbour's three changes and the other epoch's three each count only
    // among themselves; the Property's own epoch starts afresh.
    for (const [property, sourceEpoch] of [
      [other, 0],
      [PROPERTY, 1],
      [PROPERTY, 0],
    ] as const) {
      for (const recorded of [
        'listing_changed',
        'listing_changed',
        'confirmation_set_changed',
      ]) {
        await expect(
          failRunWith('confirmation_set_changed', property, sourceEpoch),
        ).resolves.toBe(recorded)
      }
    }
  })

  // The first import is the only sync a person waits for. Its quiet restart
  // stays an import, and no notice reaches them: the run that failed says so
  // as a temporary failure, which Feed ignores, and the fresh run completes.
  it('keeps a first import an import across the restart and ends it as completed', async () => {
    await expectImportSurvivesRestart([POSTED_MID_RUN, steady([first, second, posted])])
  })
})

/** A listing whose confirmation scan is never reached. */
const mainOnly = (main: Scan): Listing => ({ main, confirmation: page([], 0) })

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
  // A large location can grow between two pages of one scan and end a run as
  // `total_changed`; that must not be a Sentry error, an alert, a dead letter
  // or a repair latch.
  it('restarts the sync at once, without a failure, when the total grows between two pages, and removes nothing', async () => {
    const earlierMiss = crypto.randomUUID()
    await importHiddenAfterEarlierMiss(earlierMiss)

    runOrder = []
    discoveryRepo.markSyncSucceeded.mockClear()
    listings = [TOTAL_GREW_MID_SCAN, steady([first, second, posted, hidden])]
    queued = [SYNC]
    const changed = await drain(true)

    expectChangedRun(changed)
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
      JOIN review_source_contents c ON c.review_id = s.review_id AND c.organization_id = s.organization_id
      WHERE c.organization_id = ${ORG} AND c.external_id = ${hidden.externalId}
    `)
    expect(miss.rows).toEqual([{ first_missing_snapshot_run_id: earlierMiss }])
    await expectHiddenActive()

    const { outcomes, thrown } = await drain()

    expectCompleted({ outcomes, thrown })
    expect(await runCodes()).toEqual(['completed', 'listing_changed', 'completed'])
    expect(discoveryRepo.markSyncSucceeded).toHaveBeenCalledTimes(1)
    await expectHiddenActive()
  })

  it.each([
    [
      'restarts quietly when the total grows while the confirmation scan is reading',
      TOTAL_GREW_MID_CONFIRMATION,
      steady([first, second, posted]),
    ],
    [
      'restarts quietly when only the average moves between two pages',
      AVERAGE_MOVED_MID_SCAN,
      steady([first, second]),
    ],
    [
      'restarts quietly when a review shifts onto the next page of the main scan',
      REVIEW_ON_TWO_PAGES,
      steady([first, second, posted]),
    ],
  ])('%s', async (_title, listing, fresh) => {
    listings = [listing, fresh]

    const { outcomes, thrown } = await sync()

    expectCompleted({ outcomes, thrown })
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
    ({ listing, code }) => expectLoudOnThirdRun(listing, code),
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
    await expect(failRunWith('total_changed')).resolves.toBe('listing_changed')
    await expect(failRunWith('average_changed')).resolves.toBe('listing_changed')
    await expect(failRunWith('confirmation_set_changed')).resolves.toBe(
      'confirmation_set_changed',
    )
    await expect(failRunWith('total_changed')).resolves.toBe('total_changed')
    // Another failure ends the run of changes; the next change is quiet again.
    await expect(failRunWith('set_mismatch')).resolves.toBe('set_mismatch')
    await expect(failRunWith('average_changed')).resolves.toBe('listing_changed')
  })

  it('records a duplicate resource asked for outright as itself, whatever came before', async () => {
    await expect(failRunWith('duplicate_resource')).resolves.toBe('duplicate_resource')
    await expect(failRunWith('set_mismatch')).resolves.toBe('set_mismatch')
    await expect(failRunWith('duplicate_resource')).resolves.toBe('duplicate_resource')
  })

  // The first import is the only sync a person waits for. A moved total
  // restarts it as an import and tells nobody: the run that failed says so as a
  // temporary failure, which Feed ignores, and the fresh run completes.
  it('keeps a first import an import across the restart and ends it as completed', async () => {
    await expectImportSurvivesRestart([
      TOTAL_GREW_MID_SCAN,
      steady([first, second, posted]),
    ])
  })
})
