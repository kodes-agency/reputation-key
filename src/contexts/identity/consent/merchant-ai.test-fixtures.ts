import { readFileSync } from 'node:fs'
import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { newTestId, testDatabaseUrl, testDb } from '#/shared/testing/ambient-test-runtime'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  createMerchantAiAuthorizationStore,
  hasActiveMerchantAiConsent,
  type MerchantAiAuthorizationFence,
} from './merchant-ai-authorization.repository.server'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiSnapshot,
} from './merchant-ai-authorization.server'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { createAiAdvisoryScope } from '#/shared/ai-operation/ai-lock-order-v1'
import {
  getAiRuntimeCapability,
  isExecutionCompatibleWithConsent,
} from '#/shared/merchant-ai-notice/ai-runtime-capability-contract'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'

export const db = testDb()
export const ORG = '30000000-0000-4000-8000-000000000001'
export const USER = 'user-merchant-ai-store'
export const PROPERTY = '10000000-0000-4000-8000-000000000001'
export const CONNECTION = '20000000-0000-4000-8000-000000000001'
export const NOW = new Date('2026-08-15T12:00:00.000Z')
export const PREVIOUS_NOTICE_VERSION = 'merchant-ai-notice-2026-09-08.v1'
export const PREVIOUS_NOTICE_DIGEST =
  'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'
export const NOTICE_2026_10_17 = {
  noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
  noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
} as const
export const NOTICE_2026_10_30 = {
  noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
  noticeDigest: 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
} as const
export const NOTICE_2026_11_01 = {
  noticeVersion: 'merchant-ai-notice-2026-11-01.v1',
  noticeDigest: 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef',
} as const

export const store = createMerchantAiAuthorizationStore(db, newTestId, replyScopeEffects)

type Capability = keyof MerchantAiSnapshot['capabilityEpochs']

export const PURPOSE_BY_CAPABILITY = {
  review_analysis: 'ai.analyze',
  property_trends: 'ai.detect_trends',
  reply_drafting: 'ai.generate_reply',
} as const satisfies Record<Capability, string>

export function command(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    propertyId: PROPERTY,
    actorUserId: USER,
    idempotencyKey: 'merchant-command-0001',
    expectedStateVersion: 0,
    operation: 'enable' as const,
    state: 'enabled' as const,
    capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
    reasonCode: 'merchant_enabled',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: 'private-beta-global-v2' as const,
    redactionProfileFamily: 'gbp-review-global-v1',
    now: NOW,
    ceremonyId: newTestId(),
    ...overrides,
  }
}

/** A capability change on top of `previous` (a snapshot or its state version). */
export function change(
  previous: number | { stateVersion: number },
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
) {
  return command({
    operation: 'change',
    idempotencyKey,
    expectedStateVersion: typeof previous === 'number' ? previous : previous.stateVersion,
    reasonCode: 'capabilities_changed',
    ...overrides,
  })
}

/**
 * Whether a recorded grant is one the build serves for a capability: the notice in the
 * runtime catalogue's list and the deployment profile it names. The AI context asks the
 * same two questions (`isAiAuthorizationUnderServedContract`) before it claims work.
 */
export function underServedContract(
  snapshot: MerchantAiSnapshot,
  capability: Capability,
): boolean {
  if (capability === 'property_trends') return false
  const served = getAiRuntimeCapability(capability)
  return isExecutionCompatibleWithConsent({
    capability,
    acknowledgedNotice: snapshot,
    servedExecution: served,
  })
}

export function isConsentActive(
  purpose: string,
  expectedFence?: MerchantAiAuthorizationFence,
): Promise<boolean> {
  return hasActiveMerchantAiConsent(db, {
    organizationId: ORG,
    propertyId: PROPERTY,
    purpose,
    ...(expectedFence ? { expectedFence } : {}),
  })
}

export function fence(
  snapshot: MerchantAiSnapshot,
  capability: Capability,
): MerchantAiAuthorizationFence {
  const runtimeProfileVersion = snapshot.capabilityRuntimeProfileVersions[capability]
  if (!snapshot.authorizationLineageId || !runtimeProfileVersion) {
    throw new Error('Test snapshot does not contain an executable authorization fence')
  }
  return {
    authorizationLineageId: snapshot.authorizationLineageId,
    capabilityEpoch: snapshot.capabilityEpochs[capability],
    authorizedSourceEpoch: snapshot.authorizedSourceEpoch,
    stateVersion: snapshot.stateVersion,
    noticeDigest: snapshot.noticeDigest,
    recordedRuntimeProfileVersion: runtimeProfileVersion,
    servedExecution:
      capability === 'property_trends'
        ? {
            runtimeProfileVersion: 'property-trends-runtime-v1',
            operationProfileVersion: 'property-trend-v1',
            providerDeploymentProfileVersion: 'private-beta-global-v2',
          }
        : getAiRuntimeCapability(capability),
  }
}

type Executor = Pick<typeof db, 'execute'>

const HEAD_FILTER = sql`organization_id = ${ORG} AND property_id = ${PROPERTY}::uuid AND source_epoch = 3`

export async function readAnalysisHead() {
  const head = await db.execute(sql`
    SELECT head_sequence FROM review_ai_analysis_heads WHERE ${HEAD_FILTER}
  `)
  return head.rows
}

export async function setAnalysisHead(
  headSequence: number,
  executor: Executor = db,
): Promise<void> {
  await executor.execute(sql`
    UPDATE review_ai_analysis_heads SET head_sequence = ${headSequence} WHERE ${HEAD_FILTER}
  `)
}

export async function deleteAnalysisHead(): Promise<void> {
  await db.execute(sql`DELETE FROM review_ai_analysis_heads WHERE ${HEAD_FILTER}`)
}

export interface TransitionArgs {
  lineageId: string | null | undefined
  fromVersion: number
  operation?: string
  capabilities?: readonly string[]
  runtimeProfiles: Record<string, string>
  epochs: { review_analysis: number; reply_drafting: number; property_trends: number }
  analysisStartSequence: number
  notice?: { noticeVersion: string; noticeDigest: string }
  deploymentProfile?: string
  reasonCode: string
  idempotencyKey: string
  digestFill: string
  /** Omitted: a fresh ceremony id. `null`: the trailing ceremony argument is left out. */
  ceremonyId?: string | null
  /** Read the returned row's columns instead of the bare function result. */
  expand?: boolean
}

/** Calls `apply_merchant_ai_transition_v1` directly, bypassing the store. */
export function applyTransition(executor: Executor, args: TransitionArgs) {
  const notice = args.notice ?? {
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  }
  const capabilities = args.capabilities ?? CURRENT_MERCHANT_AI_CAPABILITIES
  const values = [
    sql`${args.lineageId}::uuid`,
    sql`${args.fromVersion}`,
    sql`${args.fromVersion + 1}`,
    sql`${ORG}`,
    sql`${PROPERTY}::uuid`,
    sql`${args.operation ?? 'change'}`,
    sql`'enabled'`,
    sql`ARRAY[${sql.join(
      capabilities.map((capability) => sql`${capability}`),
      sql`, `,
    )}]::text[]`,
    sql`${JSON.stringify(args.runtimeProfiles)}::jsonb`,
    sql`${args.epochs.review_analysis}`,
    sql`${args.epochs.reply_drafting}`,
    sql`${args.epochs.property_trends}`,
    sql`3`,
    sql`${args.analysisStartSequence}`,
    sql`${notice.noticeVersion}`,
    sql`${notice.noticeDigest}`,
    sql`'google-business-profile-source-policy-v1'`,
    sql`1`,
    sql`'global'`,
    sql`${args.deploymentProfile ?? 'private-beta-global-v2'}`,
    sql`'gbp-review-global-v1'`,
    sql`${USER}`,
    sql`${args.reasonCode}`,
    sql`${args.idempotencyKey}`,
    sql`${args.digestFill.repeat(64)}`,
    sql`${NOW}`,
    ...(args.ceremonyId === null ? [] : [sql`${args.ceremonyId ?? newTestId()}::uuid`]),
  ]
  const call = sql`apply_merchant_ai_transition_v1(${sql.join(values, sql`, `)})`
  return executor.execute(args.expand ? sql`SELECT (${call}).*` : sql`SELECT ${call}`)
}

/**
 * A Property enabled the day before the switch-on of review analysis v3: all three
 * capabilities, granted under the 2026-10-17 notice, the deployment profile
 * `private-beta-global-v1` and the review analysis runtime profile v1. It is written
 * through the database function the application uses, with the values that deploy
 * left behind, because the application can no longer write them.
 */
export async function enableAsBeforeTheSwitchOn(
  notice: { noticeVersion: string; noticeDigest: string } = NOTICE_2026_10_17,
): Promise<MerchantAiSnapshot> {
  const [head] = await readAnalysisHead()
  await applyTransition(db, {
    lineageId: newTestId(),
    fromVersion: 0,
    operation: 'enable',
    runtimeProfiles: {
      review_analysis: 'review-analysis-runtime-v1',
      reply_drafting: 'reply-drafting-runtime-v1',
      property_trends: 'property-trends-runtime-v1',
    },
    epochs: { review_analysis: 1, reply_drafting: 1, property_trends: 1 },
    analysisStartSequence: Number(head?.head_sequence),
    notice,
    deploymentProfile: 'private-beta-global-v1',
    reasonCode: 'merchant_enabled',
    idempotencyKey: 'enabled-before-the-switch-on',
    digestFill: 'e',
  })
  const snapshot = await store.getSnapshot({ organizationId: ORG, propertyId: PROPERTY })
  if (snapshot === null) throw new Error('The grant before the switch-on was not written')
  return snapshot
}

async function insertProperty(): Promise<void> {
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, lifecycle_state,
      google_connection_id, gbp_account_id, gbp_location_id,
      google_binding_state, profile_source, source_epoch
    ) VALUES (
      ${PROPERTY}::uuid, ${ORG}, 'AI Property', 'ai-property', 'UTC', 'active',
      ${CONNECTION}::uuid, 'account-1', 'location-1',
      'active', 'legacy', 3
    )
  `)
  await db.execute(sql`
    INSERT INTO review_ai_analysis_heads (
      organization_id, property_id, source_epoch, head_sequence
    ) VALUES (${ORG}, ${PROPERTY}::uuid, 3, 7)
  `)
  await db.execute(sql`
    INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES (${ORG}, ${PROPERTY}::uuid, ${USER}, 'operator', ${USER})
  `)
}

export async function replaceSourceEpoch(
  sourceEpoch: number,
  headSequence = 0,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE properties
      SET source_epoch = ${sourceEpoch}
      WHERE organization_id = ${ORG}
        AND id = ${PROPERTY}::uuid
    `)
    await tx.execute(sql`
      INSERT INTO review_ai_analysis_heads (
        organization_id, property_id, source_epoch, head_sequence
      ) VALUES (${ORG}, ${PROPERTY}::uuid, ${sourceEpoch}, ${headSequence})
    `)
  })
}

export async function advanceAnalysisHead(): Promise<number> {
  return db.transaction(async (tx) => {
    const scope = createAiAdvisoryScope('provider-source', [ORG, PROPERTY, 3])
    await tx.execute(sql`SELECT pg_advisory_xact_lock(ai_advisory_lock_key_v1(${scope}))`)
    await tx.execute(sql`
      SELECT id
      FROM properties
      WHERE organization_id = ${ORG}
        AND id = ${PROPERTY}::uuid
      FOR UPDATE
    `)
    const result = await tx.execute(sql`
      SELECT lock_review_ai_analysis_head_v1(
        ${ORG}, ${PROPERTY}::uuid, 3
      ) AS head_sequence
    `)
    return Number(result.rows[0]?.head_sequence)
  })
}

async function resetAuthorization(): Promise<void> {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}::uuid`)
  await insertProperty()
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES ('member-merchant-ai-store', ${USER}, ${ORG}, 'owner', now())
    ON CONFLICT (id) DO UPDATE SET role = 'owner'
  `)
}

/**
 * Registers the org/user/member/connection/property seed, the per-test reset and the
 * teardown for the calling test file. Returns the pool the last-owner-guard teardown
 * runs on, for tests that must remove or demote the only owner.
 */
export function useMerchantAiFixture(): { cleanupPool: () => Pool } {
  let cleanupPool: Pool

  beforeAll(async () => {
    cleanupPool = new Pool({ connectionString: testDatabaseUrl(), max: 1 })
    await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
      await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
    })
    await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}::uuid`)
    await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION}::uuid`)
    await db.execute(sql`DELETE FROM "user" WHERE id = ${USER}`)
    await deleteTestOrganizations(db, [ORG])
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG}, 'Merchant AI Store', ${ORG}, now())
    `)
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${USER}, 'Merchant AI Owner', 'merchant-ai-store@example.test', true, now(), now())
    `)
    await db.execute(sql`
      INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
      VALUES ('member-merchant-ai-store', ${USER}, ${ORG}, 'owner', now())
    `)
    await seedGoogleConnection(drizzleSeedRunner(db), {
      id: CONNECTION,
      organizationId: ORG,
      googleSubject: 'merchant-ai-store-subject',
      accessToken: 'encrypted-access',
      refreshToken: 'encrypted-refresh',
      connectedBy: USER,
    })
    await insertProperty()
  })

  beforeEach(resetAuthorization)

  afterAll(async () => {
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}::uuid`)
    await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION}::uuid`)
    await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
      await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
      await client.query('DELETE FROM "user" WHERE id = $1', [USER])
      await deleteTestOrganizations(client, [ORG])
    })
    await cleanupPool.end()
  })

  return { cleanupPool: () => cleanupPool }
}

/** A migration's statements, split the way the Drizzle migrator splits them. */
export function statementsOf(migration: URL): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- committed migration history, never request input
  return readFileSync(migration, 'utf8')
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}
