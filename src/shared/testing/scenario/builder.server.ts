// Scenario builder — generates realistic, backdated test data via the
// container's repos, event bus, and use-cases. Exercises the full reactive
// pipeline: reviews, guest interactions (scan/rating/feedback), and reply
// lifecycle (draft → submit → approve → publish).
//
// Reviews and guest interactions carry explicit timestamps (not DB defaults)
// so the simulation controls the time dimension (ADR 0017).

import type { Container } from '#/composition'
import {
  reviewId,
  propertyId,
  organizationId,
  portalId,
  scanEventId,
  ratingId,
  feedbackId,
  userId,
  unbrand,
} from '#/shared/domain/ids'
import { reviewCreated } from '#/contexts/review/domain/events'
import type { Review } from '#/contexts/review/domain/types'
import {
  guestScanRecorded,
  guestRatingSubmitted,
  guestFeedbackSubmitted,
} from '#/contexts/guest/domain/events'
import { properties } from '#/shared/db/schema/property.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import { goals } from '#/shared/db/schema/goal.schema'
import { user, member } from '#/shared/db/schema/auth'
import { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'

const MS_PER_DAY = 86_400_000

export type ScenarioReviewSpec = Readonly<{
  rating: 1 | 2 | 3 | 4 | 5
  text?: string
  reviewerName?: string
  daysAgo: number
  /** If true, auto-create a reply (draft→submit→approve) for this review. */
  reply?: boolean
}>

export type ScenarioGoalSpec = Readonly<{
  name: string
  metricKey: string
  targetValue: number
}>

export type ScenarioGuestSpec = Readonly<{
  /** Number of scans to generate (spread over scanHistoryDays). */
  scans?: number
  /** Number of ratings to generate. */
  ratings?: number
  /** Number of feedback submissions to generate. */
  feedback?: number
  /** Spread interactions over this many days (default 30). */
  overDays?: number
}>

export type ScenarioPropertySpec = Readonly<{
  name: string
  slug: string
  reviews?: ReadonlyArray<ScenarioReviewSpec>
  scansPerDay?: number
  scanHistoryDays?: number
  /** Guest portal interactions (scans, ratings, feedback). */
  guest?: ScenarioGuestSpec
  /** Goals to create for this property. */
  goals?: ReadonlyArray<ScenarioGoalSpec>
}>

export type ScenarioSpec = Readonly<{
  organizationId: string
  properties: ReadonlyArray<ScenarioPropertySpec>
}>

export type ScenarioResult = Readonly<{
  reviewsCreated: number
  eventsEmitted: number
  propertiesCreated: number
  portalsCreated: number
  guestInteractions: number
  repliesCreated: number
  goalsCreated: number
}>

export async function buildScenario(
  container: Container,
  spec: ScenarioSpec,
): Promise<ScenarioResult> {
  const clock = container.clock
  const db = container.db
  const orgId = organizationId(spec.organizationId)
  const now = clock()
  const simUserId = userId('sim-user-00000000-0000-0000-0000-000000000001')
  let reviewsCreated = 0
  let eventsEmitted = 0
  let propertiesCreated = 0
  let portalsCreated = 0
  let guestInteractions = 0
  let repliesCreated = 0
  let goalsCreated = 0

  // ── Sim user + member (enables notification recipient lookup) ──
  await db
    .insert(user)
    .values({
      id: unbrand(simUserId),
      name: 'Sim Admin',
      email: 'sim-admin@test.local',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
  await db
    .insert(member)
    .values({
      id: crypto.randomUUID(),
      userId: unbrand(simUserId),
      organizationId: unbrand(orgId),
      role: 'owner',
      createdAt: now,
    })
    .onConflictDoNothing()
  for (const propSpec of spec.properties) {
    const propId = propertyId(crypto.randomUUID())

    // ── Property ──
    await db
      .insert(properties)
      .values({
        id: unbrand(propId),
        organizationId: unbrand(orgId),
        name: propSpec.name,
        slug: propSpec.slug,
        timezone: 'UTC',
      })
      .onConflictDoNothing()
    propertiesCreated++

    // ── Portal (required for guest interactions) ──
    const pId = portalId(crypto.randomUUID())
    await db.insert(portals).values({
      id: unbrand(pId),
      organizationId: unbrand(orgId),
      propertyId: unbrand(propId),
      entityType: 'property',
      entityId: unbrand(propId),
      name: `${propSpec.name} Portal`,
      slug: `${propSpec.slug}-portal`,
    })
    portalsCreated++

    // ── Staff assignment (links sim user to property for notification targeting) ──
    await db
      .insert(staffAssignments)
      .values({
        id: crypto.randomUUID(),
        organizationId: unbrand(orgId),
        userId: unbrand(simUserId),
        propertyId: unbrand(propId),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()

    // ── Reviews ──
    const createdReviewIds: string[] = []
    for (const reviewSpec of propSpec.reviews ?? []) {
      const rId = reviewId(crypto.randomUUID())
      const reviewedAt = new Date(now.getTime() - reviewSpec.daysAgo * MS_PER_DAY)
      const expiresAt = new Date(reviewedAt.getTime() + 30 * MS_PER_DAY)

      const review: Omit<Review, 'createdAt' | 'updatedAt'> = {
        id: rId,
        organizationId: orgId,
        propertyId: propId,
        platform: 'google',
        externalId: `sim-${unbrand(rId)}`,
        externalLocationId: `accounts/sim/locations/${unbrand(propId)}`,
        googleConnectionId: null,
        rating: reviewSpec.rating,
        text: reviewSpec.text ?? `Simulated ${reviewSpec.rating}-star review`,
        reviewerName: reviewSpec.reviewerName ?? `Sim Reviewer ${reviewsCreated + 1}`,
        reviewerProfilePhotoUrl: null,
        languageCode: 'en',
        reviewedAt,
        expiresAt,
        sentimentLabel: 'unknown',
        sentimentScore: null,
      }

      try {
        await container.reviewRepo.upsert(review, now)
        reviewsCreated++
        createdReviewIds.push(unbrand(rId))

        await container.eventBus.emit(
          reviewCreated({
            eventId: crypto.randomUUID(),
            reviewId: rId,
            propertyId: propId,
            organizationId: orgId,
            rating: reviewSpec.rating,
            platform: 'google',
            externalId: review.externalId,
            reviewerName: review.reviewerName,
            reviewText: review.text ?? null,
            occurredAt: now,
          }),
        )
        eventsEmitted++
      } catch {
        // Skip on conflict (idempotent)
      }

      // ── Reply lifecycle for selected reviews ──
      if (reviewSpec.reply) {
        try {
          await container.useCases.draftReply({
            reviewId: rId,
            organizationId: orgId,
            text: 'Thank you for your feedback! We appreciate it.',
            userId: simUserId,
            role: 'AccountAdmin',
          })
          await container.useCases.submitReply({
            reviewId: rId,
            organizationId: orgId,
            userId: simUserId,
            role: 'AccountAdmin',
          })
          await container.useCases.approveReply({
            reviewId: rId,
            organizationId: orgId,
            userId: simUserId,
            role: 'AccountAdmin',
          })
          repliesCreated++
        } catch (err) {
          // Reply may fail if review doesn't exist or state machine rejects
          container.logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              reviewId: unbrand(rId),
            },
            'Sim reply lifecycle failed',
          )
        }
      }
    }

    // ── Guest interactions (scans, ratings, feedback) ──
    const guestSpec = propSpec.guest
    if (guestSpec) {
      const overDays = guestSpec.overDays ?? 30

      // Scans
      for (let i = 0; i < (guestSpec.scans ?? 0); i++) {
        const daysAgo = Math.floor((i / Math.max(guestSpec.scans ?? 1, 1)) * overDays)
        const occurredAt = new Date(now.getTime() - daysAgo * MS_PER_DAY)
        const sId = scanEventId(crypto.randomUUID())
        const sessionId = `sim-session-${crypto.randomUUID()}`

        try {
          await db.insert(scanEvents).values({
            id: unbrand(sId),
            organizationId: unbrand(orgId),
            portalId: unbrand(pId),
            propertyId: unbrand(propId),
            source: 'qr',
            sessionId,
            ipHash: 'sim-hash',
          })
          await container.eventBus.emit(
            guestScanRecorded({
              eventId: crypto.randomUUID(),
              scanId: sId,
              organizationId: orgId,
              portalId: pId,
              propertyId: propId,
              source: 'qr',
              occurredAt,
            }),
          )
          guestInteractions++
          eventsEmitted++
        } catch {
          // Skip on error
        }
      }

      // Ratings
      for (let i = 0; i < (guestSpec.ratings ?? 0); i++) {
        const daysAgo = Math.floor((i / Math.max(guestSpec.ratings ?? 1, 1)) * overDays)
        const occurredAt = new Date(now.getTime() - daysAgo * MS_PER_DAY)
        const rId = ratingId(crypto.randomUUID())
        const sessionId = `sim-session-${crypto.randomUUID()}`
        const value = [1, 2, 3, 4, 5][i % 5]

        try {
          await db.insert(ratings).values({
            id: unbrand(rId),
            organizationId: unbrand(orgId),
            portalId: unbrand(pId),
            propertyId: unbrand(propId),
            sessionId,
            value,
            source: 'qr',
            ipHash: 'sim-hash',
          })
          await container.eventBus.emit(
            guestRatingSubmitted({
              eventId: crypto.randomUUID(),
              ratingId: rId,
              organizationId: orgId,
              portalId: pId,
              propertyId: propId,
              value,
              occurredAt,
            }),
          )
          guestInteractions++
          eventsEmitted++
        } catch {
          // Skip on error (unique constraint on session+portal)
        }
      }

      // Feedback
      for (let i = 0; i < (guestSpec.feedback ?? 0); i++) {
        const daysAgo = Math.floor((i / Math.max(guestSpec.feedback ?? 1, 1)) * overDays)
        const occurredAt = new Date(now.getTime() - daysAgo * MS_PER_DAY)
        const fId = feedbackId(crypto.randomUUID())
        const sessionId = `sim-session-${crypto.randomUUID()}`
        const comments = [
          'Great service!',
          'Room was clean and comfortable.',
          'Staff was very helpful.',
          'Would stay again.',
          'Breakfast could be better.',
        ]

        try {
          await db.insert(feedback).values({
            id: unbrand(fId),
            organizationId: unbrand(orgId),
            portalId: unbrand(pId),
            propertyId: unbrand(propId),
            sessionId,
            ratingId: null,
            comment: comments[i % comments.length],
            source: 'qr',
            ipHash: 'sim-hash',
          })
          await container.eventBus.emit(
            guestFeedbackSubmitted({
              eventId: crypto.randomUUID(),
              feedbackId: fId,
              organizationId: orgId,
              portalId: pId,
              propertyId: propId,
              ratingId: null,
              occurredAt,
            }),
          )
          guestInteractions++
          eventsEmitted++
        } catch {
          // Skip on error (unique constraint on session+portal)
        }
      }
    }

    // ── Scan metric readings (bulk history) ──
    // ── Goals ──
    for (const goalSpec of propSpec.goals ?? []) {
      try {
        await db.insert(goals).values({
          id: crypto.randomUUID(),
          organizationId: unbrand(orgId),
          propertyId: unbrand(propId),
          portalId: unbrand(pId),
          name: goalSpec.name,
          createdBy: unbrand(simUserId),
          goalType: 'open',
          aggregationFunction: 'sum',
          metricKey: goalSpec.metricKey,
          targetValue: goalSpec.targetValue,
          status: 'active',
          periodStart: new Date(now.getTime() - 15 * MS_PER_DAY),
          periodEnd: new Date(now.getTime() + 15 * MS_PER_DAY),
        })
        goalsCreated++
      } catch {
        // Skip on error
      }
    }

    if (propSpec.scansPerDay && propSpec.scanHistoryDays) {
      for (let d = 0; d < propSpec.scanHistoryDays; d++) {
        const recordedAt = new Date(now.getTime() - d * MS_PER_DAY)
        try {
          await db.insert(metricReadings).values({
            id: crypto.randomUUID(),
            organizationId: unbrand(orgId),
            propertyId: unbrand(propId),
            portalId: null,
            metricKey: 'portal.scan',
            value: propSpec.scansPerDay,
            occurredAt: recordedAt,
          })
          // Also create portal-scoped readings for badge streak evaluation
          await db.insert(metricReadings).values({
            id: crypto.randomUUID(),
            organizationId: unbrand(orgId),
            propertyId: unbrand(propId),
            portalId: unbrand(pId),
            metricKey: 'portal.scan',
            value: propSpec.scansPerDay,
            occurredAt: recordedAt,
          })
        } catch {
          // Skip on error
        }
      }
    }
  }

  return {
    reviewsCreated,
    eventsEmitted,
    propertiesCreated,
    portalsCreated,
    guestInteractions,
    repliesCreated,
    goalsCreated,
  }
}
