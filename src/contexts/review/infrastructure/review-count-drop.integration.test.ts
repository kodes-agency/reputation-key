import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
// A review deleted on Google, reached through the head check's count alarm and
// a listing's first miss — against real PostgreSQL.
//
// Google's newest page never shows a deletion. Two things bring the listings
// that can remove a deleted review forward, each spaced by the discovery
// sweep to at most one per six hours: a head check that sees Google's total
// below the stored count for 15 minutes asks for a full read, and a listing
// that records a first miss asks for the listing that can confirm it. Removal
// still takes two listings that agree with Google's total, at least 15 minutes
// apart, and a direct read that finds the review gone.
//
// These tests drive the real sync job handler, snapshot use case and
// repository, head check and its repository with a fake Google, and ask the
// pure discovery rule what the sweep would do with the stored request.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { readSyncPushHealth } from '#/shared/db/sync-push-health'
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
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleReview } from '../domain/types'
import { discoveryLookFor } from '../domain/discovery-reconciliation'
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
import { createRunReviewHeadCheck } from '../application/use-cases/run-review-head-check'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createSyncPropertyReviewsHandler } from './jobs/sync-property-reviews.job'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewHeadCheckRepository } from './repositories/review-head-check.repository'
import { createReviewProviderSnapshotRepository } from './repositories/review-provider-snapshot.repository'
import { createReviewRepository } from './repositories/review.repository'

const ORG = organizationId('review-count-drop-org')
const PROPERTY = propertyId('77000000-0000-4000-8000-00000000a001')
const CONNECTION = googleConnectionId('77000000-0000-4000-8000-00000000c001')
const LOCATION = GOOGLE_LOCATION_PRIMARY_RESOURCE
const TEST_KEY_VERSION = 'count-drop-test-v1'
const TEST_KEY = new Uint8Array(32).fill(13)
const PUBLISHED = new Date('2025-06-01T09:00:00.000Z')
const MAX_STEPS = 40
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
/** The widest window: without the requests, a deletion would wait for it. */
const FOURTEEN_DAYS_MS = 336 * HOUR_MS

const db = getDb()
let activeKeyVersion = TEST_KEY_VERSION
let insertedTestKey = false

const snapshotRepository = createReviewProviderSnapshotRepository(
  db,
  () => crypto.randomUUID(),
  replyScopeEffects,
)

const observationWriter = createReviewProviderObservationWriter({
  reviewRepo: createReviewRepository(db, () => new Date(), undefined, replyScopeEffects),
  clock: () => new Date(),
  idGen: () => reviewId(crypto.randomUUID()),
  commandStore: createAtomicReviewCommandStore(
    db,
    () => new Date(),
    undefined,
    undefined,
    replyScopeEffects,
  ),
  googleReplyObservationStore: createGoogleReplyObservationStore(db),
  historyCutoffs: snapshotRepository,
})

const logger: LoggerPort = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => logger,
}

/** What Google's list shows, every page of it and its newest page alike. */
let listed: readonly GoogleReview[] = []
/** Google's own total, which it updates apart from its list. */
let googleTotal = 0
/** A confirmation scan that lists something else, once: the listing moved. */
let movedConfirmation: GoogleReviewPage | null = null
/** The reviews a direct read finds on Google. Everything else is gone. */
let readable: readonly GoogleReview[] = []

const listing = (): GoogleReviewPage => ({
  reviews: listed,
  totalReviewCount: googleTotal,
  averageRating: 5,
  nextCursorRef: null,
})

const googleReviewApi: GoogleReviewApiPort = {
  listReviewsPage: vi.fn(async ({ phase }) => {
    const moved = phase === 'confirmation' ? movedConfirmation : null
    if (moved === null) return listing()
    movedConfirmation = null
    return moved
  }),
  readReviewsHead: vi.fn(async () => ({
    status: 'ok' as const,
    reviews: listed,
    totalReviewCount: googleTotal,
    averageRating: 5,
    hasMore: false,
  })),
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

const propertySourceEpoch = { getSourceEpoch: async () => ({ sourceEpoch: 0 }) }
const quietActivity = {
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
    subjectKeyService,
    syncActivity: quietActivity,
    clock: () => new Date(),
    logger,
  }),
  propertySourceEpoch,
  enqueueContinuation: async (data) => {
    queued.push(data)
  },
  syncActivity: quietActivity,
  discoveryRepo: {
    markDiscoveryDeferred: vi.fn(async () => undefined),
    findFailureState: vi.fn(async () => null),
    markSyncSucceeded: vi.fn(async () => undefined),
  },
  clock: () => new Date(),
  hotIntervalMs: 15 * MINUTE_MS,
})

const SYNC: SyncPropertyReviewsJobData = {
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONNECTION,
  locationName: LOCATION,
  initiator: { kind: 'system', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
}

/** One full read as the worker runs it, step after step, until none is left. */
async function sync(): Promise<unknown> {
  queued = [SYNC]
  let last: unknown = null
  for (let steps = 0; queued.length > 0; steps += 1) {
    if (steps === MAX_STEPS) throw new Error('The sync never settled')
    const data = queued.shift()
    last = await handler({ id: `step-${steps}`, data } as never)
  }
  return last
}

/** A dark head check: it stores no review, and still watches Google's total. */
const headCheck = () =>
  createRunReviewHeadCheck({
    googleReviewApi,
    repository: createReviewHeadCheckRepository(db),
    logger,
    clock: () => new Date(),
  })({
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: 0,
    locationName: LOCATION,
    mode: 'dark',
  })

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

const first = guestReview('count-drop-first')
const second = guestReview('count-drop-second')
const deleted = guestReview('count-drop-deleted')

async function storedIdOf(review: GoogleReview): Promise<string> {
  const result = await db.execute(sql`
    SELECT review_id FROM review_source_contents
    WHERE organization_id = ${ORG} AND external_id = ${review.externalId}
  `)
  const id = result.rows[0]?.review_id
  if (typeof id !== 'string') throw new Error('The review was not stored')
  return id
}

async function sourceStateOf(id: string): Promise<unknown> {
  const result = await db.execute(sql`
    SELECT source_content_state FROM reviews
    WHERE organization_id = ${ORG} AND id = ${id}
  `)
  return result.rows[0]?.source_content_state
}

async function missedOf(id: string): Promise<unknown> {
  const result = await db.execute(sql`
    SELECT first_missing_snapshot_run_id IS NOT NULL AS missed
    FROM review_provider_subjects
    WHERE organization_id = ${ORG} AND review_id = ${id}
  `)
  return result.rows[0]?.missed
}

const asDate = (value: unknown): Date | null =>
  value == null ? null : new Date(value as string | Date)

/** The discovery row's stamps and the newest completed listing. */
async function syncState() {
  const state = await db.execute(sql`
    SELECT full_read_requested_at, count_drop_seen_at, count_drop_checked_at
    FROM review_sync_state WHERE property_id = ${PROPERTY} AND source = 'google'
  `)
  const fact = await db.execute(sql`
    SELECT max(evaluated_at) AS listed_at
    FROM review_google_reputation_snapshot_facts
    WHERE organization_id = ${ORG} AND property_id = ${PROPERTY}
      AND source_epoch = 0 AND listing_complete
  `)
  return {
    requestedAt: asDate(state.rows[0]?.full_read_requested_at),
    dropSeenAt: asDate(state.rows[0]?.count_drop_seen_at),
    dropCheckedAt: asDate(state.rows[0]?.count_drop_checked_at),
    listedAt: asDate(fact.rows[0]?.listed_at),
  }
}

/**
 * What the discovery sweep decides this long after the last listing, at the
 * widest window, for a Property a head check keeps covered.
 */
async function lookAfter(sinceListingMs: number) {
  const { listedAt, requestedAt } = await syncState()
  if (listedAt === null) throw new Error('No completed listing')
  const now = new Date(listedAt.getTime() + sinceListingMs)
  return discoveryLookFor({
    lastReconciledAt: listedAt,
    hasOutstandingFailure: false,
    skipEnabled: true,
    headChecks: true,
    reconcileWithinMs: FOURTEEN_DAYS_MS,
    headCoveredAt: new Date(now.getTime() - MINUTE_MS),
    fullReadRequestedAt: requestedAt,
    now,
    interval: 15 * MINUTE_MS,
  })
}

/** Time passes: the listings, the drop and the first misses all happened earlier. */
async function elapse(ms: number): Promise<void> {
  const seconds = ms / 1000
  await db.execute(sql`
    UPDATE review_google_reputation_snapshot_facts
    SET evaluated_at = evaluated_at - (${seconds} * interval '1 second')
    WHERE organization_id = ${ORG}
  `)
  await db.execute(sql`
    UPDATE review_sync_state
    SET count_drop_seen_at = count_drop_seen_at - (${seconds} * interval '1 second'),
        count_drop_checked_at = count_drop_checked_at - (${seconds} * interval '1 second'),
        full_read_requested_at = full_read_requested_at - (${seconds} * interval '1 second')
    WHERE property_id = ${PROPERTY}
  `)
  await db.execute(sql`
    UPDATE review_provider_subjects
    SET first_missing_at = first_missing_at - (${seconds} * interval '1 second')
    WHERE organization_id = ${ORG} AND first_missing_at IS NOT NULL
  `)
}

const directReadsOf = (review: GoogleReview): number =>
  vi
    .mocked(googleReviewApi.getReview)
    .mock.calls.filter(([request]) => request.reviewName === review.reviewName).length

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
  await db.execute(
    sql`DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM review_sync_runs WHERE property_id = ${PROPERTY}`)
  await db.execute(sql`DELETE FROM review_sync_state WHERE property_id = ${PROPERTY}`)
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
    VALUES (${ORG}, 'Count drop test', ${ORG}, now())
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
        (${TEST_KEY_VERSION}, ${'c'.repeat(64)}, 'active', 999994,
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
      ${CONNECTION}, ${ORG}, 'count-drop-subject', 'sealed-access',
      'sealed-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], 'count-drop-user',
      'organization', 'active'
    )
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
    VALUES (${PROPERTY}, ${ORG}, 'Count drop property', 'count-drop', 'UTC', 0)
  `)
  // The discovery sweep has looked at the Property: it has its row.
  await db.execute(sql`
    INSERT INTO review_sync_state (property_id, source, next_incremental_at)
    VALUES (${PROPERTY}, 'google', now())
  `)
  readable = []
  movedConfirmation = null
  vi.mocked(googleReviewApi.getReview).mockClear()
  listed = [deleted, first, second]
  googleTotal = 3
  await expect(sync()).resolves.toMatchObject({ status: 'completed' })
  // A listing that missed nothing asks for nothing.
  expect((await syncState()).requestedAt).toBeNull()
  await elapse(HOUR_MS)
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

describe('a listing that records a first miss (real PostgreSQL)', () => {
  it('asks for the confirming listing six hours later, which removes the review, and asks nothing more', async () => {
    const id = await storedIdOf(deleted)
    listed = [first, second]
    googleTotal = 2

    await expect(sync()).resolves.toMatchObject({ status: 'completed' })

    const missed = await syncState()
    expect(await missedOf(id)).toBe(true)
    expect(missed.requestedAt).toEqual(missed.listedAt)
    expect((await lookAfter(6 * HOUR_MS - 15 * MINUTE_MS - 1)).kind).toBe('skip')
    expect(await lookAfter(6 * HOUR_MS)).toEqual({ kind: 'full', reason: 'requested' })

    await elapse(6 * HOUR_MS)
    await expect(sync()).resolves.toMatchObject({ status: 'completed' })

    expect(directReadsOf(deleted)).toBe(1)
    expect(await sourceStateOf(id)).toBe('provider_deleted')
    // The request was spent by that listing, which missed nothing new and
    // asked for nothing.
    const confirmed = await syncState()
    expect(confirmed.requestedAt?.getTime()).toBe(
      (missed.requestedAt?.getTime() ?? 0) - 6 * HOUR_MS,
    )
    expect(confirmed.requestedAt?.getTime()).toBeLessThan(
      confirmed.listedAt?.getTime() ?? 0,
    )
    expect((await lookAfter(6 * HOUR_MS)).kind).toBe('skip')
  })

  it('still asks when the run that recorded the miss fails after its scan and a restart completes', async () => {
    const id = await storedIdOf(deleted)
    listed = [first, second]
    googleTotal = 2
    // The confirmation scan sees a review gone that the main scan listed, so
    // the run that recorded the first miss ends as a listing that moved and a
    // fresh run completes in its place.
    movedConfirmation = { ...listing(), reviews: [first] }

    await expect(sync()).resolves.toMatchObject({ status: 'completed' })

    const runs = await db.execute(sql`
      SELECT state FROM review_provider_snapshot_runs
      WHERE organization_id = ${ORG} ORDER BY started_at
    `)
    expect(runs.rows.map((row) => row.state)).toEqual([
      'completed',
      'failed',
      'completed',
    ])
    expect(await missedOf(id)).toBe(true)
    const missed = await syncState()
    expect(missed.requestedAt).toEqual(missed.listedAt)
    expect(await lookAfter(6 * HOUR_MS)).toEqual({ kind: 'full', reason: 'requested' })

    // The confirming listing removes the review and asks nothing more.
    await elapse(6 * HOUR_MS)
    await expect(sync()).resolves.toMatchObject({ status: 'completed' })
    expect(await sourceStateOf(id)).toBe('provider_deleted')
    expect((await lookAfter(6 * HOUR_MS)).kind).toBe('skip')
  })
})

describe('a stale count-drop stamp on a Property no head check reaches (real PostgreSQL)', () => {
  it('clears on the next listing that leaves the counts level and raises no alert', async () => {
    // Syncable, so the count-drop alert would count it.
    await db.execute(sql`
      UPDATE properties
      SET google_connection_id = ${CONNECTION}, gbp_account_id = 'count-drop-account',
          gbp_location_id = 'count-drop-location', google_binding_state = 'active'
      WHERE id = ${PROPERTY}
    `)
    const baseline = (await readSyncPushHealth(db, false, 6)).countDrop.persistentCount
    // One check saw a drop 80 hours ago; every look since was a full listing.
    await db.execute(sql`
      UPDATE review_sync_state
      SET count_drop_seen_at = now() - interval '80 hours',
          count_drop_checked_at = now() - interval '80 hours'
      WHERE property_id = ${PROPERTY}
    `)

    expect((await readSyncPushHealth(db, false, 6)).countDrop.persistentCount).toBe(
      baseline,
    )

    await expect(sync()).resolves.toMatchObject({ status: 'completed' })

    const after = await syncState()
    expect(after.dropSeenAt).toBeNull()
    expect(after.dropCheckedAt).toBeNull()
    expect((await readSyncPushHealth(db, false, 6)).countDrop.persistentCount).toBe(
      baseline,
    )
  })

  it('keeps the stamp while the listing still leaves Google’s total below the stored count', async () => {
    googleTotal = 2
    await headCheck()

    await expect(sync()).resolves.toMatchObject({ status: 'completed' })

    expect((await syncState()).dropSeenAt).not.toBeNull()
  })
})

describe('a deletion Google counts at once and lists 13 hours late (real PostgreSQL)', () => {
  it('is removed by the listing the first miss asks for once the list catches up, and the alarm then clears', async () => {
    const id = await storedIdOf(deleted)
    googleTotal = 2

    // The first check only stamps the drop.
    await expect(headCheck()).resolves.toMatchObject({
      comparison: { totalDifference: -1 },
    })
    const seen = await syncState()
    expect(seen.dropSeenAt).not.toBeNull()
    expect(seen.requestedAt).toBeNull()

    // A check 15 minutes later confirms it and asks for a full read, which
    // the sweep runs once the last listing is six hours old.
    await elapse(15 * MINUTE_MS)
    await headCheck()
    expect((await syncState()).requestedAt).not.toBeNull()
    expect((await lookAfter(5 * HOUR_MS)).kind).toBe('skip')
    expect(await lookAfter(6 * HOUR_MS)).toEqual({ kind: 'full', reason: 'requested' })

    // The first alarm read: Google still lists the review, so its list
    // disagrees with its total. The count gap records no miss and removes
    // nothing, and no direct read is spent.
    await elapse(5 * HOUR_MS)
    await expect(sync()).resolves.toMatchObject({ status: 'completed' })
    expect(await missedOf(id)).toBe(false)
    expect(await sourceStateOf(id)).toBe('active')
    expect(directReadsOf(deleted)).toBe(0)

    // The request is spent; the drop is still there, so the next check asks again.
    expect((await lookAfter(6 * HOUR_MS)).kind).toBe('skip')
    await elapse(15 * MINUTE_MS)
    await headCheck()
    expect(await lookAfter(6 * HOUR_MS)).toEqual({ kind: 'full', reason: 'requested' })

    // Thirteen hours after the deletion Google's list catches up. The second
    // alarm read agrees with the total and records the first miss, which asks
    // for the listing that can confirm it.
    await elapse(6 * HOUR_MS)
    listed = [first, second]
    await expect(sync()).resolves.toMatchObject({ status: 'completed' })
    expect(await missedOf(id)).toBe(true)
    expect(await sourceStateOf(id)).toBe('active')
    expect(await lookAfter(6 * HOUR_MS)).toEqual({ kind: 'full', reason: 'requested' })

    await elapse(6 * HOUR_MS)
    await expect(sync()).resolves.toMatchObject({ status: 'completed' })
    expect(directReadsOf(deleted)).toBe(1)
    expect(await sourceStateOf(id)).toBe('provider_deleted')

    // The counts are level again: the next check clears the drop.
    await headCheck()
    expect((await syncState()).dropSeenAt).toBeNull()
  })

  it('removes nothing on the count alone while the list keeps the review', async () => {
    const id = await storedIdOf(deleted)
    googleTotal = 2
    await headCheck()

    for (let read = 0; read < 3; read += 1) {
      await elapse(6 * HOUR_MS)
      await headCheck()
      await expect(sync()).resolves.toMatchObject({ status: 'completed' })
    }

    expect(await missedOf(id)).toBe(false)
    expect(await sourceStateOf(id)).toBe('active')
    expect(directReadsOf(deleted)).toBe(0)
    expect((await syncState()).dropSeenAt).not.toBeNull()
  })

  it('stops asking for full reads 72 hours after the first sighting', async () => {
    googleTotal = 2
    await headCheck()
    await elapse(72 * HOUR_MS)
    const before = await syncState()

    await expect(headCheck()).resolves.toMatchObject({
      comparison: { totalDifference: -1 },
    })

    const after = await syncState()
    expect(after.requestedAt).toEqual(before.requestedAt)
    expect(after.dropSeenAt).toEqual(before.dropSeenAt)
    expect((await lookAfter(80 * HOUR_MS)).kind).toBe('skip')
  })
})
