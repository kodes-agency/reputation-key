// The initial Google import's history cutoff against real PostgreSQL.
//
// A property imported on the live stack produced 260 review notifications and
// 120 overdue-target emails in ten minutes. The import run failed part-way
// (a lock timeout reported as `observation_failed`), the discovery sweep
// finished the listing as an `ongoing` run, and every review it saw first —
// some published in 2012 — became a `measured` target that started at its
// original Google publication time and was overdue before it existed.
//
// The cutoff used to live only inside the import run. These tests drive the
// real snapshot use case, snapshot repository and Review observation writer
// with a fake Google listing and prove that the cutoff outlives the run.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
  type PropertyId,
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
import type { ReviewProviderObservationWriter } from '../application/ports/review-provider-snapshot.repository'
import type { ReviewProviderSubjectKeyService } from '../application/provider-subject-keyring'
import { createReviewProviderObservationWriter } from '../application/use-cases/sync-reviews'
import {
  runReviewProviderSnapshot,
  type RunReviewProviderSnapshotResult,
} from '../application/use-cases/run-review-provider-snapshot'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewProviderSnapshotRepository } from './repositories/review-provider-snapshot.repository'
import { createReviewRepository } from './repositories/review.repository'

const ORG = organizationId('review-history-cutoff-org')
const CONNECTION = googleConnectionId('74000000-0000-4000-8000-00000000c001')
const FAILED_IMPORT_PROPERTY = propertyId('74000000-0000-4000-8000-00000000a001')
const JOINED_IMPORT_PROPERTY = propertyId('74000000-0000-4000-8000-00000000b001')
const COMPLETED_IMPORT_PROPERTY = propertyId('74000000-0000-4000-8000-00000000c002')
const NEVER_IMPORTED_PROPERTY = propertyId('74000000-0000-4000-8000-00000000d001')
const PROPERTIES = [
  FAILED_IMPORT_PROPERTY,
  JOINED_IMPORT_PROPERTY,
  COMPLETED_IMPORT_PROPERTY,
  NEVER_IMPORTED_PROPERTY,
] as const
const ACCOUNT = 'history-cutoff-account'
const TEST_KEY_VERSION = 'history-cutoff-test-v1'
const TEST_KEY = new Uint8Array(32).fill(7)
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Google published these years before any import started. */
const YEARS_AGO = new Date('2019-05-01T09:00:00.000Z')
const LAST_YEAR = new Date('2025-06-01T09:00:00.000Z')

const db = getDb()
let snapshotRunIds: string[] = []
let observedAt = new Date()
let listing = new Map<string, GoogleReviewPage>()
/** Set to simulate the lock timeout that failed the live import mid-page. */
let failObservationOf: string | null = null
let activeKeyVersion = TEST_KEY_VERSION
let insertedTestKey = false

const snapshotRepository = createReviewProviderSnapshotRepository(db, () => {
  const next = snapshotRunIds.shift()
  if (!next) throw new Error('No snapshot run id left for this test')
  return next
})

const realWriter = createReviewProviderObservationWriter({
  reviewRepo: createReviewRepository(db, () => observedAt),
  clock: () => observedAt,
  idGen: () => reviewId(crypto.randomUUID()),
  commandStore: createAtomicReviewCommandStore(db, () => observedAt),
  googleReplyObservationStore: createGoogleReplyObservationStore(db),
  historyCutoffs: snapshotRepository,
})

const observationWriter: ReviewProviderObservationWriter = {
  allocateReplyReadGeneration: () => realWriter.allocateReplyReadGeneration(),
  persist: async (input) => {
    if (input.review.reviewName === failObservationOf) {
      throw new Error('canceling statement due to lock timeout')
    }
    return realWriter.persist(input)
  },
}

const googleReviewApi: GoogleReviewApiPort = {
  listReviewsPage: vi.fn(async ({ phase, pageIndex }) => {
    const page = listing.get(`${phase}:${pageIndex}`)
    if (!page) throw new Error(`No ${phase} page ${pageIndex} in this listing`)
    return page
  }),
  getReview: vi.fn(async () => ({ status: 'not_found' as const })),
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

const runSnapshot = runReviewProviderSnapshot({
  repository: snapshotRepository,
  googleReviewApi,
  propertySourceEpoch: { getSourceEpoch: async () => ({ sourceEpoch: 0 }) },
  observationWriter,
  subjectKeyService,
  syncActivity: {
    recordNewReviewObserved: vi.fn(async () => undefined),
    recordPushObserved: vi.fn(async () => undefined),
  },
  clock: () => observedAt,
  logger,
})

const locationOf = (property: PropertyId) =>
  `accounts/${ACCOUNT}/locations/location-${property.slice(-4)}`

function providerReview(
  property: PropertyId,
  slug: string,
  publishedAt: Date,
  overrides: Partial<GoogleReview> = {},
): GoogleReview {
  const reviewName = `${locationOf(property)}/reviews/${slug}`
  return {
    reviewName,
    externalId: `${property.slice(-4)}-${slug}`,
    externalLocationId: locationOf(property),
    reviewerName: `Guest ${slug}`,
    reviewerProfilePhotoUrl: null,
    rating: 4,
    text: `Review ${slug}`,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: publishedAt,
    sourceCreatedAt: publishedAt,
    sourceUpdatedAt: publishedAt,
    replyText: null,
    replyUpdatedAt: null,
    ...overrides,
  }
}

function page(
  reviews: readonly GoogleReview[],
  totalReviewCount: number,
  nextCursorRef: string | null,
): GoogleReviewPage {
  return { reviews, totalReviewCount, averageRating: 4, nextCursorRef }
}

function step(
  property: PropertyId,
  observationOrigin: 'ongoing' | 'historical_onboarding',
  runId?: string,
): Promise<RunReviewProviderSnapshotResult> {
  return runSnapshot({
    organizationId: ORG,
    propertyId: property,
    connectionId: CONNECTION,
    sourceEpoch: 0,
    observationOrigin,
    locationName: locationOf(property),
    ...(runId == null ? {} : { runId }),
  })
}

type RevisionRow = Readonly<{
  revision: number
  eligibility: string
  startAt: Date | null
}>

async function revisionsOf(review: GoogleReview): Promise<readonly RevisionRow[]> {
  const result = await db.execute(sql`
    SELECT m.revision, m.response_target_eligibility AS eligibility,
      m.response_target_start_at AS start_at
    FROM material_review_revisions m
    JOIN reviews r ON r.id = m.review_id
    WHERE r.organization_id = ${ORG} AND r.external_id = ${review.externalId}
    ORDER BY m.revision
  `)
  return result.rows.map((row) => ({
    revision: Number(row.revision),
    eligibility: String(row.eligibility),
    startAt: row.start_at == null ? null : new Date(String(row.start_at)),
  }))
}

async function createdEventOrigin(review: GoogleReview): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT e.payload->>'observationOrigin' AS origin
    FROM outbox_events e
    JOIN reviews r ON r.id::text = e.payload->>'reviewId'
    WHERE e.organization_id = ${ORG}
      AND e.event_type = 'review.created'
      AND r.external_id = ${review.externalId}
  `)
  const row = result.rows[0]
  return row?.origin == null ? null : String(row.origin)
}

async function runStartedAt(runId: string): Promise<Date> {
  const result = await db.execute(sql`
    SELECT started_at FROM review_provider_snapshot_runs WHERE id = ${runId}
  `)
  const startedAt = result.rows[0]?.started_at
  if (startedAt == null) throw new Error('Snapshot run is missing')
  return new Date(String(startedAt))
}

async function databaseNow(): Promise<Date> {
  const result = await db.execute(sql`SELECT clock_timestamp() AS now`)
  return new Date(String(result.rows[0]?.now))
}

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
  // Deleting the Property cascades every Review-owned per-epoch fact.
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
    VALUES (${ORG}, 'History cutoff test', ${ORG}, now())
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
        (${TEST_KEY_VERSION}, ${'7'.repeat(64)}, 'active', 999998,
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
      ${CONNECTION}, ${ORG}, 'history-cutoff-subject', 'sealed-access',
      'sealed-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], 'history-cutoff-user',
      'organization', 'active'
    )
  `)
  for (const property of PROPERTIES) {
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
      VALUES (${property}, ${ORG}, 'History cutoff property',
        ${`history-cutoff-${property.slice(-4)}`}, 'UTC', 0)
    `)
  }
  snapshotRunIds = Array.from({ length: 4 }, () => crypto.randomUUID())
  listing = new Map()
  failObservationOf = null
  observedAt = await databaseNow()
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

describe('initial import history cutoff (real PostgreSQL)', () => {
  it('keeps the cutoff of an import that failed part-way for the run that finishes the listing', async () => {
    const property = FAILED_IMPORT_PROPERTY
    const seenByImport = providerReview(property, 'seen-by-import', LAST_YEAR)
    const lostByImport = providerReview(property, 'lost-by-import', YEARS_AGO)
    listing = new Map([
      ['main:0', page([seenByImport], 2, 'cursor-page-1')],
      ['main:1', page([lostByImport], 2, null)],
    ])

    const first = await step(property, 'historical_onboarding')
    expect(first).toMatchObject({ status: 'checkpointed', state: 'scanning' })
    failObservationOf = lostByImport.reviewName
    const failed = await step(property, 'historical_onboarding', first.runId)
    expect(failed).toEqual({
      status: 'failed',
      runId: first.runId,
      code: 'observation_failed',
    })

    // The discovery sweep finishes the listing well after the import began.
    const cutoff = await runStartedAt(first.runId)
    failObservationOf = null
    observedAt = new Date(cutoff.getTime() + HOUR_MS)
    const newAfterImport = providerReview(
      property,
      'new-after-import',
      new Date(cutoff.getTime() + 10 * MINUTE_MS),
    )
    listing = new Map([
      ['main:0', page([seenByImport, lostByImport, newAfterImport], 3, null)],
    ])
    await expect(step(property, 'ongoing')).resolves.toMatchObject({
      status: 'checkpointed',
      state: 'confirming',
    })

    expect(await revisionsOf(lostByImport)).toEqual([
      { revision: 1, eligibility: 'historical_onboarding', startAt: null },
    ])
    expect(await createdEventOrigin(lostByImport)).toBe('historical_onboarding')
    expect(await revisionsOf(newAfterImport)).toEqual([
      { revision: 1, eligibility: 'measured', startAt: newAfterImport.sourceCreatedAt },
    ])
    expect(await createdEventOrigin(newAfterImport)).toBe('ongoing')
    expect(await revisionsOf(seenByImport)).toEqual([
      { revision: 1, eligibility: 'historical_onboarding', startAt: null },
    ])
  })

  it('takes the cutoff from the moment an import joins an ongoing run already under way', async () => {
    const property = JOINED_IMPORT_PROPERTY
    const seenBeforeImport = providerReview(property, 'seen-before-import', YEARS_AGO)
    const historyAfterJoin = providerReview(property, 'history-after-join', YEARS_AGO, {
      text: 'An old review listed on a later page',
    })
    listing = new Map([['main:0', page([seenBeforeImport], 3, 'cursor-page-1')]])
    const discovery = await step(property, 'ongoing')
    expect(discovery).toMatchObject({ status: 'checkpointed', state: 'scanning' })

    const joinedAt = await databaseNow()
    observedAt = new Date(joinedAt.getTime() + HOUR_MS)
    const newAfterJoin = providerReview(
      property,
      'new-after-join',
      new Date(joinedAt.getTime() + 10 * MINUTE_MS),
    )
    listing.set('main:1', page([historyAfterJoin, newAfterJoin], 3, null))
    // The import's first step resumes the active ongoing run instead of
    // starting its own, so the run keeps its `ongoing` origin.
    await expect(step(property, 'historical_onboarding')).resolves.toMatchObject({
      status: 'checkpointed',
      runId: discovery.runId,
      state: 'confirming',
    })

    expect(await revisionsOf(historyAfterJoin)).toEqual([
      { revision: 1, eligibility: 'historical_onboarding', startAt: null },
    ])
    expect(await revisionsOf(newAfterJoin)).toEqual([
      { revision: 1, eligibility: 'measured', startAt: newAfterJoin.sourceCreatedAt },
    ])
    // Eligibility is immutable: a revision measured before the import joined
    // stays measured.
    expect(await revisionsOf(seenBeforeImport)).toEqual([
      { revision: 1, eligibility: 'measured', startAt: YEARS_AGO },
    ])
  })

  it('classifies an old review first listed after the import completed as history', async () => {
    const property = COMPLETED_IMPORT_PROPERTY
    const imported = providerReview(property, 'imported', LAST_YEAR)
    listing = new Map([
      ['main:0', page([imported], 1, null)],
      ['confirmation:0', page([imported], 1, null)],
    ])
    const first = await step(property, 'historical_onboarding')
    expect(first).toMatchObject({ status: 'checkpointed', state: 'confirming' })
    await expect(step(property, 'historical_onboarding', first.runId)).resolves.toEqual({
      status: 'deleting',
      runId: first.runId,
      applied: 0,
    })
    await expect(step(property, 'historical_onboarding', first.runId)).resolves.toEqual({
      status: 'completed',
      runId: first.runId,
    })

    const cutoff = await runStartedAt(first.runId)
    observedAt = new Date(cutoff.getTime() + 2 * HOUR_MS)
    const listedLate = providerReview(property, 'listed-late', YEARS_AGO)
    const editedAfterImport = {
      ...imported,
      text: 'The guest rewrote this review after the import',
      sourceUpdatedAt: new Date(cutoff.getTime() + HOUR_MS),
    }
    listing = new Map([['main:0', page([editedAfterImport, listedLate], 2, null)]])
    await expect(step(property, 'ongoing')).resolves.toMatchObject({
      status: 'checkpointed',
      state: 'confirming',
    })

    expect(await revisionsOf(listedLate)).toEqual([
      { revision: 1, eligibility: 'historical_onboarding', startAt: null },
    ])
    // Only a Review's first revision is history. A guest's later edit is new
    // work and is measured from Google's update time.
    expect(await revisionsOf(imported)).toEqual([
      { revision: 1, eligibility: 'historical_onboarding', startAt: null },
      {
        revision: 2,
        eligibility: 'measured',
        startAt: editedAfterImport.sourceUpdatedAt,
      },
    ])
  })

  it('keeps measuring every review of a property that never had an import', async () => {
    const property = NEVER_IMPORTED_PROPERTY
    const old = providerReview(property, 'old', YEARS_AGO)
    listing = new Map([['main:0', page([old], 1, null)]])

    await expect(step(property, 'ongoing')).resolves.toMatchObject({
      status: 'checkpointed',
      state: 'confirming',
    })

    expect(await revisionsOf(old)).toEqual([
      { revision: 1, eligibility: 'measured', startAt: YEARS_AGO },
    ])
  })
})
