// Shared setup for the persisting head check suites: two organizations with a
// Property each, the real observation writer and head check, and a Google side
// that returns the page the test hands it.

import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  inboxItemId,
  organizationId,
  propertyId,
} from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import type {
  GoogleReviewHeadResult,
  GoogleReviewRead,
} from './google-review-api.port.server'
import { createRunReviewHeadCheck } from './run-review-head-check.server'
import { createReviewHeadCheckRepository } from './review-head-check-repository.server'
import { createReviewProviderSubjectSightings } from './review-provider-subject-link.server'
import { createReviewSyncActivityRecorder } from './review-sync-activity-repository.server'
import { testUuid } from './review-snapshot-harness.test-fixtures'
import { googleReviewFixture } from './google-review.test-fixtures'
import {
  clearReviewSnapshotData,
  createSnapshotWriter,
  createSubjectKeyHarness,
  insertTestOrganization,
  insertTestProperty,
  seedSnapshotConnection,
} from './review-snapshot-harness.test-fixtures'

export const ORG = organizationId('review-head-persist-org-a')
export const OTHER_ORG = organizationId('review-head-persist-org-b')
export const CONNECTION = googleConnectionId('b6f1e100-0000-4000-8000-00000000c001')
const OTHER_CONNECTION = googleConnectionId('b6f1e100-0000-4000-8000-00000000c002')
export const PROPERTY = propertyId('b6f1e100-0000-4000-8000-00000000a001')
export const OTHER_PROPERTY = propertyId('b6f1e100-0000-4000-8000-00000000a002')
export const LOCATION = GOOGLE_LOCATION_PRIMARY_RESOURCE
export const INBOX_ITEM = inboxItemId('b6f1e100-0000-4000-8000-00000000b001')
export const EPOCH = 0
export const DAY_MS = 24 * 60 * 60 * 1000
const TEST_KEY_VERSION = 'head-persist-test-v1'

export const db = getDb()
/** Wall time without the ambient reads the Review runtime guard bans. */
export const realNow = (): Date => new Date(performance.timeOrigin + performance.now())
export const clock = { at: realNow(), tick: 0 }

const { writer } = createSnapshotWriter(db, { clock: () => clock.at })
const subjectKeys = createSubjectKeyHarness(db, {
  version: TEST_KEY_VERSION,
  byte: 7,
  generation: 999996,
})
export const subjectKeyService = subjectKeys.service

export function providerReview(
  slug: string,
  over: Partial<GoogleReviewRead> = {},
): GoogleReviewRead {
  return googleReviewFixture({
    location: LOCATION,
    slug,
    publishedAt: new Date(clock.at.getTime() - 3 * DAY_MS),
    externalId: `head-persist-${slug}`,
    overrides: over,
  })
}

/** A read made by a full snapshot page or any other read before the head check. */
export async function observeEarlier(review: GoogleReviewRead, at: Date) {
  clock.at = at
  const deriver = await subjectKeyService.acquireDeriver()
  return writer.persist({
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: EPOCH,
    observationOrigin: 'ongoing',
    firstSeenVia: 'snapshot',
    observationKey: testUuid().replaceAll('-', '').repeat(2),
    replyReadGeneration: await writer.allocateReplyReadGeneration(),
    review,
    subjects: deriver.deriveCandidates({
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: EPOCH,
      resourceName: review.reviewName,
    }),
  })
}

export async function insertFact(
  over: Readonly<{
    count?: number
    average?: number | null
    listingComplete?: boolean
    evaluatedAt?: Date
    observedAt?: Date | null
  }> = {},
) {
  await db.execute(sql`
    INSERT INTO review_google_reputation_snapshot_facts
      (run_id, event_id, organization_id, property_id, source_epoch, review_count,
       average_rating, evaluated_at, numbers_observed_at, listing_complete)
    VALUES (${testUuid()}, ${testUuid()}, ${ORG}, ${PROPERTY}, ${EPOCH},
      ${over.count ?? 2}, ${over.average === undefined ? 4 : over.average},
      ${over.evaluatedAt ?? new Date(realNow().getTime() - 3_600_000)},
      ${over.observedAt === undefined ? null : over.observedAt},
      ${over.listingComplete ?? true})
  `)
}

export type HeadOptions = Readonly<{
  total?: number
  average?: number | null
  mode?: 'dark' | 'persist'
  /** Replaces the read generation the check takes right after Google answers. */
  generation?: number
  /** Google says more pages follow this one. */
  hasMore?: boolean
  /** The observation write of this review fails. */
  failPersistOf?: string
}>

/** Run one head check against a page Google returns. */
export async function headCheck(
  reviews: readonly GoogleReviewRead[],
  options: HeadOptions = {},
) {
  const page: GoogleReviewHeadResult = {
    status: 'ok',
    reviews,
    totalReviewCount: options.total ?? reviews.length,
    averageRating: options.average === undefined ? 4 : options.average,
    hasMore: options.hasMore ?? false,
  }
  const warn = vi.fn()
  const run = createRunReviewHeadCheck({
    googleReviewApi: { readReviewsHead: vi.fn(async () => page) },
    repository: createReviewHeadCheckRepository(db),
    logger: { info: vi.fn(), warn },
    clock: () => new Date(clock.at.getTime() + clock.tick++),
    persist: {
      observationWriter: {
        ...writer,
        ...(options.generation === undefined
          ? {}
          : { allocateReplyReadGeneration: async () => options.generation as number }),
        persist: async (call) => {
          if (call.review.externalId === options.failPersistOf) {
            throw new Error('observation write failed')
          }
          return writer.persist(call)
        },
      },
      subjectKeyService,
      subjectSightings: createReviewProviderSubjectSightings(db, { warn }),
      propertySourceEpoch: { getSourceEpoch: async () => ({ sourceEpoch: EPOCH }) },
      syncActivity: createReviewSyncActivityRecorder(db),
      newId: testUuid,
    },
  })
  const result = await run({
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: EPOCH,
    locationName: LOCATION,
    mode: options.mode ?? 'persist',
  })
  return { result, warn }
}

/** The usual start: a Property whose newest fact has no reviews, then a head
 * check that finds one new review on Google's first page. */
export async function freshHeadCheck(options: HeadOptions = {}) {
  await insertFact({ count: 0, average: null })
  return headCheck([providerReview('fresh')], { total: 1, average: 4, ...options })
}

export const count = async (query: ReturnType<typeof sql>): Promise<number> => {
  const result = await db.execute(query)
  return Number(result.rows[0]?.count ?? 0)
}

export const observationsOf = (externalId: string) =>
  count(sql`
    SELECT count(*)::int AS count FROM review_source_observations o
    JOIN review_source_contents c ON c.review_id = o.review_id AND c.organization_id = o.organization_id
    WHERE c.organization_id = ${ORG} AND c.external_id = ${externalId}
  `)

export const reviewRows = async () =>
  (
    await db.execute(sql`
      SELECT external_id, text FROM review_source_contents WHERE organization_id = ${ORG} ORDER BY external_id
    `)
  ).rows

export const factRows = async () =>
  (
    await db.execute(sql`
      SELECT review_count, average_rating, listing_complete, numbers_observed_at
      FROM review_google_reputation_snapshot_facts
      WHERE organization_id = ${ORG} ORDER BY evaluated_at, run_id
    `)
  ).rows

async function clear(): Promise<void> {
  for (const org of [ORG, OTHER_ORG]) {
    await clearReviewSnapshotData(db, org, { inboxItems: true, snapshotFacts: true })
  }
  await db.execute(
    sql`DELETE FROM review_sync_runs WHERE property_id IN (${PROPERTY}, ${OTHER_PROPERTY})`,
  )
  await db.execute(
    sql`DELETE FROM review_sync_state WHERE property_id IN (${PROPERTY}, ${OTHER_PROPERTY})`,
  )
}

/** Registers the suite's database setup and cleanup for the file that calls it. */
export function useHeadPersistDatabase(): void {
  beforeAll(async () => {
    await clear()
    await deleteTestOrganizations(db, [ORG, OTHER_ORG])
    for (const org of [ORG, OTHER_ORG]) {
      await insertTestOrganization(db, org, 'Head persist test')
    }
    await subjectKeys.ensureActive()
  })

  beforeEach(async () => {
    await clear()
    for (const [org, connection, property] of [
      [ORG, CONNECTION, PROPERTY],
      [OTHER_ORG, OTHER_CONNECTION, OTHER_PROPERTY],
    ] as const) {
      await seedSnapshotConnection(db, {
        id: connection,
        organizationId: org,
        googleSubject: `head-persist-subject-${org}`,
        connectedBy: 'head-persist-user',
      })
      await insertTestProperty(db, {
        id: property,
        organizationId: org,
        name: 'Head persist property',
        slug: `head-persist-${property.slice(-4)}`,
        sourceEpoch: EPOCH,
      })
    }
    clock.at = realNow()
    clock.tick = 0
  })

  afterAll(async () => {
    await clear()
    await subjectKeys.removeInserted()
    await deleteTestOrganizations(db, [ORG, OTHER_ORG])
  })
}
