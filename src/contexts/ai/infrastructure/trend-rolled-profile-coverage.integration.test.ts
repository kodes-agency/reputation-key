// A Property's processing profile can roll inside one review-analysis epoch: a
// timezone or country change, or a new provider deployment profile (the v3
// switch-on of 2026-10-30 rolled every Property on its next AI read). The
// settlement ledger spans profile versions, but the rolled generation's
// aggregate head counts only its own settlements, so it reads incomplete until
// it is rebuilt (migration 0010). The trend run takes coverage from that head
// (`readLockedAggregateHead`). A scheduler that counted the ledger instead
// scheduled a run that could only ask to be retried, so the run dead-lettered
// and paged (Sentry JAVASCRIPT-TANSTACKSTART-REACT-1D, -J, -K). Every trend
// reader has to read the head the run reads. One Property per case:
//
//   ROLLED   head 3, sequences 1 2 settled under profile 1, then the profile
//            rolls to 2 and sequence 3 settles under it: ledger 3, head 1
//   CURRENT  head 3, sequences 1 2 3 settled under profile 1: ledger 3, head 3
import { randomUUID } from 'node:crypto'
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
  reviews,
} from '#/shared/db/schema'
import {
  AI_PROPERTY_TREND_DEFINITION_DIGEST,
  AI_PROPERTY_TREND_DEFINITION_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
} from '#/shared/ai-property-trend-contract'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { seedEnabledReviewAnalysis } from '#/shared/db/testing/enabled-review-analysis-fixture'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { AiTrendEvidence } from '../application/ports/ai-output-store.port'
import { createAiOutputStoreAdapter } from './adapters/ai-output-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from './adapters/ai-property-aggregate-store.adapter'
import { createAiPropertyTrendScheduleStore } from './adapters/ai-property-trend-schedule-store.adapter'

const ORG = 'ai-rolled-profile-test'
const LEASE_OWNER = '5eed0600-0000-4000-8000-0000000000a1'
const EMPTY_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const HOURS_PER_DAY = 24
const NOON = 12
const MAX_DRAIN_BATCHES = 50
const AT = new Date('2026-09-10T12:00:00.000Z')
const WINDOW = { startLocalDate: '2026-09-01', endLocalDate: '2026-09-30' } as const

const uuid = (group: string, index: number): string =>
  `5eed06${group}-0000-4000-8000-${String(index).padStart(12, '0')}`

type Case = Readonly<{
  index: number
  head: number
  settledUnderFirstProfile: readonly number[]
  /** Settled after the profile rolled to version 2; empty when it never rolls. */
  settledUnderRolledProfile: readonly number[]
}>

const ROLLED: Case = {
  index: 1,
  head: 3,
  settledUnderFirstProfile: [1, 2],
  settledUnderRolledProfile: [3],
}
const CURRENT: Case = {
  index: 2,
  head: 3,
  settledUnderFirstProfile: [1, 2, 3],
  settledUnderRolledProfile: [],
}
const CASES = [ROLLED, CURRENT] as const

const currentProfileOf = (target: Case): number =>
  target.settledUnderRolledProfile.length > 0 ? 2 : 1

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

async function settle(
  target: Case,
  sequences: readonly number[],
  propertyProfileVersion: number,
): Promise<void> {
  for (const sequence of sequences) {
    await aggregates.advanceWithoutAnalysis({
      organizationId: organizationId(ORG),
      propertyId: propertyId(propertyOf(target)),
      reviewId: reviewId(reviewOf(target, sequence)),
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      analysisSequence: sequence,
      propertyProfileVersion,
      dispositionCode: 'operation_abandoned',
    })
  }
}

async function seed(target: Case, timezone: string): Promise<void> {
  await db.insert(properties).values({
    id: propertyOf(target),
    organizationId: ORG,
    name: `Rolled profile property ${target.index}`,
    slug: `rolled-profile-property-${target.index}`,
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
    analysisStartSequence: 0,
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
    analysisStartSequence: 0,
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
  await db.insert(reviews).values(
    Array.from({ length: target.head }, (_, offset) => offset + 1).map((sequence) => ({
      id: reviewOf(target, sequence),
      organizationId: ORG,
      propertyId: propertyOf(target),
      platform: 'google' as const,
      externalId: `rolled-profile-${target.index}-${sequence}`,
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
  await settle(target, target.settledUnderFirstProfile, 1)
  if (target.settledUnderRolledProfile.length === 0) return
  await db
    .update(aiPropertyProcessingProfiles)
    .set({ profileVersion: 2, updatedAt: AT })
    .where(eq(aiPropertyProcessingProfiles.propertyId, propertyOf(target)))
  await settle(target, target.settledUnderRolledProfile, 2)
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

function emptyEvidence(timezone: string): AiTrendEvidence {
  const window = {
    period: WINDOW,
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
    dataThroughLocalDate: WINDOW.endLocalDate,
    baseline: window,
    current: window,
    modelLineage: [],
    selectedSignals: [],
    supportingReviews: [],
  }
}

describe.sequential('trend coverage of a rolled profile generation (PostgreSQL)', () => {
  const dueZone = zoneWhereLocalHourIs(NOON, new Date())

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearFixture()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG}, 'AI rolled profile test', ${ORG}, now())
    `)
    for (const target of CASES) await seed(target, dueZone)
  })

  afterAll(async () => {
    await clearFixture()
    clearEventSchemas()
  })

  it('reads the rolled generation as awaiting what only the ledger settled', async () => {
    const window = await aggregates.readWindow({
      organizationId: organizationId(ORG),
      propertyId: propertyId(propertyOf(ROLLED)),
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 2,
      ...WINDOW,
    })

    expect(window?.coverage).toEqual({
      settledAnalysisCount: 1,
      expectedAnalysisCount: 3,
      awaitingAnalysisCount: 2,
    })
  })

  it('says the rolled generation is updating and the current one is preparing', async () => {
    const read = async (target: Case) =>
      outputs.readTrendReportForDelivery(
        {
          organizationId: organizationId(ORG),
          actorUserId: userId('rolled-profile-actor'),
          propertyId: propertyId(propertyOf(target)),
          sourceEpoch: 0,
          reviewAnalysisEpoch: 1,
          propertyTrendsEpoch: 1,
          propertyProfileVersion: currentProfileOf(target),
          reportProfileVersion: 'property-trend-v1',
          nowEpochMillis: AT.getTime(),
        },
        async (result) => result.status,
      )

    await expect(read(ROLLED)).resolves.toBe('updating')
    await expect(read(CURRENT)).resolves.toBe('preparing')
  })

  it('records no outcome for a schedule made for the rolled generation', async () => {
    // What the scheduler minted while it counted the ledger. A past due date
    // keeps it apart from anything the scheduler mints today.
    const scheduleId = randomUUID()
    mintedScheduleIds.push(scheduleId)
    await db.insert(aiPropertyTrendSchedules).values({
      id: scheduleId,
      outboxEventId: randomUUID(),
      organizationId: ORG,
      propertyId: propertyOf(ROLLED),
      dueLocalDate: '2026-10-01',
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      propertyTrendsEpoch: 1,
      propertyProfileVersion: 2,
      terminalAnalysisSequence: 3,
      aggregateRevision: 1,
      timezone: dueZone,
      calendarProfileVersion: 'property-calendar-v1',
      reportProfileVersion: 'property-trend-v1',
      schedulerGeneration: 1,
      scheduledAt: AT,
    })

    await expect(
      schedules.recordProviderFreeOutcome({
        scheduleId,
        disposition: 'updating',
        evidence: emptyEvidence(dueZone),
      }),
    ).resolves.toBe('stale')
  })

  it('schedules a trend for the current generation and not for the rolled one', async () => {
    for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch += 1) {
      const result = await schedules.scheduleDueBatch({ leaseOwner: LEASE_OWNER })
      if (result.status !== 'scheduled')
        throw new Error(`Scheduler said ${result.status}`)
      if (!result.hasMore) break
    }

    const scheduledToday = await db
      .select({ propertyId: aiPropertyTrendSchedules.propertyId })
      .from(aiPropertyTrendSchedules)
      .where(
        and(
          eq(aiPropertyTrendSchedules.organizationId, ORG),
          inArray(aiPropertyTrendSchedules.id, mintedScheduleIds),
          sql`${aiPropertyTrendSchedules.dueLocalDate} <> '2026-10-01'`,
        ),
      )
    expect(scheduledToday.map((row) => row.propertyId)).toEqual([propertyOf(CURRENT)])
  })
})
