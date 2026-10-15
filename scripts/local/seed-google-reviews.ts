// The e2e seed's Google side: the reviews in RepKey's cache, and the numbers
// Google shows for them.
//
// A Google import writes both. Its runs fill the review cache, and every run
// that completes ends with Review's verified provider aggregate: an
// append-only history fact and a `review.google_reputation_snapshot.verified`
// event, which Reporting applies to the Current on Google snapshot. Every
// headline rating reads that snapshot and never RepKey's own average of the
// reviews it holds (decision 16, ADR 0067), so the Properties list and the
// Overview's Rating tile show a dash for a Property Google never sent numbers
// for. The seed writes its reviews straight into the cache, so it also has to
// write what Google would say about them, the way the import does.

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Database } from '../../src/shared/db'
import { properties } from '../../src/shared/db/schema/property.schema'
import {
  reviewGoogleReputationSnapshotFacts,
  reviews,
} from '../../src/shared/db/schema/review.schema'
import { metricReadings } from '../../src/shared/db/schema/metric.schema'
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import { registerAllEventSchemas } from '../../src/shared/events/schema-registrations'
import { insertOutboxRow } from '../../src/shared/outbox/commit'
import { computeAiReviewSourceProvenance } from '../../src/contexts/review/application/ai-review-source'
import {
  reviewGoogleReputationSnapshotVerified,
  type ReviewGoogleReputationSnapshotVerified,
} from '../../src/contexts/review/domain/events'
import { createGoogleRatingReads } from '../../src/contexts/review/infrastructure/google-rating-reads'
import { displayedTenths } from '../../src/contexts/reporting/domain/rating-goal-numbers'
import { createCurrentGoogleReputationSnapshotRepository } from '../../src/contexts/reporting/infrastructure/repositories/current-google-reputation-snapshot.repository'

const FAR_FUTURE = new Date('2030-01-01T00:00:00.000Z')

export type SeededReviewProperties = Readonly<{
  orgAId: string
  lockedOrgId: string
  p1Id: string
  p2Id: string
  p3Id: string
  boundedIds: readonly string[]
}>

/**
 * The landscape's 100 Google reviews and their metric readings: 40 for P1, 20
 * each for P2 and the locked organization's P3, and 20 spread over the bounded
 * Properties, with stars cycling 1 to 5.
 */
export async function ensureReviews(
  db: Database,
  input: SeededReviewProperties,
): Promise<void> {
  // Keep the seeded review windows stable as wall-clock time advances: the
  // newest fixture is always 15 days old, so the 30-day fleet view contains
  // 30 P1 reviews and 15 P2 reviews.
  const reviewedAtAnchor = new Date()
  reviewedAtAnchor.setUTCHours(12, 0, 0, 0)
  reviewedAtAnchor.setUTCDate(reviewedAtAnchor.getUTCDate() - 15)
  const propertyFor = (index: number) => {
    if (index < 40) return { organizationId: input.orgAId, propertyId: input.p1Id }
    if (index < 60) return { organizationId: input.orgAId, propertyId: input.p2Id }
    if (index < 80) return { organizationId: input.lockedOrgId, propertyId: input.p3Id }
    return {
      organizationId: input.orgAId,
      propertyId: input.boundedIds[(index - 80) % input.boundedIds.length]!,
    }
  }

  for (let index = 0; index < 100; index += 1) {
    const ordinal = index + 1
    const scope = propertyFor(index)
    const id = `50000000-0000-4000-8000-${ordinal.toString(16).padStart(12, '0')}`
    const reviewedAt = new Date(reviewedAtAnchor)
    reviewedAt.setUTCDate(reviewedAt.getUTCDate() - (index % 20))
    const text = `Deterministic local beta review ${ordinal}.`
    const reviewerName = `E2E Reviewer ${ordinal}`
    const provenance = computeAiReviewSourceProvenance({
      text,
      rating: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      languageCode: 'en',
      reviewedAtEpochMillis: reviewedAt.getTime(),
      reviewerDisplayName: reviewerName,
    })
    await db
      .insert(reviews)
      .values({
        id,
        ...scope,
        platform: 'google',
        externalId: `e2e-beta-review-${ordinal.toString().padStart(3, '0')}`,
        externalLocationId: `e2e-location-${scope.propertyId}`,
        reviewerName,
        rating: (index % 5) + 1,
        text,
        languageCode: 'en',
        reviewedAt,
        expiresAt: FAR_FUTURE,
        contentExpiresAt: FAR_FUTURE,
        sourceCreatedAt: reviewedAt,
        sourceUpdatedAt: reviewedAt,
        firstFetchedAt: reviewedAt,
        lastFetchedAt: reviewedAt,
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 0,
        aiSourceByteLength: provenance.byteLength,
        aiSourceDigest: provenance.digest,
      })
      .onConflictDoUpdate({
        target: reviews.id,
        set: {
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          rating: (index % 5) + 1,
          reviewedAt,
          aiSourceByteLength: provenance.byteLength,
          aiSourceDigest: provenance.digest,
          expiresAt: FAR_FUTURE,
          contentExpiresAt: FAR_FUTURE,
        },
      })
    const metricReadingId = `51000000-0000-4000-8000-${ordinal
      .toString(16)
      .padStart(12, '0')}`
    await db
      .insert(metricReadings)
      .values({
        id: metricReadingId,
        ...scope,
        metricKey: 'property.review',
        value: (index % 5) + 1,
        definitionVersionId: '11111111-1111-4111-8111-111111111205',
        sourceEventId: `e2e-review-created-${ordinal}`,
        sourcePolicy: 'google_property_derivative',
        exactValue: (index % 5) + 1,
        sampleCount: 1,
        attributionQuality: 'exact',
        occurredAt: reviewedAt,
        eventAt: reviewedAt,
        propertyLocalDate: reviewedAt.toISOString().slice(0, 10),
        dataQuality: 'exact',
        retentionClass: 'standard',
      })
      .onConflictDoUpdate({
        target: metricReadings.id,
        set: {
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          value: (index % 5) + 1,
          exactValue: (index % 5) + 1,
          occurredAt: reviewedAt,
          eventAt: reviewedAt,
          propertyLocalDate: reviewedAt.toISOString().slice(0, 10),
          dataQuality: 'exact',
        },
      })
  }
}

/** Google's numbers for one Property, as the snapshot stores them. */
export type SeededGoogleNumbers = Readonly<{
  propertyId: string
  reviewCount: number
  /** Google's one-decimal number as the float32 Google sends: 2.3 is 2.299999952316284. */
  averageRating: number
}>

type GoogleFigures = Omit<SeededGoogleNumbers, 'propertyId'>

/**
 * What Google would send for a complete cache: its count of the Property's
 * current Google reviews, read with Review's own cache read (an expired review
 * or one from an earlier binding does not count), and their mean rounded half
 * up to one decimal, the rule the rating goal reads Google's number with, as a
 * float32. Null when the cache holds none.
 */
async function googleFigures(
  db: Database,
  scope: Readonly<{ organizationId: string; propertyId: string }>,
  now: Date,
): Promise<GoogleFigures | null> {
  const { all } = await createGoogleRatingReads({
    db,
    clock: () => now,
  }).getRatingSummary(
    organizationId(scope.organizationId),
    propertyId(scope.propertyId),
    { mixWindowStart: now, mostRecentLimit: 1, countSince: [] },
  )
  if (all.count === 0) return null
  return {
    reviewCount: all.count,
    averageRating: Math.fround(displayedTenths(all.sum / all.count) / 10),
  }
}

/** Review's side of a completed run: the history fact and its event, in one commit. */
async function recordVerifiedFact(
  db: Database,
  verified: ReviewGoogleReputationSnapshotVerified,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(reviewGoogleReputationSnapshotFacts).values({
      runId: verified.runId,
      eventId: verified.eventId,
      organizationId: verified.organizationId,
      propertyId: verified.propertyId,
      sourceEpoch: verified.sourceEpoch,
      reviewCount: verified.reviewCount,
      averageRating: verified.averageRating,
      evaluatedAt: verified.evaluatedAt,
    })
    await insertOutboxRow(tx, verified, { recordedAt: verified.evaluatedAt })
  })
}

/**
 * One Property's verification, at its current binding epoch: Review records
 * the fact, then Reporting applies it with the store its consumer uses. A
 * worker that relays the fact first leaves the apply a duplicate, which is the
 * same snapshot.
 */
async function verifyGoogleNumbers(
  db: Database,
  id: string,
  now: Date,
): Promise<SeededGoogleNumbers | null> {
  const [property] = await db
    .select({
      organizationId: properties.organizationId,
      sourceEpoch: properties.sourceEpoch,
    })
    .from(properties)
    .where(eq(properties.id, id))
    .limit(1)
  if (!property) throw new Error(`Seeded Property ${id} does not exist`)
  const figures = await googleFigures(db, { ...property, propertyId: id }, now)
  if (figures === null) return null

  const verified = reviewGoogleReputationSnapshotVerified({
    organizationId: organizationId(property.organizationId),
    propertyId: propertyId(id),
    sourceEpoch: property.sourceEpoch,
    runId: randomUUID(),
    ...figures,
    evaluatedAt: now,
    occurredAt: now,
  })
  await recordVerifiedFact(db, verified)
  const status =
    await createCurrentGoogleReputationSnapshotRepository(db).applyVerifiedSnapshot(
      verified,
    )
  if (status === 'obsolete') {
    // Only a reused local database gets here: the stored snapshot is from a
    // later binding or a later verification than this seed's.
    console.warn(
      `Google's numbers for seeded Property ${id} were not applied: a newer snapshot is stored`,
    )
    return null
  }
  return { propertyId: id, ...figures }
}

/**
 * Google's own numbers for every listed Property with Google reviews in the
 * cache, recorded as a completed Google refresh records them. Each call is a
 * new verification evaluated at `now`, so a reseed supersedes the last one
 * rather than replaying it. A Property with no Google reviews gets none.
 */
export async function ensureGoogleNumbers(
  db: Database,
  propertyIds: readonly string[],
  now: Date = new Date(),
): Promise<readonly SeededGoogleNumbers[]> {
  registerAllEventSchemas()
  const seeded: SeededGoogleNumbers[] = []
  for (const id of propertyIds) {
    const numbers = await verifyGoogleNumbers(db, id, now)
    if (numbers) seeded.push(numbers)
  }
  return seeded
}
