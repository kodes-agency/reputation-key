// A Property's processing profile can roll inside one review-analysis epoch: a
// timezone or country change, or a new provider deployment profile (the v3
// switch-on of 2026-10-30 rolled every Property on its next AI read). The
// settlement ledger spans profile versions, but the rolled generation's
// aggregate head counts only its own settlements, so it reads incomplete until
// it is rebuilt (migration 0010). Aggregate coverage must follow that head.
//
//   ROLLED   head 3, sequences 1 2 settled under profile 1, then the profile
//            rolls to 2 and sequence 3 settles under it: ledger 3, head 1
//   CURRENT  head 3, sequences 1 2 3 settled under profile 1: ledger 3, head 3
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyProcessingProfiles,
  aiReviewAnalysisEnrollments,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { seedEnabledReviewAnalysis } from '#/shared/db/testing/enabled-review-analysis-fixture'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createAiPropertyAggregateStoreAdapter } from './adapters/ai-property-aggregate-store.adapter'

const ORG = 'ai-rolled-profile-test'
const EMPTY_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const HOURS_PER_DAY = 24
const NOON = 12
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

const db = getDb()
const aggregates = createAiPropertyAggregateStoreAdapter(db)

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
  await db.delete(properties).where(eq(properties.organizationId, ORG))
  await deleteTestOrganizations(db, [ORG])
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
})
