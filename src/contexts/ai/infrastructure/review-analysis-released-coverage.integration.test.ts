// Coverage owes one settlement for every analysis sequence in
// (analysis_start_sequence, head_sequence]. A sequence the Review writer gave
// back (`review_ai_analysis_released_sequences`) is owed nothing, so every
// reader of coverage subtracts it: the aggregate read, the trend scheduler, the
// trend report read and the stall monitor. These run the real queries against
// PostgreSQL, one Property per case:
//
//   RELEASED     head 5, settled 1 2 4 5, 3 released      -> nothing awaited
//   LEAKED       head 5, settled 1 2 4 5, 3 not released  -> one awaited
//   SETTLED_TOO  head 3, settled 1 2 3, 3 also released   -> counted once
//   BELOW_START  start 2, head 4, settled 3 4, 1 released -> outside the range
//   NOT_ENABLED  head 4, settled 1 2 4, 3 released, but in another source epoch
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyProcessingProfiles,
  aiPropertyTrendSchedules,
  aiReviewAnalysisEnrollments,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviewAiAnalysisReleasedSequences,
  reviews,
} from '#/shared/db/schema'
import { createAlertAuxReader } from '#/shared/observability/alert-aux-reads'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { seedEnabledReviewAnalysis } from '#/shared/db/testing/enabled-review-analysis-fixture'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createAiOutputStoreAdapter } from './adapters/ai-output-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from './adapters/ai-property-aggregate-store.adapter'
import { createAiPropertyTrendScheduleStore } from './adapters/ai-property-trend-schedule-store.adapter'

const ORG = 'ai-released-coverage-test'
const LEASE_OWNER = '5eed0500-0000-4000-8000-0000000000a1'
const EMPTY_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const HOURS_PER_DAY = 24
const NOON = 12
const MAX_DRAIN_BATCHES = 50
const AT = new Date('2026-09-10T12:00:00.000Z')
const WINDOW = { startLocalDate: '2026-09-01', endLocalDate: '2026-09-30' } as const

const uuid = (group: string, index: number): string =>
  `5eed05${group}-0000-4000-8000-${String(index).padStart(12, '0')}`

type Case = Readonly<{
  index: number
  start: number
  head: number
  settled: readonly number[]
  released: readonly number[]
  /** Released rows written under another source epoch. */
  releasedInOtherEpoch?: readonly number[]
}>

const RELEASED: Case = {
  index: 1,
  start: 0,
  head: 5,
  settled: [1, 2, 4, 5],
  released: [3],
}
const LEAKED: Case = { index: 2, start: 0, head: 5, settled: [1, 2, 4, 5], released: [] }
const SETTLED_TOO: Case = {
  index: 3,
  start: 0,
  head: 3,
  settled: [1, 2, 3],
  released: [3],
}
const BELOW_START: Case = { index: 4, start: 2, head: 4, settled: [3, 4], released: [1] }
const OTHER_EPOCH: Case = {
  index: 5,
  start: 0,
  head: 4,
  settled: [1, 2, 4],
  released: [],
  releasedInOtherEpoch: [3],
}
const CASES = [RELEASED, LEAKED, SETTLED_TOO, BELOW_START, OTHER_EPOCH] as const

const db = getDb()
const aggregates = createAiPropertyAggregateStoreAdapter(db)
const outputs = createAiOutputStoreAdapter(db)
const mintedScheduleIds: string[] = []
const schedules = createAiPropertyTrendScheduleStore(db, () => {
  const id = randomUUID()
  mintedScheduleIds.push(id)
  return id
})

const propertyOf = (target: Case) => uuid('10', target.index)
const reviewOf = (target: Case, sequence: number) => uuid(`2${target.index}`, sequence)

/** The fixed-offset zone in which the local hour is `localHour` right now. */
function zoneWhereLocalHourIs(localHour: number, now: Date): string {
  const offset =
    ((localHour - now.getUTCHours() + HOURS_PER_DAY + NOON) % HOURS_PER_DAY) - NOON
  return offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

async function seed(target: Case, timezone: string): Promise<void> {
  await db.insert(properties).values({
    id: propertyOf(target),
    organizationId: ORG,
    name: `Released coverage property ${target.index}`,
    slug: `released-coverage-property-${target.index}`,
    timezone,
    countryCode: 'BG',
    profileVersion: 1,
    sourceEpoch: 0,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId: ORG,
    propertyId: propertyOf(target),
    sourceEpoch: 0,
    headSequence: target.head,
    createdAt: AT,
    updatedAt: AT,
  })
  await seedEnabledReviewAnalysis(db, {
    organizationId: ORG,
    propertyId: propertyOf(target),
    authorizationLineageId: uuid('30', target.index),
    analysisStartSequence: target.start,
    propertyTrends: true,
    occurredAt: AT,
  })
  await db.insert(aiPropertyProcessingProfiles).values({
    propertyId: propertyOf(target),
    organizationId: ORG,
    countryCode: 'BG',
    timezone,
    processingRegion: 'global',
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: 'private-beta-global-v2',
    sourceEpoch: 0,
    profileVersion: 1,
    lifecycleState: 'active',
    updatedAt: AT,
  })
  await db.insert(aiReviewAnalysisEnrollments).values({
    id: uuid('40', target.index),
    organizationId: ORG,
    propertyId: propertyOf(target),
    authorizationLineageId: uuid('30', target.index),
    authorizationStateVersion: 1,
    sourceEpoch: 0,
    reviewAnalysisEpoch: 1,
    analysisStartSequence: target.start,
    providerDeploymentProfileVersion: 'private-beta-global-v2',
    triggerEventEnvelopeId: uuid('50', target.index),
    state: 'caught_up',
    snapshotRevisionCount: 0,
    snapshotRevisionSetDigest: EMPTY_SET_DIGEST,
    snapshotCapturedAt: AT,
    caughtUpEligibleRevisionCount: 0,
    caughtUpAnalysisSequence: target.head,
    caughtUpRevisionSetDigest: EMPTY_SET_DIGEST,
    caughtUpAt: AT,
    terminalReason: 'eligible_revision_set_caught_up',
    terminalAt: AT,
    createdAt: AT,
    updatedAt: AT,
  })
  if (target.settled.length > 0) {
    await db.insert(reviews).values(
      target.settled.map((sequence) => ({
        id: reviewOf(target, sequence),
        organizationId: ORG,
        propertyId: propertyOf(target),
        platform: 'google' as const,
        externalId: `released-coverage-${target.index}-${sequence}`,
        reviewerName: 'Synthetic reviewer',
        rating: 5,
        text: 'Synthetic review',
        languageCode: 'en',
        reviewedAt: AT,
        contentExpiresAt: new Date('2027-09-10T12:00:00.000Z'),
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: sequence,
        aiSourceByteLength: 16,
        aiSourceDigest: 'a'.repeat(64),
      })),
    )
  }
  for (const sequence of target.settled) {
    await aggregates.advanceWithoutAnalysis({
      organizationId: organizationId(ORG),
      propertyId: propertyId(propertyOf(target)),
      reviewId: reviewId(reviewOf(target, sequence)),
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      analysisSequence: sequence,
      propertyProfileVersion: 1,
      dispositionCode: 'operation_abandoned',
    })
  }
  const releasedRows = [
    ...target.released.map((analysisSequence) => ({ analysisSequence, sourceEpoch: 0 })),
    ...(target.releasedInOtherEpoch ?? []).map((analysisSequence) => ({
      analysisSequence,
      sourceEpoch: 1,
    })),
  ]
  if (releasedRows.length > 0) {
    await db.insert(reviewAiAnalysisReleasedSequences).values(
      releasedRows.map((released) => ({
        organizationId: ORG,
        propertyId: propertyOf(target),
        sourceEpoch: released.sourceEpoch,
        analysisSequence: released.analysisSequence,
        reason: 'replayed_observation',
        releasedAt: AT,
      })),
    )
  }
}

async function clearFixture(): Promise<void> {
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
  if (mintedScheduleIds.length > 0) {
    await db
      .delete(aiPropertyTrendSchedules)
      .where(inArray(aiPropertyTrendSchedules.id, mintedScheduleIds))
  }
  await db.delete(properties).where(eq(properties.organizationId, ORG))
  await deleteTestOrganizations(db, [ORG])
}

const alertReader = () => createAlertAuxReader({ db, logger: pino({ level: 'silent' }) })

describe.sequential('coverage subtracts released analysis sequences (PostgreSQL)', () => {
  let baseline: Awaited<ReturnType<ReturnType<typeof alertReader>['read']>>

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearFixture()
    baseline = await alertReader().read()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG}, 'AI released coverage test', ${ORG}, now())
    `)
    const dueZone = zoneWhereLocalHourIs(NOON, new Date())
    for (const target of CASES) await seed(target, dueZone)
  })

  afterAll(async () => {
    await clearFixture()
    clearEventSchemas()
  })

  async function coverageOf(target: Case) {
    const window = await aggregates.readWindow({
      organizationId: organizationId(ORG),
      propertyId: propertyId(propertyOf(target)),
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      ...WINDOW,
    })
    return window?.coverage
  }

  it('reads a released sequence as owed nothing in the aggregate window', async () => {
    await expect(coverageOf(RELEASED)).resolves.toEqual({
      settledAnalysisCount: 4,
      expectedAnalysisCount: 4,
      awaitingAnalysisCount: 0,
    })
  })

  it('still reads an unreleased gap as awaiting', async () => {
    await expect(coverageOf(LEAKED)).resolves.toEqual({
      settledAnalysisCount: 4,
      expectedAnalysisCount: 5,
      awaitingAnalysisCount: 1,
    })
  })

  it('counts a sequence that is both released and settled once', async () => {
    await expect(coverageOf(SETTLED_TOO)).resolves.toEqual({
      settledAnalysisCount: 3,
      expectedAnalysisCount: 3,
      awaitingAnalysisCount: 0,
    })
  })

  it('ignores a released sequence at or below the start sequence', async () => {
    await expect(coverageOf(BELOW_START)).resolves.toEqual({
      settledAnalysisCount: 2,
      expectedAnalysisCount: 2,
      awaitingAnalysisCount: 0,
    })
  })

  it('ignores a release recorded under another source epoch', async () => {
    await expect(coverageOf(OTHER_EPOCH)).resolves.toEqual({
      settledAnalysisCount: 3,
      expectedAnalysisCount: 4,
      awaitingAnalysisCount: 1,
    })
  })

  it('leaves only the unreleased gaps to the stall monitor', async () => {
    const observed = await alertReader().read()

    // LEAKED and OTHER_EPOCH each wait on one sequence; the rest are complete.
    expect(observed.reviewAnalysis).toMatchObject({
      monitorAvailable: true,
      incompletePropertyCount: baseline.reviewAnalysis.incompletePropertyCount + 2,
      pendingSettlementCount: baseline.reviewAnalysis.pendingSettlementCount + 2,
    })
  })

  it('reports the trend report as caught up only where nothing unreleased is open', async () => {
    const read = async (target: Case) =>
      outputs.readTrendReportForDelivery(
        {
          organizationId: organizationId(ORG),
          actorUserId: userId('released-coverage-actor'),
          propertyId: propertyId(propertyOf(target)),
          sourceEpoch: 0,
          reviewAnalysisEpoch: 1,
          propertyTrendsEpoch: 1,
          propertyProfileVersion: 1,
          reportProfileVersion: 'property-trend-v1',
          nowEpochMillis: AT.getTime(),
        },
        async (result) => result.status,
      )

    // `updating` is what a read says while analysis has not caught up and no
    // report exists yet; `preparing` is a caught-up Property with no report.
    await expect(read(RELEASED)).resolves.toBe('preparing')
    await expect(read(SETTLED_TOO)).resolves.toBe('preparing')
    await expect(read(BELOW_START)).resolves.toBe('preparing')
    await expect(read(LEAKED)).resolves.toBe('updating')
    await expect(read(OTHER_EPOCH)).resolves.toBe('updating')
  })

  it('schedules a trend only for Properties with no unreleased gap', async () => {
    for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch += 1) {
      const result = await schedules.scheduleDueBatch({ leaseOwner: LEASE_OWNER })
      if (result.status !== 'scheduled')
        throw new Error(`Scheduler said ${result.status}`)
      if (!result.hasMore) break
    }

    const scheduled = await db
      .select({ propertyId: aiPropertyTrendSchedules.propertyId })
      .from(aiPropertyTrendSchedules)
      .where(
        and(
          eq(aiPropertyTrendSchedules.organizationId, ORG),
          inArray(aiPropertyTrendSchedules.id, mintedScheduleIds),
        ),
      )
    expect(scheduled.map((row) => row.propertyId).sort()).toEqual(
      [RELEASED, SETTLED_TOO, BELOW_START].map(propertyOf).sort(),
    )
  })
})
