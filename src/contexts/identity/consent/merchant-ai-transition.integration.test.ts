import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db/index'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/ai-reply-template-catalogue'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/shared/domain/merchant-ai-capability'
import { CURRENT_MERCHANT_AI_NOTICE } from '#/shared/merchant-ai-notice-contract'
import {
  createMerchantAiAuthorizationStore,
  hasActiveMerchantAiConsent,
  type MerchantAiAuthorizationFence,
} from './merchant-ai-authorization.repository.server'
import {
  createMerchantAiAuthorization,
  type MerchantAiSnapshot,
} from './merchant-ai-authorization.server'
import { createMerchantAiDecisionDeferral } from './merchant-ai-decision-deferral.server'
import { createMerchantAiDecisionDeferralStore } from './merchant-ai-decision.repository.server'
import { createMerchantAiManagementAuthorizer } from './merchant-ai-management.server'
import { createMerchantAiNoticeUpdateStore } from './merchant-ai-notice-updates.repository.server'
import { createStandingRenewalStore } from './merchant-ai-standing-renewal.repository.server'
import { renewLapsedMerchantAiAuthorizations } from './renew-lapsed-merchant-ai-authorizations.server'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'

// The consent promises, end to end on PostgreSQL through the use cases a
// manager's request reaches: every write runs the one Merchant AI transition.

let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
  connectionId: string
}>
const fixtures: Fixture[] = []

const POLICY = {
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  providerDeploymentProfileVersion: 'private-beta-global-v2' as const,
  redactionProfileFamily: 'gbp-review-global-v1',
}
const SERVED_NOTICE = {
  noticeVersion: CURRENT_MERCHANT_AI_NOTICE.version,
  noticeDigest: CURRENT_MERCHANT_AI_NOTICE.digest,
}
const OLD_NOTICE = {
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await lease.release()
})

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await db.execute(
      sql`DELETE FROM outbox_events WHERE organization_id = ${f.organizationId}`,
    )
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${f.organizationId}`)
    await db.execute(
      sql`DELETE FROM properties WHERE organization_id = ${f.organizationId}`,
    )
    await db.execute(
      sql`DELETE FROM google_connections WHERE id = ${f.connectionId}::uuid`,
    )
    await executeWithLastOwnerGuardDisabled(db, [
      sql`DELETE FROM member WHERE "organizationId" = ${f.organizationId}`,
    ])
    await deleteTestOrganizations(lease.pool, [f.organizationId])
    await db.execute(sql`DELETE FROM "user" WHERE id = ${f.actorUserId}`)
  }
})

async function seedProperty(): Promise<Fixture> {
  const f: Fixture = {
    organizationId: randomUUID(),
    propertyId: randomUUID(),
    actorUserId: randomUUID(),
    connectionId: randomUUID(),
  }
  fixtures.push(f)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${f.organizationId}, 'Consent fixture', ${f.organizationId}, now())`,
  )
  await db.execute(
    sql`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${f.actorUserId}, 'Owner', ${`${f.actorUserId}@example.test`}, true, now(), now())`,
  )
  await db.execute(
    sql`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${f.actorUserId}, ${f.organizationId}, 'owner', now())`,
  )
  await seedGoogleConnection(drizzleSeedRunner(db), {
    id: f.connectionId,
    organizationId: f.organizationId,
    googleSubject: f.connectionId,
    accessToken: 'fixture',
    refreshToken: 'fixture',
    connectedBy: f.actorUserId,
  })
  await db.execute(sql`INSERT INTO properties (id, organization_id, name, slug, timezone, lifecycle_state, google_connection_id, gbp_account_id, gbp_location_id, google_binding_state, profile_source, source_epoch)
    VALUES (${f.propertyId}::uuid, ${f.organizationId}, 'Consent property', ${f.propertyId}, 'UTC', 'active', ${f.connectionId}::uuid, 'account', ${f.propertyId}, 'active', 'legacy', 0)`)
  await db.execute(sql`INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch, head_sequence)
    VALUES (${f.organizationId}, ${f.propertyId}::uuid, 0, 0)`)
  return f
}

function services() {
  const store = createMerchantAiAuthorizationStore(db, randomUUID, replyScopeEffects)
  const decisionDeferrals = createMerchantAiDecisionDeferralStore(db)
  const authorizeManagement = createMerchantAiManagementAuthorizer(db)
  const clock = () => new Date()
  return {
    store,
    authorization: createMerchantAiAuthorization({
      store,
      decisionDeferrals,
      authorizeManagement,
      authorize: async () => true,
      isCurrentAccountAdmin: async () => true,
      verifyStepUp: async () => false,
      clock,
      idGen: randomUUID,
      ...SERVED_NOTICE,
      ...POLICY,
    }),
    deferral: createMerchantAiDecisionDeferral({
      store: decisionDeferrals,
      authorizeManagement,
      clock,
    }),
  }
}

function request(f: Fixture, expectedStateVersion: number) {
  return {
    organizationId: f.organizationId,
    propertyId: f.propertyId,
    actorUserId: f.actorUserId,
    idempotencyKey: randomUUID(),
    expectedStateVersion,
  }
}

function fence(
  snapshot: MerchantAiSnapshot,
  capability: 'review_analysis' | 'reply_drafting',
): MerchantAiAuthorizationFence {
  const recordedRuntimeProfileVersion =
    snapshot.capabilityRuntimeProfileVersions[capability]
  if (!snapshot.authorizationLineageId || !recordedRuntimeProfileVersion) {
    throw new Error('The snapshot holds no executable fence for this capability')
  }
  return {
    authorizationLineageId: snapshot.authorizationLineageId,
    capabilityEpoch: snapshot.capabilityEpochs[capability],
    authorizedSourceEpoch: snapshot.authorizedSourceEpoch,
    stateVersion: snapshot.stateVersion,
    noticeDigest: snapshot.noticeDigest,
    recordedRuntimeProfileVersion,
    servedExecution: getAiRuntimeCapability(capability),
  }
}

function admits(
  f: Fixture,
  purpose: string,
  expectedFence: MerchantAiAuthorizationFence,
) {
  return hasActiveMerchantAiConsent(db, {
    organizationId: f.organizationId,
    propertyId: f.propertyId,
    purpose,
    expectedFence,
  })
}

async function evidenceRows(f: Fixture) {
  const result = await db.execute(sql`
    SELECT transition_kind, state_version, notice_version, notice_digest, actor_user_id
    FROM merchant_ai_consent_evidence
    WHERE organization_id = ${f.organizationId}
    ORDER BY state_version
  `)
  return result.rows
}

/** A saved, unedited AI draft on a Review of the Property, as drafting leaves it. */
async function seedSavedDraft(f: Fixture): Promise<void> {
  const reviewId = randomUUID()
  await db.execute(sql`
    INSERT INTO reviews (id, organization_id, property_id, platform, first_fetched_at,
      source_epoch, source_revision, analysis_sequence)
    VALUES (${reviewId}::uuid, ${f.organizationId}, ${f.propertyId}::uuid, 'google', now(),
      0, 1, 0)
  `)
  await db.execute(sql`
    INSERT INTO review_source_contents (review_id, organization_id, property_id, platform,
      external_id, external_location_id, rating, text, reviewed_at, last_fetched_at,
      content_expires_at, source_epoch, source_revision, ai_source_byte_length,
      ai_source_digest)
    VALUES (${reviewId}::uuid, ${f.organizationId}, ${f.propertyId}::uuid, 'google', ${reviewId},
      'locations/consent-transition', 5, 'A lovely stay', now(), now(),
      now() + interval '1 day', 0, 1, 13, ${'e'.repeat(64)})
  `)
  await db.execute(sql`
    INSERT INTO replies (id, review_id, organization_id, text, reply_language_tag, status, source,
      created_by, ai_generated, authorship, origin_operation_id, origin_source_epoch,
      origin_source_revision, origin_base_reply_state_revision, origin_reply_drafting_epoch,
      origin_property_profile_version, origin_ai_profile_version, origin_reply_template_id,
      origin_reply_template_catalogue_version, origin_reply_template_catalogue_digest,
      origin_concrete_language_tag, origin_template_group, ai_draft_expires_at)
    VALUES (${randomUUID()}::uuid, ${reviewId}::uuid, ${f.organizationId}, 'Thank you for staying with us.',
      'en-Latn-US', 'draft', 'internal', ${f.actorUserId}, true, 'ai_assisted',
      ${randomUUID()}::uuid, 0, 1, 0, 1, 1, 'reply-suggestion-v1', 'appreciation_positive',
      'gbp-reply-template-catalogue-v1', ${AI_REPLY_TEMPLATE_CATALOGUE_DIGEST},
      'en-Latn-US', 'en-Latn', now() + interval '30 minutes')
  `)
}

async function savedDraftCount(f: Fixture): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM replies WHERE organization_id = ${f.organizationId}`,
  )
  return Number(result.rows[0]?.count)
}

describe('AI authorization with a stale notice, epoch, runtime or lineage', () => {
  it('admits the exact fence and refuses each stale field on its own', async () => {
    const f = await seedProperty()
    const { authorization } = services()
    const enabled = await authorization.enable({
      ...request(f, 0),
      reasonCode: 'merchant_enabled',
      acknowledgement: SERVED_NOTICE,
    })
    const exact = fence(enabled, 'review_analysis')

    // Each negative changes one field of a fence the same head admits, and the
    // positive control is asked again after it, so no refusal leans on another.
    const stale: ReadonlyArray<[string, MerchantAiAuthorizationFence]> = [
      ['lineage', { ...exact, authorizationLineageId: randomUUID() }],
      ['epoch', { ...exact, capabilityEpoch: exact.capabilityEpoch + 1 }],
      ['notice', { ...exact, noticeDigest: OLD_NOTICE.noticeDigest }],
      ['recorded runtime', { ...exact, recordedRuntimeProfileVersion: 'stale-runtime' }],
      [
        'served runtime',
        {
          ...exact,
          servedExecution: { ...exact.servedExecution, runtimeProfileVersion: 'stale' },
        },
      ],
    ]
    for (const [field, changed] of stale) {
      await expect(admits(f, 'ai.analyze', changed), field).resolves.toBe(false)
      await expect(admits(f, 'ai.analyze', exact), `${field} control`).resolves.toBe(true)
    }
    await expect(
      admits(f, 'ai.generate_reply', fence(enabled, 'reply_drafting')),
    ).resolves.toBe(true)
  })

  it('records the served notice as evidence and refuses an acknowledgement of another', async () => {
    const f = await seedProperty()
    const { authorization } = services()

    await expect(
      authorization.enable({
        ...request(f, 0),
        reasonCode: 'merchant_enabled',
        acknowledgement: OLD_NOTICE,
      }),
    ).rejects.toMatchObject({ code: 'notice_mismatch' })
    expect(await evidenceRows(f)).toEqual([])

    await authorization.enable({
      ...request(f, 0),
      reasonCode: 'merchant_enabled',
      acknowledgement: SERVED_NOTICE,
    })
    expect(await evidenceRows(f)).toEqual([
      {
        transition_kind: 'enable',
        state_version: 1,
        notice_version: SERVED_NOTICE.noticeVersion,
        notice_digest: SERVED_NOTICE.noticeDigest,
        actor_user_id: f.actorUserId,
      },
    ])
  })

  it('admits the epoch a change moved to and refuses the one it left', async () => {
    const f = await seedProperty()
    const { authorization } = services()
    const enabled = await authorization.enable({
      ...request(f, 0),
      reasonCode: 'merchant_enabled',
      acknowledgement: SERVED_NOTICE,
    })
    const draftingOnly = await authorization.change({
      ...request(f, enabled.stateVersion),
      reasonCode: 'capabilities_changed',
      acknowledgement: SERVED_NOTICE,
      capabilities: ['reply_drafting'],
    })
    const analysisAgain = await authorization.change({
      ...request(f, draftingOnly.stateVersion),
      reasonCode: 'capabilities_changed',
      acknowledgement: SERVED_NOTICE,
      capabilities: ['review_analysis', 'reply_drafting'],
    })
    expect(analysisAgain.authorizationLineageId).toBe(enabled.authorizationLineageId)
    // Turning analysis off and on again each move its epoch.
    expect(draftingOnly.capabilityEpochs.review_analysis).toBe(
      enabled.capabilityEpochs.review_analysis + 1,
    )
    expect(analysisAgain.capabilityEpochs.review_analysis).toBe(
      draftingOnly.capabilityEpochs.review_analysis + 1,
    )

    const current = fence(analysisAgain, 'review_analysis')
    await expect(admits(f, 'ai.analyze', current)).resolves.toBe(true)
    for (const left of [enabled, draftingOnly]) {
      await expect(
        admits(f, 'ai.analyze', {
          ...current,
          capabilityEpoch: left.capabilityEpochs.review_analysis,
        }),
      ).resolves.toBe(false)
      await expect(admits(f, 'ai.analyze', current)).resolves.toBe(true)
    }
    // Work claimed under the first grant carries its whole fence; it stays refused.
    await expect(
      admits(f, 'ai.analyze', fence(enabled, 'review_analysis')),
    ).resolves.toBe(false)
  })

  it('withdrawal fences unsent work, withdraws saved drafts and leaves decide later available', async () => {
    const f = await seedProperty()
    const { authorization, deferral } = services()
    const enabled = await authorization.enable({
      ...request(f, 0),
      reasonCode: 'merchant_enabled',
      acknowledgement: SERVED_NOTICE,
    })
    await seedSavedDraft(f)
    const claimed = fence(enabled, 'reply_drafting')
    await expect(admits(f, 'ai.generate_reply', claimed)).resolves.toBe(true)

    const revoked = await authorization.revoke({
      ...request(f, enabled.stateVersion),
      reasonCode: 'merchant_revoked',
    })

    expect(revoked).toMatchObject({ state: 'revoked', capabilities: [] })
    await expect(admits(f, 'ai.generate_reply', claimed)).resolves.toBe(false)
    expect(await savedDraftCount(f)).toBe(0)
    const deferred = await deferral.defer(request(f, 0))
    await expect(authorization.get(request(f, 0))).resolves.toMatchObject({
      state: 'revoked',
      decisionDeferredAt: deferred.decisionDeferredAt,
    })
  })
})

describe('deciding later', () => {
  it('round-trips: not now, enable ends it, revoke, not now again', async () => {
    const f = await seedProperty()
    const { authorization, deferral } = services()
    await expect(authorization.get(request(f, 0))).resolves.toMatchObject({
      state: 'disabled',
      decisionDeferredAt: null,
    })

    const first = await deferral.defer(request(f, 0))
    // A repeat keeps the first decision; the setup wizard reads it from `get`.
    await expect(deferral.defer(request(f, 0))).resolves.toEqual(first)
    await expect(authorization.get(request(f, 0))).resolves.toMatchObject({
      state: 'disabled',
      stateVersion: 0,
      decisionDeferredAt: first.decisionDeferredAt,
    })
    expect(await evidenceRows(f)).toEqual([])

    const enabled = await authorization.enable({
      ...request(f, 0),
      reasonCode: 'merchant_enabled',
      acknowledgement: SERVED_NOTICE,
    })
    expect(enabled.decisionDeferredAt).toBeNull()
    const standing = await db.execute(
      sql`SELECT count(*)::int AS count FROM merchant_ai_decision_deferrals WHERE organization_id = ${f.organizationId}`,
    )
    expect(standing.rows[0]?.count).toBe(0)
    await expect(deferral.defer(request(f, 0))).rejects.toMatchObject({
      code: 'already_enabled',
    })

    await authorization.revoke({
      ...request(f, enabled.stateVersion),
      reasonCode: 'merchant_revoked',
    })
    const again = await deferral.defer(request(f, 0))
    expect(Date.parse(again.decisionDeferredAt)).toBeGreaterThanOrEqual(
      Date.parse(first.decisionDeferredAt),
    )
    await expect(authorization.get(request(f, 0))).resolves.toMatchObject({
      state: 'revoked',
      decisionDeferredAt: again.decisionDeferredAt,
    })
  })
})

describe('a notice change or a Property with AI off', () => {
  it('renews standing consent with its announcement and leaves off, revoked and deferred alone', async () => {
    const lapsed = await seedProperty()
    const revoked = await seedProperty()
    const deferredOnly = await seedProperty()
    const { store, authorization, deferral } = services()
    const oldGrant = (f: Fixture) => ({
      ...request(f, 0),
      ...POLICY,
      ...OLD_NOTICE,
      operation: 'enable' as const,
      state: 'enabled' as const,
      capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      reasonCode: 'merchant_enabled',
      now: new Date(),
      ceremonyId: randomUUID(),
    })
    await store.mutate(oldGrant(lapsed))
    await store.mutate(oldGrant(revoked))
    // Withdrawn under the old notice too, so the sweep sees a stale head it must not renew.
    await store.mutate({
      ...oldGrant(revoked),
      expectedStateVersion: 1,
      operation: 'revoke',
      state: 'revoked',
      capabilities: [],
      reasonCode: 'merchant_revoked',
    })
    const deferred = await deferral.defer(request(deferredOnly, 0))

    const mine = new Set(fixtures.map((f) => f.organizationId))
    const renewalStore = createStandingRenewalStore({
      db,
      idGen: randomUUID,
      replyEffects: replyScopeEffects,
      policy: { ...SERVED_NOTICE, ...POLICY },
      authorize: async () => 'allowed',
    })
    const summary = await renewLapsedMerchantAiAuthorizations({
      store: {
        ...renewalStore,
        listLapsed: async () =>
          (await renewalStore.listLapsed()).filter((candidate) =>
            mine.has(candidate.organizationId),
          ),
      },
      target: SERVED_NOTICE,
      idGen: randomUUID,
      clock: () => new Date(),
      logger: { info: () => undefined, error: () => undefined },
      captureUnexpected: (error) => {
        throw error
      },
    })()

    expect(summary).toMatchObject({ renewed: 1, failed: 0 })
    expect(await store.getSnapshot(lapsed)).toMatchObject({
      state: 'enabled',
      stateVersion: 2,
      ...SERVED_NOTICE,
    })
    const receipts = createMerchantAiNoticeUpdateStore(db)
    await expect(
      receipts.latest({
        organizationId: lapsed.organizationId,
        actorUserId: lapsed.actorUserId,
        unseenOnly: true,
      }),
    ).resolves.toMatchObject({ noticeVersion: SERVED_NOTICE.noticeVersion })

    expect(await store.getSnapshot(revoked)).toMatchObject({
      state: 'revoked',
      stateVersion: 2,
      ...OLD_NOTICE,
    })
    expect((await evidenceRows(revoked)).map((row) => row.transition_kind)).toEqual([
      'enable',
      'revoke',
    ])
    await expect(authorization.get(request(deferredOnly, 0))).resolves.toMatchObject({
      state: 'disabled',
      stateVersion: 0,
      decisionDeferredAt: deferred.decisionDeferredAt,
    })
    expect(await evidenceRows(deferredOnly)).toEqual([])
  })
})
