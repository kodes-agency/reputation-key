import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
// A review that a head check or a push stored, and no full listing ever saw,
// deleted on Google — against real PostgreSQL.
//
// Only a review with a provider subject mapping can be removed when Google
// deletes it. A full listing maps every review it lists; a head check and a
// push map the reviews they store. Removal still takes the same evidence as
// for a listed review: two listings that agree with Google's total, at least
// 15 minutes apart, both without it, and then a direct read that finds it
// gone.
//
// These tests drive the real sync job handler, snapshot use case and
// repository, head check, targeted push fetch and Review observation writer
// with a fake Google.

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
import { createRunReviewHeadCheck } from '../application/use-cases/run-review-head-check'
import { runTargetedGoogleReviewFetch } from '../application/use-cases/run-targeted-google-review-fetch'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createSyncPropertyReviewsHandler } from './jobs/sync-property-reviews.job'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewFirstSightingRecorder } from './repositories/review-first-sighting.repository'
import { createReviewHeadCheckRepository } from './repositories/review-head-check.repository'
import { createReviewProviderSnapshotRepository } from './repositories/review-provider-snapshot.repository'
import { createReviewProviderSubjectSightings } from './repositories/review-provider-subject-link'
import { createReviewRepository } from './repositories/review.repository'
import { createReviewSyncActivityRecorder } from './repositories/review-sync-activity.repository'

const ORG = organizationId('review-unlisted-deletion-org')
const PROPERTY = propertyId('76000000-0000-4000-8000-00000000a001')
const CONNECTION = googleConnectionId('76000000-0000-4000-8000-00000000c001')
const ACCOUNT = 'unlisted-deletion-account'
const LOCATION = `accounts/${ACCOUNT}/locations/location-a001`
const TEST_KEY_VERSION = 'unlisted-deletion-test-v1'
const TEST_KEY = new Uint8Array(32).fill(11)
const PUBLISHED = new Date('2025-06-01T09:00:00.000Z')
const MAX_STEPS = 40

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

const subjectSightings = createReviewProviderSubjectSightings(db, logger)

/** What Google lists for every run, as one page that agrees with its total. */
let listed: readonly GoogleReview[] = []
/** What Google's newest page shows a head check. */
let headPage: readonly GoogleReview[] = []
/** The reviews a direct read finds on Google. Everything else is gone. */
let readable: readonly GoogleReview[] = []

const listing = (reviews: readonly GoogleReview[]): GoogleReviewPage => ({
  reviews,
  totalReviewCount: reviews.length,
  averageRating: 5,
  nextCursorRef: null,
})

const googleReviewApi: GoogleReviewApiPort = {
  listReviewsPage: vi.fn(async () => listing(listed)),
  readReviewsHead: vi.fn(async () => ({
    status: 'ok' as const,
    reviews: headPage,
    totalReviewCount: headPage.length,
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
  hotIntervalMs: 15 * 60 * 1000,
})

const SYNC: SyncPropertyReviewsJobData = {
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONNECTION,
  locationName: LOCATION,
  initiator: { kind: 'system', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
}

/** One full sync as the worker runs it, step after step, until none is left. */
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

const headCheck = createRunReviewHeadCheck({
  googleReviewApi,
  repository: createReviewHeadCheckRepository(db),
  logger,
  clock: () => new Date(),
  persist: {
    observationWriter,
    subjectKeyService,
    subjectSightings,
    propertySourceEpoch,
    syncActivity: createReviewSyncActivityRecorder(db),
    newId: () => crypto.randomUUID(),
  },
})

/** The targeted read a Google push triggers: Google answers with `review`. */
const push = (review: GoogleReview) =>
  runTargetedGoogleReviewFetch({
    references: {
      resolve: async () => ({
        status: 'found' as const,
        locationName: LOCATION,
        reviewName: review.reviewName,
      }),
    },
    googleReviewApi: {
      ...googleReviewApi,
      getReview: vi.fn(async () => ({ status: 'found' as const, review })),
    },
    propertySourceEpoch,
    observationWriter,
    subjectKeyService,
    subjectSightings,
    syncActivity: quietActivity,
    firstSightings: createReviewFirstSightingRecorder(db),
    clock: () => new Date(),
  })({
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: 0,
    referenceRef: 'v1.reference',
    deliveryId: crypto.randomUUID(),
    acceptedAt: new Date(),
    notificationKind: 'NEW_REVIEW',
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

const first = guestReview('unlisted-first')
const second = guestReview('unlisted-second')
const unlisted = guestReview('unlisted-stored-outside-a-listing')

/** The stored Review's id, read while its content is still there. */
async function storedIdOf(review: GoogleReview): Promise<string> {
  const result = await db.execute(sql`
    SELECT review_id FROM review_source_contents
    WHERE organization_id = ${ORG} AND external_id = ${review.externalId}
  `)
  const id = result.rows[0]?.review_id
  if (typeof id !== 'string') throw new Error('The review was not stored')
  return id
}

async function subjectOf(id: string) {
  const result = await db.execute(sql`
    SELECT state, last_seen_snapshot_run_id,
           first_missing_snapshot_run_id IS NOT NULL AS missed
    FROM review_provider_subjects
    WHERE organization_id = ${ORG} AND review_id = ${id}
  `)
  return result.rows[0]
}

async function sourceStateOf(id: string): Promise<unknown> {
  const result = await db.execute(sql`
    SELECT source_content_state FROM reviews
    WHERE organization_id = ${ORG} AND id = ${id}
  `)
  return result.rows[0]?.source_content_state
}

/** The first miss as if the listing that recorded it ran 16 minutes ago. */
async function ageFirstMiss(): Promise<void> {
  await db.execute(sql`
    UPDATE review_provider_subjects
    SET first_missing_at = first_missing_at - interval '16 minutes'
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
    VALUES (${ORG}, 'Unlisted deletion test', ${ORG}, now())
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
        (${TEST_KEY_VERSION}, ${'b'.repeat(64)}, 'active', 999995,
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
      ${CONNECTION}, ${ORG}, 'unlisted-deletion-subject', 'sealed-access',
      'sealed-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], 'unlisted-deletion-user',
      'organization', 'active'
    )
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
    VALUES (${PROPERTY}, ${ORG}, 'Unlisted deletion property', 'unlisted-deletion', 'UTC', 0)
  `)
  readable = []
  headPage = []
  vi.mocked(googleReviewApi.getReview).mockClear()
  // A completed listing of the Property, as every head check needs.
  listed = [first, second]
  await expect(sync()).resolves.toMatchObject({ status: 'completed' })
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

const storedBy = {
  'a persisting head check': async (review: GoogleReview) => {
    headPage = [review, first, second]
    const checked = await headCheck({
      organizationId: ORG,
      propertyId: PROPERTY,
      connectionId: CONNECTION,
      sourceEpoch: 0,
      locationName: LOCATION,
      mode: 'persist',
    })
    expect(checked).toMatchObject({ persistence: { outcome: 'stored', storedNew: 1 } })
  },
  'a Google push': async (review: GoogleReview) => {
    await expect(push(review)).resolves.toMatchObject({
      status: 'persisted',
      isNew: true,
    })
  },
} as const

describe.each(Object.keys(storedBy) as (keyof typeof storedBy)[])(
  'a review stored by %s and never listed (real PostgreSQL)',
  (via) => {
    it('is removed once two listings and a direct read agree it is gone, and not before', async () => {
      await storedBy[via](unlisted)
      const id = await storedIdOf(unlisted)
      const listedId = await storedIdOf(first)
      expect(await subjectOf(id)).toEqual({
        state: 'linked',
        last_seen_snapshot_run_id: null,
        missed: false,
      })

      // The first listing without it only records the miss.
      await expect(sync()).resolves.toMatchObject({ status: 'completed' })
      expect(await subjectOf(id)).toMatchObject({ missed: true })
      expect(await sourceStateOf(id)).toBe('active')
      expect(directReadsOf(unlisted)).toBe(0)

      // A second listing at least 15 minutes later, then a direct read that
      // finds it gone: one reviews.get for the one candidate.
      await ageFirstMiss()
      await expect(sync()).resolves.toMatchObject({ status: 'completed' })
      expect(directReadsOf(unlisted)).toBe(1)
      expect(await sourceStateOf(id)).toBe('provider_deleted')
      expect(await subjectOf(id)).toMatchObject({ state: 'provider_deleted' })
      expect(await sourceStateOf(listedId)).toBe('active')
    })

    it('is kept when the direct read still finds it on Google', async () => {
      await storedBy[via](unlisted)
      const id = await storedIdOf(unlisted)
      await expect(sync()).resolves.toMatchObject({ status: 'completed' })
      await ageFirstMiss()

      readable = [unlisted]
      await sync()

      expect(directReadsOf(unlisted)).toBe(1)
      expect(await sourceStateOf(id)).toBe('active')
      expect(await subjectOf(id)).toMatchObject({ state: 'linked' })
    })
  },
)
