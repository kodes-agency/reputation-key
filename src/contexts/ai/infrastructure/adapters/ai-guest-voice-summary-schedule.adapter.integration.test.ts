// The Monday sweep's store against PostgreSQL: which Properties it lists on their Monday
// morning, and the one identifier-only fact a summary is recorded as. Every row is
// synthetic: ids, counters and invented topics, no review text of a guest.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import {
  aiPropertyProcessingProfiles,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import type { GuestVoiceSummaryPlan } from '../../application/use-cases/plan-guest-voice-summary'
import {
  createAiGuestVoiceSummaryScheduleAdapter,
  guestVoiceSummaryEventId,
} from './ai-guest-voice-summary-schedule.adapter'

const ORGANIZATION_ID = organizationId('ai-gv-summary-test-org')
const NOW = new Date('2026-11-09T06:00:00.000Z')
const SOFIA = propertyId('78000000-0000-4000-8000-000000000001')
const HONOLULU = propertyId('78000000-0000-4000-8000-000000000002')
const PAUSED = propertyId('78000000-0000-4000-8000-000000000003')
const SIDEWAYS = propertyId('78000000-0000-4000-8000-000000000005')
const LINEAGE = (n: number) =>
  `78000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`

type GuestVoiceSendPlan = Extract<GuestVoiceSummaryPlan, { status: 'send' }>

type Spec = Readonly<{
  id: ReturnType<typeof propertyId>
  timezone: string
  state?: 'enabled' | 'revoked'
  lifecycle?: 'active' | 'deleting'
}>

describe.sequential('the Monday sweep store (PostgreSQL)', () => {
  const db: Database = getDb()
  const schedule = createAiGuestVoiceSummaryScheduleAdapter(db)

  const clear = async () => {
    await db.delete(properties).where(eq(properties.organizationId, ORGANIZATION_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  async function seed(spec: Spec, ordinal: number): Promise<void> {
    await db.insert(properties).values({
      id: spec.id,
      organizationId: ORGANIZATION_ID,
      name: `Summary property ${ordinal}`,
      slug: `summary-property-${ordinal}`,
      timezone: spec.timezone,
      countryCode: 'US',
      profileVersion: 1,
      sourceEpoch: 0,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: spec.id,
      sourceEpoch: 0,
      headSequence: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const authorization = {
      capabilities: ['review_analysis'] as string[],
      capabilityRuntimeProfileVersions: { review_analysis: 'review-analysis-runtime-v1' },
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: 0,
      analysisStartSequence: 0,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      processingRegion: 'global',
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      redactionProfileFamily: 'gbp-review-global-v1',
    } as const
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID,
        propertyId: spec.id,
        authorizationLineageId: LINEAGE(ordinal),
        stateVersion: 1,
        transitionKind: 'enable',
        state: 'enabled',
        ...authorization,
        actorUserId: 'ai-gv-summary-test-actor',
        reasonCode: 'merchant_enabled',
        idempotencyKey: `ai-gv-summary-enable-${ordinal}`,
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: spec.id,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE(ordinal),
        state: 'enabled',
        stateVersion: 1,
        ...authorization,
        updatedBy: 'ai-gv-summary-test-actor',
        updatedAt: NOW,
      })
    })
    if ((spec.state ?? 'enabled') === 'revoked') {
      // A merchant revoked AI again: the second transition of the same lineage.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`,
        )
        await tx.insert(merchantAiConsentEvidence).values({
          organizationId: ORGANIZATION_ID,
          propertyId: spec.id,
          authorizationLineageId: LINEAGE(ordinal),
          stateVersion: 2,
          transitionKind: 'revoke',
          state: 'revoked',
          ...authorization,
          capabilities: [],
          capabilityRuntimeProfileVersions: {},
          actorUserId: 'ai-gv-summary-test-actor',
          reasonCode: 'merchant_revoked',
          idempotencyKey: `ai-gv-summary-revoke-${ordinal}`,
          requestHash: 'd'.repeat(64),
          occurredAt: NOW,
        })
        await tx
          .update(merchantAiEnablement)
          .set({
            state: 'revoked',
            stateVersion: 2,
            capabilities: [],
            capabilityRuntimeProfileVersions: {},
            updatedAt: NOW,
          })
          .where(eq(merchantAiEnablement.propertyId, spec.id))
      })
    }
    await db.insert(aiPropertyProcessingProfiles).values({
      propertyId: spec.id,
      organizationId: ORGANIZATION_ID,
      countryCode: 'US',
      timezone: spec.timezone,
      processingRegion: 'global',
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      sourceEpoch: 0,
      profileVersion: 1,
      lifecycleState: spec.lifecycle ?? 'active',
      updatedAt: NOW,
    })
  }

  beforeAll(async () => {
    registerAllEventSchemas()
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI summary schedule test', ${ORGANIZATION_ID}, ${NOW})
    `)
    // Monday 2026-11-09 06:00 UTC: 08:00 in Sofia (UTC+2), Sunday evening in Honolulu.
    const specs: Spec[] = [
      { id: SOFIA, timezone: 'Europe/Sofia' },
      { id: HONOLULU, timezone: 'Pacific/Honolulu' },
      { id: PAUSED, timezone: 'Europe/Sofia', state: 'revoked' },
      { id: SIDEWAYS, timezone: 'Europe/Sofia', lifecycle: 'deleting' },
    ]
    for (const [index, spec] of specs.entries()) await seed(spec, index + 1)
  })

  beforeEach(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  })

  afterAll(async () => {
    await clear()
  })

  it('lists only enabled, active Properties whose own clock says Monday morning', async () => {
    const due = await schedule.listDue({ nowEpochMillis: NOW.getTime(), limit: 100 })

    expect(due.filter((row) => row.organizationId === ORGANIZATION_ID)).toEqual([
      { organizationId: ORGANIZATION_ID, propertyId: SOFIA },
    ])
  })

  it('lists the Property in the two hours after, and not before or after them', async () => {
    const at = (hour: number, minute = 0) => Date.UTC(2026, 10, 9, hour, minute)
    const dueAt = async (instant: number) =>
      (await schedule.listDue({ nowEpochMillis: instant, limit: 100 })).filter(
        (row) => row.organizationId === ORGANIZATION_ID,
      )

    expect(await dueAt(at(5, 59))).toEqual([])
    expect(await dueAt(at(6, 0))).toHaveLength(1)
    expect(await dueAt(at(8, 59))).toHaveLength(1)
    expect(await dueAt(at(9, 0))).toEqual([])
  })

  it('lists a Honolulu Property when it is Honolulu’s Monday morning', async () => {
    const due = await schedule.listDue({
      nowEpochMillis: Date.UTC(2026, 10, 9, 18, 30),
      limit: 100,
    })

    expect(
      due
        .filter((row) => row.organizationId === ORGANIZATION_ID)
        .map((row) => row.propertyId),
    ).toEqual([HONOLULU])
  })

  it('lists at most the limit', async () => {
    const due = await schedule.listDue({ nowEpochMillis: NOW.getTime(), limit: 0 })

    expect(due).toEqual([])
  })

  describe('recording a summary', () => {
    const plan: GuestVoiceSendPlan = {
      status: 'send',
      summaryKind: 'weekly',
      localDate: '2026-11-09',
      window: '90d',
      startLocalDate: '2026-08-12',
      endLocalDate: '2026-11-09',
      lines: [
        {
          kind: 'fix_first',
          topic: 'facilities_equipment',
          issueId: 'a0000000-0000-4000-8000-000000000001',
          reviewCount: 19,
          textReviewCount: 128,
          upTo: 0.2,
          change: null,
          polarity: null,
        },
      ],
    }

    const publish = (over: Partial<typeof plan> = {}) =>
      schedule.publish({
        organizationId: ORGANIZATION_ID,
        propertyId: SOFIA,
        plan: { ...plan, ...over },
        occurredAt: NOW,
      })

    const facts = () =>
      db
        .select({
          id: outboxEvents.id,
          propertyId: outboxEvents.propertyId,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.organizationId, ORGANIZATION_ID),
            eq(outboxEvents.eventType, 'ai.guest_voice_summary.ready'),
          ),
        )

    it('records one fact with the page’s lines, and no word of a review', async () => {
      await expect(publish()).resolves.toBe(true)

      const [fact] = await facts()
      expect(fact).toMatchObject({
        id: guestVoiceSummaryEventId({
          organizationId: ORGANIZATION_ID,
          propertyId: SOFIA,
          localDate: '2026-11-09',
        }),
        propertyId: SOFIA,
        payload: {
          organizationId: ORGANIZATION_ID,
          propertyId: SOFIA,
          summaryKind: 'weekly',
          localDate: '2026-11-09',
          window: '90d',
          lines: plan.lines,
          occurredAt: NOW.toISOString(),
        },
      })
    })

    it('records a Monday once, however often the sweep finds the Property due', async () => {
      await expect(publish()).resolves.toBe(true)
      await expect(publish()).resolves.toBe(false)
      await expect(publish()).resolves.toBe(false)

      await expect(facts()).resolves.toHaveLength(1)
    })

    it('records the next Monday as a fact of its own', async () => {
      await publish()
      await expect(publish({ localDate: '2026-11-16' })).resolves.toBe(true)

      await expect(facts()).resolves.toHaveLength(2)
    })

    it('records the roundup with no lines at all', async () => {
      await expect(
        publish({ summaryKind: 'monthly', localDate: '2026-12-07', lines: [] }),
      ).resolves.toBe(true)

      const [fact] = await facts()
      expect(fact?.payload).toMatchObject({ summaryKind: 'monthly', lines: [] })
    })
  })
})

describe('the Monday fact id', () => {
  const day = { organizationId: 'org-1', propertyId: 'p-1', localDate: '2026-11-09' }

  it('is a version-5 UUID that is the same for the same Property and Monday', () => {
    expect(guestVoiceSummaryEventId(day)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(guestVoiceSummaryEventId({ ...day })).toBe(guestVoiceSummaryEventId(day))
  })

  it.each([
    ['another Organization', { organizationId: 'org-2' }],
    ['another Property', { propertyId: 'p-2' }],
    ['another Monday', { localDate: '2026-11-16' }],
  ])('differs for %s', (_label, change) => {
    expect(guestVoiceSummaryEventId({ ...day, ...change })).not.toBe(
      guestVoiceSummaryEventId(day),
    )
  })
})
