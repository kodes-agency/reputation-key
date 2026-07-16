// Scenario builder — generates realistic, backdated test data via the
// container's repos, event bus, and use-cases.
//
// Reviews and guest interactions carry explicit timestamps (not DB defaults)
// so the simulation controls the time dimension (ADR 0017).

import type { Container } from '#/composition'
import type { AuthContext } from '#/shared/domain/auth-context'
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
import { user, member, organization } from '#/shared/db/schema/auth'
import { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'

const MS_PER_DAY = 86_400_000

export type ScenarioReviewSpec = Readonly<{
  rating: 1 | 2 | 3 | 4 | 5
  text?: string
  reviewerName?: string
  daysAgo: number
  reply?: boolean
}>

export type ScenarioGoalSpec = Readonly<{
  name: string
  metricKey: string
  targetValue: number
}>

export type ScenarioGuestSpec = Readonly<{
  scans?: number
  ratings?: number
  feedback?: number
  overDays?: number
}>

export type ScenarioPropertySpec = Readonly<{
  name: string
  slug: string
  reviews?: ReadonlyArray<ScenarioReviewSpec>
  scansPerDay?: number
  scanHistoryDays?: number
  guest?: ScenarioGuestSpec
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

// ── Shared context for all helpers ──────────────────────────────────

type Ctx = Readonly<{
  db: Container['db']
  container: Container
  orgId: ReturnType<typeof organizationId>
  simUserId: ReturnType<typeof userId>
  now: Date
}>

// ── Helpers ─────────────────────────────────────────────────────────

async function seedSimUser(ctx: Ctx): Promise<void> {
  // Create organization first (member FK requires it to exist)
  await ctx.db
    .insert(organization)
    .values({
      id: unbrand(ctx.orgId),
      name: 'Sim Organization',
      slug: `sim-org-${ctx.now.getTime()}`,
      createdAt: ctx.now,
    })
    .onConflictDoNothing()
  await ctx.db
    .insert(user)
    .values({
      id: unbrand(ctx.simUserId),
      name: 'Sim Admin',
      email: 'sim-admin@test.local',
      emailVerified: true,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoNothing()
  await ctx.db
    .insert(member)
    .values({
      id: crypto.randomUUID(),
      userId: unbrand(ctx.simUserId),
      organizationId: unbrand(ctx.orgId),
      role: 'owner',
      createdAt: ctx.now,
    })
    .onConflictDoNothing()
}

async function createPropertyAndPortal(
  ctx: Ctx,
  propSpec: ScenarioPropertySpec,
): Promise<{
  propId: ReturnType<typeof propertyId>
  portalId: ReturnType<typeof portalId>
}> {
  const propId = propertyId(crypto.randomUUID())
  const pId = portalId(crypto.randomUUID())

  await ctx.db
    .insert(properties)
    .values({
      id: unbrand(propId),
      organizationId: unbrand(ctx.orgId),
      name: propSpec.name,
      slug: propSpec.slug,
      timezone: 'UTC',
    })
    .onConflictDoNothing()

  await ctx.db.insert(portals).values({
    id: unbrand(pId),
    organizationId: unbrand(ctx.orgId),
    propertyId: unbrand(propId),
    entityType: 'property',
    entityId: unbrand(propId),
    name: `${propSpec.name} Portal`,
    slug: `${propSpec.slug}-portal`,
  })

  await ctx.db
    .insert(staffAssignments)
    .values({
      id: crypto.randomUUID(),
      organizationId: unbrand(ctx.orgId),
      userId: unbrand(ctx.simUserId),
      propertyId: unbrand(propId),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoNothing()

  return { propId, portalId: pId }
}

async function createReviews(
  ctx: Ctx,
  propId: ReturnType<typeof propertyId>,
  reviews: ReadonlyArray<ScenarioReviewSpec>,
): Promise<{ created: number; events: number; replies: number }> {
  let created = 0,
    events = 0,
    replies = 0

  for (const spec of reviews) {
    const rId = reviewId(crypto.randomUUID())
    const reviewedAt = new Date(ctx.now.getTime() - spec.daysAgo * MS_PER_DAY)
    const review: Omit<Review, 'createdAt' | 'updatedAt'> = {
      id: rId,
      organizationId: ctx.orgId,
      propertyId: propId,
      platform: 'google',
      externalId: `sim-${unbrand(rId)}`,
      externalLocationId: `accounts/sim/locations/${unbrand(propId)}`,
      googleConnectionId: null,
      rating: spec.rating,
      text: spec.text ?? `Simulated ${spec.rating}-star review`,
      reviewerName: spec.reviewerName ?? `Sim Reviewer ${created + 1}`,
      reviewerProfilePhotoUrl: null,
      languageCode: 'en',
      reviewedAt,
      expiresAt: new Date(reviewedAt.getTime() + 30 * MS_PER_DAY),
      sentimentLabel: 'unknown',
      sentimentScore: null,
      sourceCreatedAt: reviewedAt,
      sourceUpdatedAt: null,
      firstFetchedAt: ctx.now,
      lastFetchedAt: ctx.now,
      contentExpiresAt: null,
      contentHash: null,
      sourceSeenGeneration: null,
    }
    try {
      await ctx.container.reviewRepo.upsert(review, ctx.now)
      await ctx.container.eventBus.emit(
        reviewCreated({
          reviewId: rId,
          propertyId: propId,
          organizationId: ctx.orgId,
          rating: spec.rating,
          platform: 'google',
          externalId: review.externalId,
          reviewerName: review.reviewerName,
          reviewText: review.text ?? null,
          occurredAt: ctx.now,
        }),
      )
      created++
      events++
    } catch {
      /* idempotent */
    }

    if (spec.reply) {
      try {
        const replyCtx = {
          organizationId: ctx.orgId,
          userId: ctx.simUserId,
          role: 'AccountAdmin',
        } as AuthContext
        await ctx.container.useCases.draftReply(
          { reviewId: rId, text: 'Thank you!' },
          replyCtx,
        )
        await ctx.container.useCases.submitReply({ reviewId: rId }, replyCtx)
        await ctx.container.useCases.approveReply({ reviewId: rId }, replyCtx)
        replies++
      } catch (err) {
        ctx.container.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Sim reply failed',
        )
      }
    }
  }
  return { created, events, replies }
}

async function createGuestData(
  ctx: Ctx,
  pId: ReturnType<typeof portalId>,
  propId: ReturnType<typeof propertyId>,
  guestSpec: ScenarioGuestSpec,
): Promise<{ interactions: number; events: number }> {
  let interactions = 0,
    events = 0
  const overDays = guestSpec.overDays ?? 30

  for (let i = 0; i < (guestSpec.scans ?? 0); i++) {
    const daysAgo = Math.floor((i / Math.max(guestSpec.scans ?? 1, 1)) * overDays)
    const sId = scanEventId(crypto.randomUUID())
    try {
      await ctx.db.insert(scanEvents).values({
        id: unbrand(sId),
        organizationId: unbrand(ctx.orgId),
        portalId: unbrand(pId),
        propertyId: unbrand(propId),
        source: 'qr',
        sessionId: `sim-${crypto.randomUUID()}`,
        ipHash: 'sim',
      })
      await ctx.container.eventBus.emit(
        guestScanRecorded({
          scanId: sId,
          organizationId: ctx.orgId,
          portalId: pId,
          propertyId: propId,
          source: 'qr',
          occurredAt: new Date(ctx.now.getTime() - daysAgo * MS_PER_DAY),
        }),
      )
      interactions++
      events++
    } catch {
      /* skip */
    }
  }

  for (let i = 0; i < (guestSpec.ratings ?? 0); i++) {
    const daysAgo = Math.floor((i / Math.max(guestSpec.ratings ?? 1, 1)) * overDays)
    const rId = ratingId(crypto.randomUUID())
    const value = [1, 2, 3, 4, 5][i % 5]
    try {
      await ctx.db.insert(ratings).values({
        id: unbrand(rId),
        organizationId: unbrand(ctx.orgId),
        portalId: unbrand(pId),
        propertyId: unbrand(propId),
        sessionId: `sim-${crypto.randomUUID()}`,
        value,
        source: 'qr',
        ipHash: 'sim',
      })
      await ctx.container.eventBus.emit(
        guestRatingSubmitted({
          ratingId: rId,
          organizationId: ctx.orgId,
          portalId: pId,
          propertyId: propId,
          value,
          occurredAt: new Date(ctx.now.getTime() - daysAgo * MS_PER_DAY),
        }),
      )
      interactions++
      events++
    } catch {
      /* skip */
    }
  }

  const comments = [
    'Great service!',
    'Clean room.',
    'Helpful staff.',
    'Would return.',
    'Breakfast OK.',
  ]
  for (let i = 0; i < (guestSpec.feedback ?? 0); i++) {
    const daysAgo = Math.floor((i / Math.max(guestSpec.feedback ?? 1, 1)) * overDays)
    const fId = feedbackId(crypto.randomUUID())
    try {
      await ctx.db.insert(feedback).values({
        id: unbrand(fId),
        organizationId: unbrand(ctx.orgId),
        portalId: unbrand(pId),
        propertyId: unbrand(propId),
        sessionId: `sim-${crypto.randomUUID()}`,
        ratingId: null,
        comment: comments[i % comments.length],
        source: 'qr',
        ipHash: 'sim',
      })
      await ctx.container.eventBus.emit(
        guestFeedbackSubmitted({
          feedbackId: fId,
          organizationId: ctx.orgId,
          portalId: pId,
          propertyId: propId,
          ratingId: null,
          occurredAt: new Date(ctx.now.getTime() - daysAgo * MS_PER_DAY),
        }),
      )
      interactions++
      events++
    } catch {
      /* skip */
    }
  }

  return { interactions, events }
}

async function createGoals(
  ctx: Ctx,
  propId: ReturnType<typeof propertyId>,
  pId: ReturnType<typeof portalId>,
  goalSpecs: ReadonlyArray<ScenarioGoalSpec>,
): Promise<number> {
  let created = 0
  for (const spec of goalSpecs) {
    try {
      await ctx.db.insert(goals).values({
        id: crypto.randomUUID(),
        organizationId: unbrand(ctx.orgId),
        propertyId: unbrand(propId),
        portalId: unbrand(pId),
        name: spec.name,
        createdBy: unbrand(ctx.simUserId),
        goalType: 'open',
        aggregationFunction: 'sum',
        metricKey: spec.metricKey,
        targetValue: spec.targetValue,
        status: 'active',
        periodStart: new Date(ctx.now.getTime() - 15 * MS_PER_DAY),
        periodEnd: new Date(ctx.now.getTime() + 15 * MS_PER_DAY),
      })
      created++
    } catch {
      /* skip */
    }
  }
  return created
}

async function createMetricHistory(
  ctx: Ctx,
  propId: ReturnType<typeof propertyId>,
  pId: ReturnType<typeof portalId>,
  scansPerDay: number,
  scanHistoryDays: number,
): Promise<void> {
  for (let d = 0; d < scanHistoryDays; d++) {
    const recordedAt = new Date(ctx.now.getTime() - d * MS_PER_DAY)
    try {
      await ctx.db.insert(metricReadings).values({
        id: crypto.randomUUID(),
        organizationId: unbrand(ctx.orgId),
        propertyId: unbrand(propId),
        portalId: null,
        metricKey: 'portal.scan',
        value: scansPerDay,
        occurredAt: recordedAt,
      })
      await ctx.db.insert(metricReadings).values({
        id: crypto.randomUUID(),
        organizationId: unbrand(ctx.orgId),
        propertyId: unbrand(propId),
        portalId: unbrand(pId),
        metricKey: 'portal.scan',
        value: scansPerDay,
        occurredAt: recordedAt,
      })
    } catch {
      /* skip */
    }
  }
}

// ── Main entry point ────────────────────────────────────────────────

export async function buildScenario(
  container: Container,
  spec: ScenarioSpec,
): Promise<ScenarioResult> {
  const ctx: Ctx = {
    db: container.db,
    container,
    orgId: organizationId(spec.organizationId),
    simUserId: userId('sim-user-00000000-0000-0000-0000-000000000001'),
    now: container.clock(),
  }

  await seedSimUser(ctx)

  let reviewsCreated = 0,
    eventsEmitted = 0,
    propertiesCreated = 0
  let portalsCreated = 0,
    guestInteractions = 0,
    repliesCreated = 0,
    goalsCreated = 0

  for (const propSpec of spec.properties) {
    const { propId, portalId: pId } = await createPropertyAndPortal(ctx, propSpec)
    propertiesCreated++
    portalsCreated++

    const r = await createReviews(ctx, propId, propSpec.reviews ?? [])
    reviewsCreated += r.created
    eventsEmitted += r.events
    repliesCreated += r.replies

    if (propSpec.guest) {
      const g = await createGuestData(ctx, pId, propId, propSpec.guest)
      guestInteractions += g.interactions
      eventsEmitted += g.events
    }

    goalsCreated += await createGoals(ctx, propId, pId, propSpec.goals ?? [])

    if (propSpec.scansPerDay && propSpec.scanHistoryDays) {
      await createMetricHistory(
        ctx,
        propId,
        pId,
        propSpec.scansPerDay,
        propSpec.scanHistoryDays,
      )
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
