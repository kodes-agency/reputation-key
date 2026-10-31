import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  checkScopedCapability,
} from '#/shared/auth/beta-capabilities'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/ai-reply-template-catalogue'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/shared/domain/merchant-ai-capability'
import { CURRENT_MERCHANT_AI_NOTICE } from '#/shared/merchant-ai-notice-contract'
import { renewLapsedMerchantAiAuthorizations } from '../../application/use-cases/renew-lapsed-merchant-ai-authorizations'
import { createStandingRenewalStore } from './merchant-ai-standing-renewal.repository'
import { createMerchantAiAuthorizationStore } from './merchant-ai-authorization.repository'
import { createMerchantAiNoticeUpdateStore } from './merchant-ai-notice-updates.repository'
import { createIdentityOrganizationExportContributor } from '../identity-organization-export-contributor'

// The reply-drafting runtime the build serves, switchable per test: a Property is
// renewed under whichever runtime is served when the sweep runs, and the one it
// recorded when it consented may be an earlier one.
const served = vi.hoisted(() => ({ replyDraftingRuntime: null as string | null }))
vi.mock('#/shared/ai-runtime-capability-contract', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/ai-runtime-capability-contract')>()
  return {
    ...actual,
    resolveAiRuntimeCapabilitySet: (
      ...args: Parameters<typeof actual.resolveAiRuntimeCapabilitySet>
    ) => {
      const profiles = actual.resolveAiRuntimeCapabilitySet(...args)
      return served.replyDraftingRuntime !== null && 'reply_drafting' in profiles
        ? { ...profiles, reply_drafting: served.replyDraftingRuntime }
        : profiles
    },
  }
})

let lease: TestLease
let db: Database
type Fixture = {
  organizationId: string
  propertyId: string
  actorUserId: string
  oldestOwner: string
  connectionId: string
}
const fixtures: Fixture[] = []
const OLD = {
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
}
const POLICY = {
  noticeVersion: CURRENT_MERCHANT_AI_NOTICE.version,
  noticeDigest: CURRENT_MERCHANT_AI_NOTICE.digest,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  providerDeploymentProfileVersion: 'private-beta-global-v2' as const,
  redactionProfileFamily: 'gbp-review-global-v1',
}
// 2026-09-15 -> 2026-10-17 changed no data use, so no epoch moves.
const IMMATERIAL_TARGET = {
  ...POLICY,
  noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
  noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
}
const DRAFT_TEXT = 'Thank you for staying with us.'
const PURPOSE = {
  review_analysis: 'ai.analyze',
  reply_drafting: 'ai.generate_reply',
  property_trends: 'ai.detect_trends',
} as const

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
  resetCapabilityPolicyStore()
  served.replyDraftingRuntime = null
  logged.info.mockClear()
  logged.error.mockClear()
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
    await db.execute(
      sql`DELETE FROM "user" WHERE id IN (${f.actorUserId}, ${f.oldestOwner})`,
    )
  }
})

async function seedProperty(): Promise<Fixture> {
  const f = {
    organizationId: randomUUID(),
    propertyId: randomUUID(),
    actorUserId: randomUUID(),
    oldestOwner: randomUUID(),
    connectionId: randomUUID(),
  }
  fixtures.push(f)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${f.organizationId}, 'Renewal fixture', ${f.organizationId}, now())`,
  )
  for (const [userId, joinedAt] of [
    [f.oldestOwner, '2026-01-01'],
    [f.actorUserId, '2026-02-01'],
  ] as const) {
    await db.execute(
      sql`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${userId}, 'Manager', ${`${userId}@example.test`}, true, now(), now())`,
    )
    await db.execute(
      sql`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${userId}, ${f.organizationId}, 'owner', ${joinedAt}::timestamptz)`,
    )
  }
  await db.execute(sql`INSERT INTO google_connections (id, organization_id, google_subject, encrypted_access_token, encrypted_refresh_token, token_expires_at, scopes, connected_by, visibility, status)
    VALUES (${f.connectionId}::uuid, ${f.organizationId}, ${f.connectionId}, 'fixture', 'fixture', now() + interval '1 hour', ARRAY['https://www.googleapis.com/auth/business.manage'], ${f.actorUserId}, 'organization', 'active')`)
  await db.execute(sql`INSERT INTO properties (id, organization_id, name, slug, timezone, lifecycle_state, google_connection_id, gbp_account_id, gbp_location_id, google_binding_state, profile_source, source_epoch)
    VALUES (${f.propertyId}::uuid, ${f.organizationId}, 'Renewal property', ${f.propertyId}, 'UTC', 'active', ${f.connectionId}::uuid, 'account', ${f.propertyId}, 'active', 'legacy', 0)`)
  await db.execute(sql`INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch, head_sequence)
    VALUES (${f.organizationId}, ${f.propertyId}::uuid, 0, 0)`)
  initCapabilityPolicyStore(
    createEnvCapabilityPolicyStore({
      BETA_ALLOWLIST_ORGS: fixtures.map((item) => item.organizationId).join(','),
    }),
  )
  return f
}

function command(f: Fixture) {
  return {
    ...f,
    ...POLICY,
    ...OLD,
    idempotencyKey: randomUUID(),
    expectedStateVersion: 0,
    operation: 'enable' as const,
    state: 'enabled' as const,
    capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
    reasonCode: 'merchant_enabled',
    now: new Date(),
    ceremonyId: randomUUID(),
  }
}
function renewal(
  policy: Parameters<typeof createStandingRenewalStore>[0]['policy'] = POLICY,
) {
  return createStandingRenewalStore({
    db,
    idGen: randomUUID,
    policy,
    authorize: async (input) => {
      const decision = checkScopedCapability(input, PURPOSE[input.capability])
      return decision.allowed
        ? 'allowed'
        : decision.reason === 'org_suspended'
          ? 'org_suspended'
          : 'policy_denied'
    },
  })
}
const logged = { info: vi.fn(), error: vi.fn() }
/** The outcome a sweep logged for the Property: renewed, skipped:<reason>, failed:<code>. */
function outcomeOf(f: Fixture): string | undefined {
  for (const [fields] of logged.info.mock.calls as Array<[Record<string, unknown>]>) {
    if (fields.propertyId === f.propertyId && typeof fields.outcome === 'string') {
      return fields.outcome
    }
  }
  return undefined
}
function sweep(
  ceremonyId = randomUUID(),
  policy: Parameters<typeof createStandingRenewalStore>[0]['policy'] = POLICY,
) {
  const store = renewal(policy)
  return renewLapsedMerchantAiAuthorizations({
    store: {
      ...store,
      listLapsed: async () =>
        (await store.listLapsed()).filter((candidate) =>
          fixtures.some((f) => f.organizationId === candidate.organizationId),
        ),
    },
    target: { noticeVersion: policy.noticeVersion, noticeDigest: policy.noticeDigest },
    idGen: () => ceremonyId,
    clock: () => new Date(),
    logger: logged,
    captureUnexpected: (error) => {
      throw error
    },
  })()
}

/** A saved, unedited AI draft on a Review of the Property, as drafting leaves it. */
async function seedSavedDraft(f: Fixture): Promise<void> {
  const reviewId = randomUUID()
  await db.execute(sql`
    INSERT INTO reviews (id, organization_id, property_id, platform, external_id, rating, text,
      source_epoch, source_revision, analysis_sequence, content_expires_at,
      ai_source_byte_length, ai_source_digest)
    VALUES (${reviewId}::uuid, ${f.organizationId}, ${f.propertyId}::uuid, 'google', ${reviewId},
      5, 'A lovely stay', 0, 1, 0, now() + interval '1 day', 13, ${'e'.repeat(64)})
  `)
  await db.execute(sql`
    INSERT INTO replies (id, review_id, organization_id, text, reply_language_tag, status, source,
      created_by, ai_generated, authorship, origin_operation_id, origin_source_epoch,
      origin_source_revision, origin_base_reply_state_revision, origin_reply_drafting_epoch,
      origin_property_profile_version, origin_ai_profile_version, origin_reply_template_id,
      origin_reply_template_catalogue_version, origin_reply_template_catalogue_digest,
      origin_concrete_language_tag, origin_template_group, ai_draft_expires_at)
    VALUES (${randomUUID()}::uuid, ${reviewId}::uuid, ${f.organizationId}, ${DRAFT_TEXT},
      'en-Latn-US', 'draft', 'internal', ${f.actorUserId}, true, 'ai_assisted',
      ${randomUUID()}::uuid, 0, 1, 0, 1, 1, 'reply-suggestion-v1', 'appreciation_positive',
      'gbp-reply-template-catalogue-v1', ${AI_REPLY_TEMPLATE_CATALOGUE_DIGEST},
      'en-Latn-US', 'en-Latn', now() + interval '30 minutes')
  `)
}
async function savedDrafts(f: Fixture) {
  const result = await db.execute(
    sql`SELECT text, authorship::text AS authorship FROM replies WHERE organization_id = ${f.organizationId}`,
  )
  return result.rows
}

describe('standing renewal persistence', () => {
  it('renews enabled lapsed heads separately, preserving each capability set and source; a rerun is empty', async () => {
    const a = await seedProperty()
    const b = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    const beforeA = await store.mutate(command(a))
    await store.mutate({ ...command(b), capabilities: ['reply_drafting'] })
    const ceremonyId = randomUUID()
    expect(await sweep(ceremonyId)).toMatchObject({ renewed: 2, failed: 0 })
    expect(outcomeOf(a)).toBe('renewed')
    expect(outcomeOf(b)).toBe('renewed')
    const afterA = await store.getSnapshot(a)
    expect(afterA).toMatchObject({
      capabilities: beforeA.capabilities,
      authorizedSourceEpoch: 0,
      stateVersion: 2,
      capabilityEpochs: { review_analysis: 2, reply_drafting: 2, property_trends: 2 },
    })
    expect(await store.getSnapshot(b)).toMatchObject({
      capabilities: ['reply_drafting'],
      capabilityEpochs: { review_analysis: 1, reply_drafting: 2, property_trends: 1 },
    })
    const evidence = await db.execute(
      sql`SELECT actor_user_id, reason_code, ceremony_id FROM merchant_ai_consent_evidence WHERE organization_id = ${a.organizationId} AND state_version = 2`,
    )
    expect(evidence.rows).toEqual([
      {
        actor_user_id: a.actorUserId,
        reason_code: 'standing_renewal',
        ceremony_id: ceremonyId,
      },
    ])
    expect(await sweep()).toMatchObject({ visited: 0, renewed: 0 })
  })
  it('falls back to the longest-standing live owner after the consent author is demoted', async () => {
    const f = await seedProperty()
    await createMerchantAiAuthorizationStore(db, randomUUID).mutate(command(f))
    await db.execute(
      sql`UPDATE member SET role = 'admin' WHERE "organizationId" = ${f.organizationId} AND "userId" = ${f.actorUserId}`,
    )
    expect(await sweep()).toMatchObject({ renewed: 1 })
    const result = await db.execute(
      sql`SELECT actor_user_id FROM merchant_ai_consent_evidence WHERE organization_id = ${f.organizationId} AND reason_code = 'standing_renewal'`,
    )
    expect(result.rows).toEqual([{ actor_user_id: f.oldestOwner }])
  })
  it('never renews revoked or disabled heads', async () => {
    const revoked = await seedProperty()
    const disabled = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    await store.mutate(command(revoked))
    await store.mutate({
      ...command(revoked),
      expectedStateVersion: 1,
      operation: 'revoke',
      state: 'revoked',
      capabilities: [],
    })
    await store.restoreReset({ ...command(disabled), reasonCode: 'restore_safety' })
    expect(await sweep()).toMatchObject({ visited: 0 })
    expect(outcomeOf(revoked)).toBeUndefined()
    expect(outcomeOf(disabled)).toBeUndefined()
    expect(await store.getSnapshot(revoked)).toMatchObject({
      state: 'revoked',
      stateVersion: 2,
    })
    expect(await store.getSnapshot(disabled)).toMatchObject({
      state: 'disabled',
      stateVersion: 1,
    })
  })
  it('skips suspended and unbound Properties without recording evidence', async () => {
    const suspended = await seedProperty()
    const unbound = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    await store.mutate(command(suspended))
    await store.mutate(command(unbound))
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: suspended.organizationId,
        BETA_SUSPENDED_ORGS: suspended.organizationId,
      }),
    )
    await db.execute(
      sql`UPDATE properties SET google_binding_state = 'unbound', google_connection_id = NULL, gbp_account_id = NULL, gbp_location_id = NULL WHERE id = ${unbound.propertyId}::uuid`,
    )
    expect(await sweep()).toMatchObject({ renewed: 0, skipped: 2 })
    expect(outcomeOf(suspended)).toBe('skipped:org_suspended')
    expect(outcomeOf(unbound)).toBe('skipped:google_unbound')
    expect(await store.getSnapshot(suspended)).toMatchObject({
      stateVersion: 1,
      noticeVersion: OLD.noticeVersion,
    })
    expect(await store.getSnapshot(unbound)).toMatchObject({
      stateVersion: 1,
      noticeVersion: OLD.noticeVersion,
    })
  })
  it('preserves the analysis epoch and frontier across an immaterial notice', async () => {
    const f = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    const before = await store.mutate(command(f))
    expect(await sweep(randomUUID(), IMMATERIAL_TARGET)).toMatchObject({ renewed: 1 })
    expect(await store.getSnapshot(f)).toMatchObject({
      capabilityEpochs: before.capabilityEpochs,
      analysisStartSequence: before.analysisStartSequence,
    })
  })
  it('is a no-op for concurrent sweeps, with one evidence row and one state advance', async () => {
    const f = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    await store.mutate(command(f))
    await Promise.all([sweep(), sweep()])
    expect(await store.getSnapshot(f)).toMatchObject({ stateVersion: 2 })
    const result = await db.execute(
      sql`SELECT count(*)::int AS n FROM merchant_ai_consent_evidence WHERE organization_id = ${f.organizationId} AND reason_code = 'standing_renewal'`,
    )
    expect(result.rows).toEqual([{ n: 1 }])
  })
})

// Stored drafts bind to the drafting epoch, the recorded runtime and the provider
// deployment, not to state_version: a renewal that moves none of them leaves the
// drafts a manager saved; anything else withdraws them, as every other change does.
describe('saved AI reply drafts under standing renewal', () => {
  it('keeps a saved draft when the drafting epoch, runtime and deployment are unchanged', async () => {
    const f = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    await store.mutate({ ...command(f), capabilities: ['reply_drafting'] })
    await seedSavedDraft(f)
    expect(await sweep(randomUUID(), IMMATERIAL_TARGET)).toMatchObject({ renewed: 1 })
    expect(await store.getSnapshot(f)).toMatchObject({
      noticeVersion: IMMATERIAL_TARGET.noticeVersion,
      stateVersion: 2,
      capabilityEpochs: { reply_drafting: 1 },
    })
    expect(await savedDrafts(f)).toEqual([
      { text: DRAFT_TEXT, authorship: 'ai_assisted' },
    ])
  })

  it.each([
    {
      why: 'the new notice changes what drafting uses, so the drafting epoch moves',
      consent: {},
      consentRuntime: null,
      target: POLICY,
      epoch: 2,
    },
    {
      why: 'the provider deployment differs from the one consented under',
      consent: { providerDeploymentProfileVersion: 'private-beta-global-v1' as const },
      consentRuntime: null,
      target: IMMATERIAL_TARGET,
      epoch: 1,
    },
    {
      why: 'the served drafting runtime differs from the one consented under',
      consent: {},
      consentRuntime: 'reply-drafting-runtime-v2',
      target: IMMATERIAL_TARGET,
      epoch: 1,
    },
  ])('withdraws a saved draft when $why', async (scenario) => {
    const f = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    served.replyDraftingRuntime = scenario.consentRuntime
    await store.mutate({
      ...command(f),
      ...scenario.consent,
      capabilities: ['reply_drafting'],
    })
    served.replyDraftingRuntime = null
    await seedSavedDraft(f)
    expect(await sweep(randomUUID(), scenario.target)).toMatchObject({ renewed: 1 })
    expect(await store.getSnapshot(f)).toMatchObject({
      stateVersion: 2,
      capabilityEpochs: { reply_drafting: scenario.epoch },
    })
    expect(await savedDrafts(f)).toEqual([])
  })

  it('withdraws a saved draft on a merchant-made change even when no epoch moves', async () => {
    const f = await seedProperty()
    const store = createMerchantAiAuthorizationStore(db, randomUUID)
    await store.mutate({ ...command(f), capabilities: ['reply_drafting'] })
    await seedSavedDraft(f)
    await store.mutate({
      ...command(f),
      ...IMMATERIAL_TARGET,
      operation: 'change',
      expectedStateVersion: 1,
      capabilities: ['reply_drafting'],
    })
    expect(await store.getSnapshot(f)).toMatchObject({
      stateVersion: 2,
      capabilityEpochs: { reply_drafting: 1 },
    })
    expect(await savedDrafts(f)).toEqual([])
  })
})

describe('AI update receipts', () => {
  it('covers older automatically applied notices when the newest update is seen', async () => {
    const f = await seedProperty()
    await createMerchantAiAuthorizationStore(db, randomUUID).mutate(command(f))
    const older = IMMATERIAL_TARGET
    await sweep(randomUUID(), older)
    await sweep()
    const receipts = createMerchantAiNoticeUpdateStore(db)
    const reader = { organizationId: f.organizationId, actorUserId: f.actorUserId }
    await receipts.markSeen({
      ...reader,
      noticeVersion: POLICY.noticeVersion,
      noticeDigest: POLICY.noticeDigest,
    })
    expect(await receipts.latest({ ...reader, unseenOnly: true })).toBeNull()
    expect(await receipts.latest({ ...reader, unseenOnly: false })).toMatchObject({
      noticeVersion: POLICY.noticeVersion,
    })
    const rows = await db.execute(
      sql`SELECT notice_version FROM merchant_ai_notice_update_receipts WHERE organization_id = ${f.organizationId} ORDER BY notice_version`,
    )
    expect(rows.rows).toEqual([
      { notice_version: older.noticeVersion },
      { notice_version: POLICY.noticeVersion },
    ])
  })

  it('inserts idempotently per AccountAdmin and exports only the session organization', async () => {
    const f = await seedProperty()
    await createMerchantAiAuthorizationStore(db, randomUUID).mutate(command(f))
    await sweep()
    const receipts = createMerchantAiNoticeUpdateStore(db)
    const reader = {
      organizationId: f.organizationId,
      actorUserId: f.actorUserId,
      unseenOnly: true,
    }
    const update = await receipts.latest(reader)
    expect(update).toMatchObject({
      noticeVersion: POLICY.noticeVersion,
      title: 'AI review insights got an upgrade',
    })
    const input = {
      ...reader,
      noticeVersion: POLICY.noticeVersion,
      noticeDigest: POLICY.noticeDigest,
    }
    await receipts.markSeen(input)
    await receipts.markSeen(input)
    expect(await receipts.latest(reader)).toBeNull()
    expect(
      await receipts.latest({ ...reader, actorUserId: f.oldestOwner }),
    ).not.toBeNull()
    const rows = await db.execute(
      sql`SELECT user_id FROM merchant_ai_notice_update_receipts WHERE organization_id = ${f.organizationId}`,
    )
    expect(rows.rows).toEqual([{ user_id: f.actorUserId }])
    const exported = await createIdentityOrganizationExportContributor(db).contribute({
      organizationId: f.organizationId,
      requestId: randomUUID(),
      asOf: new Date(),
    })
    const json = exported.entries.find((entry) => entry.mediaType === 'application/json')!
    expect(
      JSON.parse(Buffer.from(json.bytes).toString()).merchantAiNoticeUpdateReceipts,
    ).toHaveLength(1)
  })
})
