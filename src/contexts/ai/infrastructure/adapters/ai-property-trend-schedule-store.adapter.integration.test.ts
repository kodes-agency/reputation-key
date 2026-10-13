// The Property Trend scheduler against real PostgreSQL.
//
// `scheduleDueBatch` is one cross-tenant statement that decides which
// Properties get a trend generation: the merchant's AI authorization must be
// enabled for Property Trends at the current epochs, Review Analysis must have
// caught up under that same authorization, and the Property's local time must
// have passed 02:15. `lockCurrentScheduleBinding` asks the same question again
// before an outcome is stored. Both were reached only through a mocked port.
//
// The statement reads the database clock, so each fixture Property is given
// the zone in which it is noon (due) or just after midnight (not yet due) at
// the moment the suite runs.
//
// A revoked authorization is kept out several times over: the capability check
// (a CHECK empties the capability set of a revoked or disabled authorization,
// so `state = 'enabled'` never decides alone), and the enrollment and aggregate
// joins, because a revoke advances the state version and every epoch. The
// fixtures therefore also hold the cases one clause decides: an authorization
// without Property Trends, a consent given again while the enrollment is still
// the earlier one, an analysis that has not caught up, and a Property before
// its local run time.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyAggregateHeads,
  aiPropertyProcessingProfiles,
  aiPropertyTrendSchedulerHeads,
  aiPropertyTrendSchedules,
  aiReviewAnalysisEnrollments,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  AI_PROPERTY_TREND_DEFINITION_DIGEST,
  AI_PROPERTY_TREND_DEFINITION_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
} from '#/shared/ai-property-trend-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { AiTrendEvidence } from '../../application/ports/ai-output-store.port'
import { createAiPropertyTrendScheduleStore } from './ai-property-trend-schedule-store.adapter'

const ORGANIZATION_ID = 'ai-trend-schedule-store-test'
const OTHER_ORGANIZATION_ID = 'ai-trend-schedule-store-test-other'
const ACTOR = 'ai-trend-schedule-test-actor'
const SCHEDULER_KEY = 'property-trend-v1'
const LEASE_OWNER = '7e000000-0000-4000-8000-0000000000a1'
const OTHER_LEASE_OWNER = '7e000000-0000-4000-8000-0000000000a2'
const EMPTY_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const NOON = 12
const AFTER_MIDNIGHT = 0
const HOURS_PER_DAY = 24
const MAX_DRAIN_BATCHES = 50

const TRENDS = ['review_analysis', 'property_trends'] as const
const ANALYSIS_ONLY = ['review_analysis'] as const
type Capabilities = typeof TRENDS | typeof ANALYSIS_ONLY | readonly []

const RUNTIME_PROFILES = {
  review_analysis: 'review-analysis-runtime-v1',
  property_trends: 'property-trends-runtime-v1',
} as const

function runtimeProfilesOf(capabilities: Capabilities): Record<string, string> {
  return Object.fromEntries(
    capabilities.map((capability) => [capability, RUNTIME_PROFILES[capability]]),
  )
}

const uuid = (group: string, index: number): string =>
  `7e${group}0000-0000-4000-8000-${String(index).padStart(12, '0')}`

/** The fixed-offset zone in which the local hour is `localHour` right now. */
function zoneWhereLocalHourIs(localHour: number, now: Date): string {
  const offset =
    ((localHour - now.getUTCHours() + HOURS_PER_DAY + NOON) % HOURS_PER_DAY) - NOON
  // POSIX names invert the sign: Etc/GMT-3 is three hours ahead of UTC.
  return offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

type Fixture = Readonly<{
  propertyId: string
  lineageId: string
  organizationId: string
}>

const fixture = (index: number, organizationId = ORGANIZATION_ID): Fixture => ({
  propertyId: uuid('10', index),
  lineageId: uuid('20', index),
  organizationId,
})

const DUE = fixture(1)
const DUE_THEN_REVOKED = fixture(2)
const REVOKED = fixture(3)
const WITHOUT_TRENDS = fixture(4)
const RECONSENTED = fixture(5)
const ANALYSIS_BEHIND = fixture(6)
const BEFORE_LOCAL_RUN_TIME = fixture(7)
const OTHER_TENANT_DUE = fixture(8, OTHER_ORGANIZATION_ID)
const ALL = [
  DUE,
  DUE_THEN_REVOKED,
  REVOKED,
  WITHOUT_TRENDS,
  RECONSENTED,
  ANALYSIS_BEHIND,
  BEFORE_LOCAL_RUN_TIME,
  OTHER_TENANT_DUE,
] as const
const ORGANIZATIONS = [ORGANIZATION_ID, OTHER_ORGANIZATION_ID] as const

const db = getDb()
// The scan is cross-tenant, so on a shared database it may schedule a Property
// another suite left behind. Every id it mints is kept, and removed afterwards.
const mintedScheduleIds: string[] = []
const store = createAiPropertyTrendScheduleStore(db, () => {
  const id = randomUUID()
  mintedScheduleIds.push(id)
  return id
})

type AuthorizationState = Readonly<{
  stateVersion: number
  transitionKind: 'enable' | 'change' | 'revoke'
  state: 'enabled' | 'revoked'
  capabilities: Capabilities
  epoch: number
}>

/**
 * Writes one authorization transition the way `apply_merchant_ai_transition_v1`
 * does: an evidence row, then the head that points at it.
 */
async function applyAuthorization(
  target: Fixture,
  next: AuthorizationState,
): Promise<void> {
  const row = {
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    authorizationLineageId: target.lineageId,
    state: next.state,
    capabilities: [...next.capabilities],
    capabilityRuntimeProfileVersions: runtimeProfilesOf(next.capabilities),
    reviewAnalysisEpoch: next.epoch,
    replyDraftingEpoch: next.epoch,
    propertyTrendsEpoch: next.epoch,
    authorizedSourceEpoch: 0,
    analysisStartSequence: 0,
    stateVersion: next.stateVersion,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    processingRegion: 'global' as const,
    providerDeploymentProfileVersion: 'private-beta-global-v1' as const,
    redactionProfileFamily: 'gbp-review-global-v1',
  }
  const occurredAt = new Date()
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...row,
      transitionKind: next.transitionKind,
      actorUserId: ACTOR,
      reasonCode: `merchant_${next.transitionKind}`,
      idempotencyKey: `${target.propertyId}-v${next.stateVersion}`,
      requestHash: 'd'.repeat(64),
      occurredAt,
    })
    await tx
      .insert(merchantAiEnablement)
      .values({ ...row, updatedBy: ACTOR, updatedAt: occurredAt })
      .onConflictDoUpdate({
        target: merchantAiEnablement.propertyId,
        set: { ...row, updatedBy: ACTOR, updatedAt: occurredAt },
      })
  })
}

const enabledFor = (capabilities: Capabilities): AuthorizationState => ({
  stateVersion: 1,
  transitionKind: 'enable',
  state: 'enabled',
  capabilities,
  epoch: 1,
})

const REVOKE: AuthorizationState = {
  stateVersion: 2,
  transitionKind: 'revoke',
  state: 'revoked',
  capabilities: [],
  epoch: 2,
}

/** Consent given again under a changed notice: every epoch advances. */
const RECONSENT: AuthorizationState = {
  stateVersion: 2,
  transitionKind: 'change',
  state: 'enabled',
  capabilities: TRENDS,
  epoch: 2,
}

async function seedAggregateHead(target: Fixture, epoch: number): Promise<void> {
  await db.insert(aiPropertyAggregateHeads).values({
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    sourceEpoch: 0,
    reviewAnalysisEpoch: epoch,
    propertyProfileVersion: 1,
    aggregateRevision: 0,
    terminalAnalysisSequence: 0,
    settledAnalysisCount: 0,
    updatedAt: new Date(),
  })
}

/**
 * A Property that is ready for a trend: active, profiled, authorized for
 * `capabilities`, and with Review Analysis caught up under that authorization.
 * `analysisHead` is how many reviews the allocator has numbered; none is
 * settled, so anything above zero leaves the analysis behind.
 */
async function seedProperty(
  target: Fixture,
  options: Readonly<{
    timezone: string
    capabilities: Capabilities
    analysisHead?: number
  }>,
): Promise<void> {
  const now = new Date()
  const index = ALL.indexOf(target) + 1
  await db.insert(properties).values({
    id: target.propertyId,
    organizationId: target.organizationId,
    name: `AI trend schedule test property ${index}`,
    slug: `ai-trend-schedule-test-property-${index}`,
    timezone: options.timezone,
    countryCode: 'BG',
    profileVersion: 1,
    sourceEpoch: 0,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    sourceEpoch: 0,
    headSequence: options.analysisHead ?? 0,
    createdAt: now,
    updatedAt: now,
  })
  await applyAuthorization(target, enabledFor(options.capabilities))
  await db.insert(aiPropertyProcessingProfiles).values({
    propertyId: target.propertyId,
    organizationId: target.organizationId,
    countryCode: 'BG',
    timezone: options.timezone,
    processingRegion: 'global',
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    sourceEpoch: 0,
    profileVersion: 1,
    lifecycleState: 'active',
    updatedAt: now,
  })
  await db.insert(aiReviewAnalysisEnrollments).values({
    id: uuid('40', index),
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    authorizationLineageId: target.lineageId,
    authorizationStateVersion: 1,
    sourceEpoch: 0,
    reviewAnalysisEpoch: 1,
    analysisStartSequence: 0,
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    triggerEventEnvelopeId: uuid('50', index),
    state: 'caught_up',
    snapshotRevisionCount: 0,
    snapshotRevisionSetDigest: EMPTY_SET_DIGEST,
    snapshotCapturedAt: now,
    caughtUpEligibleRevisionCount: 0,
    caughtUpAnalysisSequence: 0,
    caughtUpRevisionSetDigest: EMPTY_SET_DIGEST,
    caughtUpAt: now,
    terminalReason: 'eligible_revision_set_caught_up',
    terminalAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await seedAggregateHead(target, 1)
}

async function clearFixture(): Promise<void> {
  await db
    .delete(outboxEvents)
    .where(inArray(outboxEvents.organizationId, [...ORGANIZATIONS]))
  await db.delete(properties).where(
    inArray(
      properties.id,
      ALL.map((target) => target.propertyId),
    ),
  )
  await deleteTestOrganizations(db, [...ORGANIZATIONS])
}

/** Removes every schedule this run wrote, and its fact, whichever tenant it named. */
async function removeMintedSchedules(): Promise<void> {
  if (mintedScheduleIds.length === 0) return
  const minted = await db
    .select({ outboxEventId: aiPropertyTrendSchedules.outboxEventId })
    .from(aiPropertyTrendSchedules)
    .where(inArray(aiPropertyTrendSchedules.id, mintedScheduleIds))
  if (minted.length > 0) {
    await db.delete(outboxEvents).where(
      inArray(
        outboxEvents.id,
        minted.map(({ outboxEventId }) => outboxEventId),
      ),
    )
  }
  await db
    .delete(aiPropertyTrendSchedules)
    .where(inArray(aiPropertyTrendSchedules.id, mintedScheduleIds))
}

/**
 * Hands the shared scheduler head back unleased and at the start of its scan.
 * The row is seeded by a migration; it is restored here if a suite that resets
 * tables ran first.
 */
async function releaseSchedulerHead(): Promise<void> {
  await db
    .insert(aiPropertyTrendSchedulerHeads)
    .values({ schedulerKey: SCHEDULER_KEY, generation: 0, updatedAt: new Date() })
    .onConflictDoNothing()
  await db
    .update(aiPropertyTrendSchedulerHeads)
    .set({
      cursorOrganizationId: null,
      cursorPropertyId: null,
      leaseOwner: null,
      claimedAt: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(aiPropertyTrendSchedulerHeads.schedulerKey, SCHEDULER_KEY))
}

/** Runs the scheduler until its scan of every tenant is complete. */
async function scheduleEverythingDue(): Promise<void> {
  for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch += 1) {
    const result = await store.scheduleDueBatch({ leaseOwner: LEASE_OWNER })
    if (result.status !== 'scheduled') {
      throw new Error(`Scheduler answered ${result.status} during the drain`)
    }
    if (!result.hasMore) return
  }
  throw new Error('Scheduler did not finish its scan')
}

async function schedulesOfFixture() {
  return db
    .select({
      id: aiPropertyTrendSchedules.id,
      organizationId: aiPropertyTrendSchedules.organizationId,
      propertyId: aiPropertyTrendSchedules.propertyId,
      outboxEventId: aiPropertyTrendSchedules.outboxEventId,
      dueLocalDate: aiPropertyTrendSchedules.dueLocalDate,
      reviewAnalysisEpoch: aiPropertyTrendSchedules.reviewAnalysisEpoch,
      propertyTrendsEpoch: aiPropertyTrendSchedules.propertyTrendsEpoch,
      timezone: aiPropertyTrendSchedules.timezone,
    })
    .from(aiPropertyTrendSchedules)
    .where(inArray(aiPropertyTrendSchedules.organizationId, [...ORGANIZATIONS]))
    .orderBy(aiPropertyTrendSchedules.propertyId)
}

async function scheduleOf(target: Fixture) {
  const [schedule] = await db
    .select({ id: aiPropertyTrendSchedules.id })
    .from(aiPropertyTrendSchedules)
    .where(
      and(
        eq(aiPropertyTrendSchedules.organizationId, target.organizationId),
        eq(aiPropertyTrendSchedules.propertyId, target.propertyId),
      ),
    )
  if (!schedule) throw new Error('The fixture Property has no trend schedule')
  return schedule
}

function evidenceFor(timezone: string): AiTrendEvidence {
  const window = {
    period: { startLocalDate: '2026-09-01', endLocalDate: '2026-09-30' },
    textCandidateCount: 0,
    analyzedCount: 0,
    excludedCount: 0,
    starOnlyCount: 0,
    coverageBasisPoints: 0,
  }
  return {
    definitionVersion: AI_PROPERTY_TREND_DEFINITION_VERSION,
    definitionDigest: AI_PROPERTY_TREND_DEFINITION_DIGEST,
    renderProfileVersion: AI_TREND_RENDER_PROFILE_VERSION,
    renderProfileDigest: AI_TREND_RENDER_PROFILE_DIGEST,
    timezone,
    dataThroughLocalDate: '2026-09-30',
    baseline: window,
    current: window,
    modelLineage: [],
    selectedSignals: [],
    supportingReviews: [],
  }
}

describe.sequential('Property Trend scheduler store (real PostgreSQL)', () => {
  const startedAt = new Date()
  const dueZone = zoneWhereLocalHourIs(NOON, startedAt)
  const notYetDueZone = zoneWhereLocalHourIs(AFTER_MIDNIGHT, startedAt)

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearFixture()
    await releaseSchedulerHead()
    for (const organization of ORGANIZATIONS) {
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, "createdAt")
        VALUES (${organization}, 'AI trend schedule test', ${organization}, now())
      `)
    }

    await seedProperty(DUE, { timezone: dueZone, capabilities: TRENDS })
    await seedProperty(DUE_THEN_REVOKED, { timezone: dueZone, capabilities: TRENDS })
    await seedProperty(OTHER_TENANT_DUE, { timezone: dueZone, capabilities: TRENDS })

    await seedProperty(REVOKED, { timezone: dueZone, capabilities: TRENDS })
    await applyAuthorization(REVOKED, REVOKE)

    await seedProperty(WITHOUT_TRENDS, { timezone: dueZone, capabilities: ANALYSIS_ONLY })

    // Everything but the enrollment follows the new consent, so only the
    // enrollment taken under the earlier one keeps this Property out.
    await seedProperty(RECONSENTED, { timezone: dueZone, capabilities: TRENDS })
    await applyAuthorization(RECONSENTED, RECONSENT)
    await seedAggregateHead(RECONSENTED, RECONSENT.epoch)

    await seedProperty(ANALYSIS_BEHIND, {
      timezone: dueZone,
      capabilities: TRENDS,
      analysisHead: 1,
    })
    await seedProperty(BEFORE_LOCAL_RUN_TIME, {
      timezone: notYetDueZone,
      capabilities: TRENDS,
    })
  })

  afterAll(async () => {
    await removeMintedSchedules()
    await releaseSchedulerHead()
    await clearFixture()
    clearEventSchemas()
  })

  it('schedules only the Properties whose Property Trends authorization is current', async () => {
    await scheduleEverythingDue()

    const schedules = await schedulesOfFixture()

    expect(
      schedules.map(({ organizationId, propertyId }) => ({ organizationId, propertyId })),
    ).toEqual(
      [DUE, DUE_THEN_REVOKED, OTHER_TENANT_DUE].map(({ organizationId, propertyId }) => ({
        organizationId,
        propertyId,
      })),
    )
    const [dueLocalDate] = (
      await db.execute<{ today: string }>(sql`
        SELECT ai_property_local_date_v1(now(), ${dueZone})::text AS "today"
      `)
    ).rows
    expect(schedules[0]).toMatchObject({
      dueLocalDate: dueLocalDate?.today,
      reviewAnalysisEpoch: 1,
      propertyTrendsEpoch: 1,
      timezone: dueZone,
    })
  })

  it('commits one generation request per schedule, attributed to its own tenant', async () => {
    const schedules = await schedulesOfFixture()

    const facts = await db
      .select({
        id: outboxEvents.id,
        eventType: outboxEvents.eventType,
        organizationId: outboxEvents.organizationId,
        propertyId: outboxEvents.propertyId,
        payload: outboxEvents.payload,
      })
      .from(outboxEvents)
      .where(inArray(outboxEvents.organizationId, [...ORGANIZATIONS]))

    expect(facts).toHaveLength(schedules.length)
    for (const schedule of schedules) {
      expect(facts.find((fact) => fact.id === schedule.outboxEventId)).toMatchObject({
        eventType: 'ai.property_trend.generation_requested',
        organizationId: schedule.organizationId,
        propertyId: schedule.propertyId,
        payload: expect.objectContaining({ scheduleId: schedule.id }),
      })
    }
  })

  it('does not schedule the same generation twice in one local day', async () => {
    const before = await schedulesOfFixture()

    await scheduleEverythingDue()

    expect(await schedulesOfFixture()).toEqual(before)
  })

  it('answers busy and schedules nothing while another worker holds the lease', async () => {
    await db
      .update(aiPropertyTrendSchedulerHeads)
      .set({
        leaseOwner: OTHER_LEASE_OWNER,
        claimedAt: sql`now()`,
        leaseExpiresAt: sql`now() + interval '1 minute'`,
      })
      .where(eq(aiPropertyTrendSchedulerHeads.schedulerKey, SCHEDULER_KEY))

    const result = await store.scheduleDueBatch({ leaseOwner: LEASE_OWNER })
    await releaseSchedulerHead()

    expect(result).toEqual({ status: 'busy' })
  })

  it('stores an outcome while the authorization is current, and replays the same one', async () => {
    const schedule = await scheduleOf(DUE)
    const outcome = {
      scheduleId: schedule.id,
      disposition: 'insufficient_data' as const,
      evidence: evidenceFor(dueZone),
    }

    expect(await store.recordProviderFreeOutcome(outcome)).toBe('recorded')
    expect(await store.recordProviderFreeOutcome(outcome)).toBe('replayed')
    expect(await store.read(schedule.id)).toMatchObject({
      id: schedule.id,
      propertyId: DUE.propertyId,
      outcomeDisposition: 'insufficient_data',
    })
  })

  it('refuses the outcome of a schedule whose authorization was revoked after scheduling', async () => {
    const schedule = await scheduleOf(DUE_THEN_REVOKED)
    await applyAuthorization(DUE_THEN_REVOKED, REVOKE)

    const result = await store.recordProviderFreeOutcome({
      scheduleId: schedule.id,
      disposition: 'insufficient_data',
      evidence: evidenceFor(dueZone),
    })

    expect(result).toBe('stale')
    expect(await store.read(schedule.id)).toMatchObject({ outcomeDisposition: null })
  })
})
