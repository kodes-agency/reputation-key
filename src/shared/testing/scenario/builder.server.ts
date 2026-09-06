// Scenario builder — generates realistic, backdated test data via the
// container's repos and use-cases. Every fact it announces is an outbox row;
// the caller drains them through the container's durable consumers
// (`SimulationHandle.drainOutbox`) to materialise projections.
//
// Reviews and guest interactions carry explicit timestamps (not DB defaults)
// so the simulation controls the time dimension (ADR 0017).

import type { SimulationContainer } from '#/composition'
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
import {
  metricDefinitionVersions,
  metricReadings,
} from '#/shared/db/schema/metric.schema'
import { goals } from '#/shared/db/schema/goal.schema'
import { user, member, organization } from '#/shared/db/schema/auth'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { DomainEvent } from '#/shared/events/events'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'

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
  factsRecorded: number
  propertiesCreated: number
  portalsCreated: number
  guestInteractions: number
  repliesCreated: number
  goalsCreated: number
}>

// ── Shared context for all helpers ──────────────────────────────────

type Ctx = Readonly<{
  db: SimulationContainer['db']
  container: SimulationContainer
  orgId: ReturnType<typeof organizationId>
  simUserId: ReturnType<typeof userId>
  now: Date
}>

/** Record a scenario fact the way a command store would: one outbox row. */
async function recordFact(ctx: Ctx, event: DomainEvent): Promise<void> {
  await ctx.db.transaction((tx) =>
    insertOutboxRow(tx, event, { recordedAt: event.occurredAt }),
  )
}

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
      // What production writers persist for a US property: routing reads
      // and the relay fence filter on data_cell_id (until WP3.2b).
      processingRegion: 'us',
      dataCellId: 'us',
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
    // The domain default; a portal row without primaryColor fails the mapper
    // every consumer that reads the portal goes through.
    theme: { primaryColor: '#6366F1' },
  })

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
      translatedText: null,
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
      // A fetch clock is what makes this a provider OBSERVATION rather than a
      // bare row write. `reviewRepo.upsert` routes a review carrying both
      // `lastFetchedAt` and `contentExpiresAt` through
      // `persistReviewObservation` -- the same adapter the Google sync path
      // uses -- which records the material_review_revisions and
      // review_source_observations rows the review is not legally a review
      // without. Without it the upsert took the pre-observation compatibility
      // branch, and every downstream write with a
      // `..._material_revision_fk` (reply_publication_authorizations, the
      // Inbox handling cycle) failed against a revision that was never
      // written. ADR 0031 derives the expiry from the fetch, never from
      // `reviewedAt`, so a backdated review still gets a live content clock.
      contentExpiresAt: contentExpiresAtFromFetch(ctx.now),
      contentHash: null,
      sourceSeenGeneration: null,
      // `sourceEpoch` is 0-based (0060 relaxed the AI-plane CHECK to >= 0), but
      // `sourceRevision` and `analysisSequence` are 1-based: `reviewCreated`
      // asserts both are POSITIVE, and review-command-store takes the sequence
      // from a DB sequence it asserts > 0 before attaching it. Seeding zeroes
      // persisted the review and then threw on the announcement, which is what
      // produced 126 reviews with no inbox item and a five-minute red gate.
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      aiSourceByteLength: 1,
      aiSourceDigest: '0'.repeat(64),
    }
    try {
      // 'ongoing' is the honest origin: the scenario models reviews arriving
      // on the live provider stream, each observed once, now. It is also the
      // only origin that yields a `measured` response target (the provider
      // timestamp is in the past, so it is usable), which is the state the
      // SLA and Inbox invariants exist to check.
      const observed = await ctx.container.simulationRuntime.review.upsert(
        review,
        ctx.now,
        undefined,
        'ongoing',
      )
      await recordFact(
        ctx,
        reviewCreated({
          reviewId: rId,
          propertyId: propId,
          organizationId: ctx.orgId,
          platform: 'google',
          // Announce what was PERSISTED. The observation adapter derives the
          // material revision itself, and Inbox validates the announced
          // revision against the material revision history -- announcing the
          // requested value would desynchronise the two the moment the
          // adapter's derivation and this fixture disagreed.
          sourceEpoch: observed.sourceEpoch,
          sourceRevision: observed.sourceRevision,
          analysisSequence: observed.analysisSequence,
          occurredAt: ctx.now,
        }),
      )
      created++
      events++
    } catch (err) {
      // Was a bare `catch { /* idempotent */ }`. The upsert COMMITS before the
      // fact is recorded, so a throw here left a persisted review with no
      // outbox row and no diagnostic -- which is exactly the shape the
      // review-inbox-consistency invariant reports, five minutes later, with no
      // cause attached. Mirrors the reply path below -- and logs the message
      // only: `reviewId` is a banned log key under BQC-7.3, and the assertion
      // text is what names the defect anyway.
      ctx.container.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Sim review create/emit failed',
      )
    }

    if (spec.reply) {
      try {
        const replyCtx = {
          organizationId: ctx.orgId,
          userId: ctx.simUserId,
          role: 'AccountAdmin',
        } as AuthContext
        await ctx.container.reviewPublicApi.reply.draft(
          { reviewId: rId, text: 'Thank you!' },
          replyCtx,
        )
        await ctx.container.reviewPublicApi.reply.submit({ reviewId: rId }, replyCtx)
        await ctx.container.reviewPublicApi.reply.approve({ reviewId: rId }, replyCtx)
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

type GuestInteraction = Readonly<{
  kind: 'scan' | 'rating' | 'feedback'
  count: number
  /** Insert the row and return the fact that announces it. */
  write: (i: number, occurredAt: Date) => Promise<DomainEvent>
}>

async function createGuestData(
  ctx: Ctx,
  pId: ReturnType<typeof portalId>,
  propId: ReturnType<typeof propertyId>,
  guestSpec: ScenarioGuestSpec,
): Promise<{ interactions: number; events: number }> {
  const overDays = guestSpec.overDays ?? 30
  // Metric definitions are effective from a seeded date; a reading before it
  // is quarantined (definition_version_not_effective), so the backdating floor
  // is the newest effective_from rather than an arbitrary day count.
  const versions = await ctx.db
    .select({ effectiveFrom: metricDefinitionVersions.effectiveFrom })
    .from(metricDefinitionVersions)
  const floorAt = Math.max(0, ...versions.map((v) => v.effectiveFrom.getTime()))
  const common = {
    organizationId: unbrand(ctx.orgId),
    portalId: unbrand(pId),
    propertyId: unbrand(propId),
    source: 'qr' as const,
    ipHash: 'sim',
  }
  const session = () => `sim-${crypto.randomUUID()}`
  const comments = [
    'Great service!',
    'Clean room.',
    'Helpful staff.',
    'Would return.',
    'Breakfast OK.',
  ]

  const interactions: GuestInteraction[] = [
    {
      kind: 'scan',
      count: guestSpec.scans ?? 0,
      write: async (_i, occurredAt) => {
        const sId = scanEventId(crypto.randomUUID())
        await ctx.db
          .insert(scanEvents)
          .values({ ...common, id: unbrand(sId), sessionId: session() })
        return guestScanRecorded({
          scanId: sId,
          organizationId: ctx.orgId,
          portalId: pId,
          propertyId: propId,
          scanSource: 'qr',
          occurredAt,
        })
      },
    },
    {
      kind: 'rating',
      count: guestSpec.ratings ?? 0,
      write: async (i, occurredAt) => {
        const rId = ratingId(crypto.randomUUID())
        const value = [1, 2, 3, 4, 5][i % 5]
        await ctx.db
          .insert(ratings)
          .values({ ...common, id: unbrand(rId), sessionId: session(), value })
        return guestRatingSubmitted({
          ratingId: rId,
          organizationId: ctx.orgId,
          portalId: pId,
          propertyId: propId,
          value,
          occurredAt,
        })
      },
    },
    {
      kind: 'feedback',
      count: guestSpec.feedback ?? 0,
      write: async (i, occurredAt) => {
        const fId = feedbackId(crypto.randomUUID())
        await ctx.db.insert(feedback).values({
          ...common,
          id: unbrand(fId),
          sessionId: session(),
          ratingId: null,
          comment: comments[i % comments.length],
        })
        return guestFeedbackSubmitted({
          feedbackId: fId,
          organizationId: ctx.orgId,
          portalId: pId,
          propertyId: propId,
          ratingId: null,
          occurredAt,
        })
      },
    },
  ]

  let created = 0
  for (const interaction of interactions) {
    for (let i = 0; i < interaction.count; i++) {
      const daysAgo = Math.floor((i / Math.max(interaction.count, 1)) * overDays)
      const occurredAt = new Date(
        Math.max(ctx.now.getTime() - daysAgo * MS_PER_DAY, floorAt),
      )
      try {
        await recordFact(ctx, await interaction.write(i, occurredAt))
        created++
      } catch (err) {
        // These aggregates are covered by NO invariant checker, so a swallowed
        // insert failure would be invisible in both directions. Message only:
        // id-shaped log keys are banned under BQC-7.3.
        ctx.container.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          `Sim guest ${interaction.kind} create failed`,
        )
      }
    }
  }

  return { interactions: created, events: created }
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
    } catch (err) {
      ctx.container.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Sim goal create failed',
      )
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
    const at = new Date(ctx.now.getTime() - d * MS_PER_DAY)
    // `occurredAt` is the drizzle field for the `recorded_at` INGESTION column;
    // the dashboard filters and buckets on `eventAt` / `propertyLocalDate`
    // (see metricPeriodWhere in dashboard/infrastructure/read-facade.ts).
    // Scenario properties are created with timezone 'UTC' above, so the local
    // date is the UTC date. Without these the scans are invisible to the
    // dashboard, exactly as an ungoverned production write would be.
    const propertyLocalDate = at.toISOString().slice(0, 10)
    try {
      await ctx.db.insert(metricReadings).values({
        id: crypto.randomUUID(),
        organizationId: unbrand(ctx.orgId),
        propertyId: unbrand(propId),
        portalId: null,
        metricKey: 'portal.scan',
        value: scansPerDay,
        occurredAt: at,
        eventAt: at,
        propertyLocalDate,
      })
      await ctx.db.insert(metricReadings).values({
        id: crypto.randomUUID(),
        organizationId: unbrand(ctx.orgId),
        propertyId: unbrand(propId),
        portalId: unbrand(pId),
        metricKey: 'portal.scan',
        value: scansPerDay,
        occurredAt: at,
        eventAt: at,
        propertyLocalDate,
      })
    } catch (err) {
      ctx.container.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Sim metric reading create failed',
      )
    }
  }
}

// ── Main entry point ────────────────────────────────────────────────

export async function buildScenario(
  container: SimulationContainer,
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
    factsRecorded = 0,
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
    factsRecorded += r.events
    repliesCreated += r.replies

    if (propSpec.guest) {
      const g = await createGuestData(ctx, pId, propId, propSpec.guest)
      guestInteractions += g.interactions
      factsRecorded += g.events
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
    factsRecorded,
    propertiesCreated,
    portalsCreated,
    guestInteractions,
    repliesCreated,
    goalsCreated,
  }
}
