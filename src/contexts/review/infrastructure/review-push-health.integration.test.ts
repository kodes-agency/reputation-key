// Push health against real PostgreSQL: the Review writer and the targeted
// (push) fetch record when each live Review was first seen and when its push
// was accepted, and the pure rules (shared/domain/push-health.ts) read
// the rows back as healthy, late or missed.
//
// The fake is the Google side only (the push's reference and the review read);
// the writer, the command store, the first-sighting rows and the Property's
// source epoch are the real ones.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deriveReviewProviderSubject } from '#/shared/review-provider-subject-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { ReviewFirstSeenVia } from '#/shared/domain/push-health'
import { classifyFirstSighting } from '#/shared/domain/push-health'
import type { GoogleReview } from '../domain/types'
import type { GoogleReviewApiPort } from '../application/ports/google-review-api.port'
import type { ReviewProviderSubjectKeyService } from '../application/provider-subject-keyring'
import type { ReviewProviderObservationOrigin } from '../application/ports/response-target-authority.port'
import { createReviewProviderObservationWriter } from '../application/use-cases/sync-reviews'
import { runTargetedGoogleReviewFetch } from '../application/use-cases/run-targeted-google-review-fetch'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewFirstSightingRecorder } from './repositories/review-first-sighting.repository'
import { createReviewProviderSnapshotRepository } from './repositories/review-provider-snapshot.repository'
import { createReviewRepository } from './repositories/review.repository'

const ORG = organizationId('review-push-health-org-a')
const OTHER_ORG = organizationId('review-push-health-org-b')
const CONNECTION = googleConnectionId('b5f1e100-0000-4000-8000-00000000c001')
const OTHER_CONNECTION = googleConnectionId('b5f1e100-0000-4000-8000-00000000c002')
const PROPERTY = propertyId('b5f1e100-0000-4000-8000-00000000a001')
const OTHER_PROPERTY = propertyId('b5f1e100-0000-4000-8000-00000000a002')
const ACCOUNT = 'push-health-account'
const LOCATION = `accounts/${ACCOUNT}/locations/push-health-location`
const MINUTE_MS = 60_000
const TEST_KEY_VERSION = 'push-health-test-v1'
const TEST_KEY = new Uint8Array(32).fill(9)

const db = getDb()
let clockAt = new Date()
let activeKeyVersion = TEST_KEY_VERSION
let insertedTestKey = false

const snapshotRepository = createReviewProviderSnapshotRepository(db, () =>
  crypto.randomUUID(),
)
const writer = createReviewProviderObservationWriter({
  reviewRepo: createReviewRepository(db, () => clockAt),
  clock: () => clockAt,
  idGen: () => reviewId(crypto.randomUUID()),
  commandStore: createAtomicReviewCommandStore(db, () => clockAt),
  googleReplyObservationStore: createGoogleReplyObservationStore(db),
  historyCutoffs: snapshotRepository,
})

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

function providerReview(slug: string, publishedAt: Date): GoogleReview {
  return {
    reviewName: `${LOCATION}/reviews/${slug}`,
    externalId: `push-health-${slug}`,
    externalLocationId: LOCATION,
    reviewerName: `Guest ${slug}`,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: `Review ${slug}`,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: publishedAt,
    sourceCreatedAt: publishedAt,
    sourceUpdatedAt: publishedAt,
    replyText: null,
    replyUpdatedAt: null,
  }
}

/** A snapshot page or any other read polling makes. */
async function observeByPolling(
  review: GoogleReview,
  at: Date,
  options: Readonly<{
    organization?: OrganizationId
    property?: PropertyId
    connection?: typeof CONNECTION
    origin?: ReviewProviderObservationOrigin
    via?: ReviewFirstSeenVia
    key?: string
  }> = {},
) {
  clockAt = at
  const organization = options.organization ?? ORG
  const property = options.property ?? PROPERTY
  const deriver = await subjectKeyService.acquireDeriver()
  return writer.persist({
    organizationId: organization,
    propertyId: property,
    connectionId: options.connection ?? CONNECTION,
    sourceEpoch: 0,
    observationOrigin: options.origin ?? 'ongoing',
    firstSeenVia: options.via ?? 'snapshot',
    observationKey: options.key ?? 'a'.repeat(64),
    replyReadGeneration: await writer.allocateReplyReadGeneration(),
    review,
    subjects: deriver.deriveCandidates({
      organizationId: organization,
      propertyId: property,
      sourceEpoch: 0,
      resourceName: review.reviewName,
    }),
  })
}

/** The push's targeted read: Google answers with `review`. */
function targetedFetch(review: GoogleReview) {
  const googleReviewApi: GoogleReviewApiPort = {
    listReviewsPage: vi.fn(),
    getReview: vi.fn(async () => ({ status: 'found' as const, review })),
    discardReviewCursors: vi.fn(),
    replyToReview: vi.fn(),
  }
  return runTargetedGoogleReviewFetch({
    references: {
      resolve: async () => ({
        status: 'found' as const,
        locationName: LOCATION,
        reviewName: review.reviewName,
      }),
    },
    googleReviewApi,
    propertySourceEpoch: {
      getSourceEpoch: async () => ({ sourceEpoch: 0 }),
    },
    observationWriter: writer,
    subjectKeyService,
    syncActivity: {
      recordNewReviewObserved: vi.fn(async () => undefined),
      recordPushObserved: vi.fn(async () => undefined),
    },
    firstSightings: createReviewFirstSightingRecorder(db),
    clock: () => clockAt,
  })
}

const pushFor = (acceptedAt: Date, deliveryId = crypto.randomUUID()) => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONNECTION,
  sourceEpoch: 0,
  referenceRef: 'v1.reference',
  deliveryId,
  acceptedAt,
  notificationKind: 'NEW_REVIEW' as const,
})

type Sighting = Readonly<{
  organization: string
  via: string
  firstSeenAt: Date
  pushAcceptedAt: Date | null
}>

async function sightingsOf(organization: OrganizationId = ORG): Promise<Sighting[]> {
  const result = await db.execute(sql`
    SELECT organization_id, first_seen_via, first_seen_at, push_accepted_at
    FROM review_first_sightings WHERE organization_id = ${organization}
    ORDER BY first_seen_at
  `)
  return result.rows.map((row) => ({
    organization: String(row.organization_id),
    via: String(row.first_seen_via),
    firstSeenAt: new Date(String(row.first_seen_at)),
    pushAcceptedAt:
      row.push_accepted_at == null ? null : new Date(String(row.push_accepted_at)),
  }))
}

async function onlySighting(): Promise<Sighting> {
  const rows = await sightingsOf()
  expect(rows).toHaveLength(1)
  return rows[0] as Sighting
}

const coverageOf = (sighting: Sighting, now: Date) =>
  classifyFirstSighting(
    {
      firstSeenVia: sighting.via as ReviewFirstSeenVia,
      firstSeenAt: sighting.firstSeenAt,
      pushAcceptedAt: sighting.pushAcceptedAt,
    },
    now,
  )

async function clear(): Promise<void> {
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${org}`)
    await db.execute(
      sql`DELETE FROM google_reply_observation_heads WHERE organization_id = ${org}`,
    )
    await db.execute(
      sql`DELETE FROM google_reply_observations WHERE organization_id = ${org}`,
    )
    await db.execute(
      sql`DELETE FROM review_provider_subjects WHERE organization_id = ${org}`,
    )
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${org}`)
    await db.execute(
      sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${org}`,
    )
    // Deleting the Property cascades its first-sighting rows.
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${org}`)
  }
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await clear()
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${org}, 'Push health test', ${org}, now())
    `)
  }
  const active = await db.execute(sql`
    SELECT key_version FROM review_provider_subject_hmac_key_versions WHERE state = 'active'
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
  for (const [org, connection, property] of [
    [ORG, CONNECTION, PROPERTY],
    [OTHER_ORG, OTHER_CONNECTION, OTHER_PROPERTY],
  ] as const) {
    await db.execute(sql`
      INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        visibility, status
      ) VALUES (
        ${connection}, ${org}, ${`push-health-subject-${org}`}, 'sealed-access',
        'sealed-refresh', now() + interval '1 hour',
        ARRAY['https://www.googleapis.com/auth/business.manage'], 'push-health-user',
        'organization', 'active'
      )
    `)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
      VALUES (${property}, ${org}, 'Push health property',
        ${`push-health-${property.slice(-4)}`}, 'UTC', 0)
    `)
  }
  clockAt = new Date()
})

afterAll(async () => {
  await clear()
  if (insertedTestKey) {
    await db.execute(sql`
      DELETE FROM review_provider_subject_hmac_key_versions
      WHERE key_version = ${TEST_KEY_VERSION}
    `)
  }
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
  clearEventSchemas()
})

describe('push health ledger (real PostgreSQL)', () => {
  const published = new Date('2026-10-20T08:00:00.000Z')

  it('calls a push that arrives after polling saw the Review late', async () => {
    const seenAt = new Date(clockAt.getTime() - 3 * 60 * MINUTE_MS)
    const review = providerReview('late', published)
    await observeByPolling(review, seenAt)

    const result = await targetedFetch(review)(
      pushFor(new Date(seenAt.getTime() + 20 * MINUTE_MS)),
    )

    expect(result).toMatchObject({ status: 'persisted', isNew: false })
    const sighting = await onlySighting()
    expect(sighting).toMatchObject({ via: 'snapshot', firstSeenAt: seenAt })
    expect(coverageOf(sighting, new Date())).toEqual({
      healthy: false,
      pending: false,
      late: true,
      missed: false,
    })
  })

  it('calls a push accepted before polling saw the Review healthy, even if its job ran later', async () => {
    const acceptedAt = new Date(clockAt.getTime() - 3 * 60 * MINUTE_MS)
    const seenAt = new Date(acceptedAt.getTime() + 2 * MINUTE_MS)
    const review = providerReview('race', published)
    await observeByPolling(review, seenAt)

    clockAt = new Date()
    await targetedFetch(review)(pushFor(acceptedAt))

    const sighting = await onlySighting()
    expect(sighting.pushAcceptedAt).toEqual(acceptedAt)
    expect(coverageOf(sighting, new Date()).healthy).toBe(true)
  })

  it('records a Review the push found first as seen by push, healthy', async () => {
    const acceptedAt = new Date(clockAt.getTime() - 30 * MINUTE_MS)
    clockAt = new Date(acceptedAt.getTime() + 15_000)
    const review = providerReview('push-first', published)

    const result = await targetedFetch(review)(pushFor(acceptedAt))

    expect(result).toMatchObject({ status: 'persisted', isNew: true })
    const sighting = await onlySighting()
    expect(sighting).toMatchObject({
      via: 'push',
      firstSeenAt: clockAt,
      pushAcceptedAt: acceptedAt,
    })
    expect(coverageOf(sighting, new Date()).healthy).toBe(true)
  })

  it('calls a Review no push ever covered missed once the hour has passed', async () => {
    const seenAt = new Date(clockAt.getTime() - 2 * 60 * MINUTE_MS)
    await observeByPolling(providerReview('silent', published), seenAt)

    const sighting = await onlySighting()
    expect(
      coverageOf(sighting, new Date(seenAt.getTime() + 59 * MINUTE_MS)).pending,
    ).toBe(true)
    expect(coverageOf(sighting, new Date())).toEqual({
      healthy: false,
      pending: false,
      late: false,
      missed: true,
    })
  })

  it.each(['historical_onboarding', 'legacy_unknown'] as const)(
    'records no sighting for a Review first seen as %s',
    async (origin) => {
      await observeByPolling(providerReview(`history-${origin}`, published), clockAt, {
        origin,
      })

      expect(await sightingsOf()).toEqual([])
    },
  )

  it('records no sighting for a later revision of a Review it already holds', async () => {
    const review = providerReview('revised', published)
    await observeByPolling(review, new Date(clockAt.getTime() - 60 * MINUTE_MS), {
      origin: 'historical_onboarding',
    })

    await observeByPolling({ ...review, text: 'Edited' }, clockAt, {
      key: 'b'.repeat(64),
    })

    expect(await sightingsOf()).toEqual([])
  })

  it('keeps one row and the first acceptance time when the same push is replayed', async () => {
    const seenAt = new Date(clockAt.getTime() - 3 * 60 * MINUTE_MS)
    const review = providerReview('replay', published)
    await observeByPolling(review, seenAt)
    const deliveryId = crypto.randomUUID()
    const acceptedAt = new Date(seenAt.getTime() + 20 * MINUTE_MS)

    await targetedFetch(review)(pushFor(acceptedAt, deliveryId))
    await targetedFetch(review)(
      pushFor(new Date(acceptedAt.getTime() + 5 * MINUTE_MS), deliveryId),
    )
    await observeByPolling(review, new Date(seenAt.getTime() + 6 * 60 * MINUTE_MS))

    expect(await sightingsOf()).toEqual([
      expect.objectContaining({ firstSeenAt: seenAt, pushAcceptedAt: acceptedAt }),
    ])
  })

  it('keeps one row for each Organization that holds the same Google location', async () => {
    const review = providerReview('shared', published)
    const seenAt = new Date(clockAt.getTime() - 3 * 60 * MINUTE_MS)

    await observeByPolling(review, seenAt)
    await observeByPolling(review, seenAt, {
      organization: OTHER_ORG,
      property: OTHER_PROPERTY,
      connection: OTHER_CONNECTION,
    })
    await targetedFetch(review)(pushFor(new Date(seenAt.getTime() + 10 * MINUTE_MS)))

    expect(await sightingsOf(ORG)).toEqual([
      expect.objectContaining({
        pushAcceptedAt: new Date(seenAt.getTime() + 10 * MINUTE_MS),
      }),
    ])
    expect(await sightingsOf(OTHER_ORG)).toEqual([
      expect.objectContaining({ pushAcceptedAt: null }),
    ])
  })
})
