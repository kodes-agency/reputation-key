import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import { merchantAiNoticeInForceSql } from '#/shared/db/merchant-ai-notice-in-force'
import { isMerchantAiNoticeInForceForCapabilities } from '#/shared/merchant-ai-notice-contract'
import type { MerchantAiSnapshot } from '../../domain/merchant-ai-authorization'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import {
  MerchantAiAuthorizationStoreError,
  type MerchantAiMutationInput,
} from '../../application/use-cases/merchant-ai-authorization'
import type {
  StandingRenewalStore,
  StandingRenewalOutcome,
} from '../../application/use-cases/renew-lapsed-merchant-ai-authorizations'
import {
  STANDING_RENEWAL_REASON,
  standingRenewalActor,
  standingRenewalPropertySkip,
  standingRenewalTargetSkip,
  type StandingRenewalSkip,
} from '../../domain/merchant-ai-standing-renewal'
import {
  mapSnapshot,
  runMerchantAiMutation,
  type SnapshotRow,
} from './merchant-ai-transition'

type Input = Parameters<StandingRenewalStore['renew']>[0]
type Policy = Pick<
  MerchantAiMutationInput,
  | 'noticeVersion'
  | 'noticeDigest'
  | 'sourcePolicyId'
  | 'routingPolicyVersion'
  | 'providerDeploymentProfileVersion'
  | 'redactionProfileFamily'
>
type Deps = Readonly<{
  db: Database
  idGen: () => string
  policy: Policy
  authorize: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      capability: MerchantAiCapability
    }>,
  ) => Promise<'allowed' | 'org_suspended' | 'policy_denied'>
}>
const skipped = (reason: StandingRenewalSkip): StandingRenewalOutcome => ({
  status: 'skipped',
  reason,
})

async function actorFor(
  tx: Tx,
  input: Input,
  head: MerchantAiSnapshot,
): Promise<string | null> {
  const owners = await tx.execute<{ user_id: string; joined_at: Date }>(sql`
    SELECT m."userId" AS user_id, m."createdAt" AS joined_at
    FROM member m JOIN "user" u ON u.id = m."userId"
    WHERE m."organizationId" = ${input.organizationId} AND m.role = 'owner'
  `)
  const evidence = await tx.execute<{ actor_user_id: string }>(sql`
    SELECT actor_user_id FROM merchant_ai_consent_evidence
    WHERE organization_id = ${input.organizationId} AND property_id = ${input.propertyId}::uuid
      AND authorization_lineage_id = ${head.authorizationLineageId}::uuid
      AND state_version = ${head.stateVersion}
  `)
  return standingRenewalActor(
    evidence.rows[0]?.actor_user_id ?? null,
    owners.rows.map((owner) => ({
      userId: owner.user_id,
      joinedAt: new Date(owner.joined_at),
    })),
  )
}

async function readCandidate(tx: Tx, input: Input, policy: Policy) {
  const rows = await tx.execute(sql`
    SELECT h.*, p.deleted_at, p.lifecycle_state, p.google_binding_state, p.source_epoch
    FROM merchant_ai_enablement h JOIN properties p
      ON p.id = h.property_id AND p.organization_id = h.organization_id
    WHERE h.organization_id = ${input.organizationId} AND h.property_id = ${input.propertyId}::uuid
  `)
  const row = rows.rows[0] as SnapshotRow | undefined
  if (!row) return { skip: 'head_changed' } as const
  const head = mapSnapshot(row)
  if (head.state !== 'enabled' || head.stateVersion !== input.stateVersion)
    return { skip: 'head_changed' } as const
  // A head is current only when every capability it has on is under a notice
  // in force for that capability (ADR 0074).
  if (isMerchantAiNoticeInForceForCapabilities(head))
    return { skip: 'already_renewed' } as const
  const noticeSkip = standingRenewalTargetSkip(head.noticeVersion, policy.noticeVersion)
  if (noticeSkip) return { skip: noticeSkip }
  const skip = standingRenewalPropertySkip({
    deleted: row.deleted_at !== null,
    lifecycleState: String(row.lifecycle_state),
    googleBindingState: String(row.google_binding_state),
    sourceEpoch: Number(row.source_epoch),
    authorizedSourceEpoch: head.authorizedSourceEpoch,
  })
  return skip ? { skip } : { head }
}

async function renewInTransaction(
  tx: Tx,
  deps: Deps,
  input: Input,
): Promise<StandingRenewalOutcome> {
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`)
  const candidate = await readCandidate(tx, input, deps.policy)
  if (candidate.skip) return skipped(candidate.skip)
  const actorUserId = await actorFor(tx, input, candidate.head)
  if (!actorUserId) return skipped('no_account_admin')
  for (const capability of candidate.head.capabilities) {
    const decision = await deps.authorize({ ...input, capability })
    if (decision !== 'allowed') return skipped(decision)
  }
  // The shared change path locks and rechecks Property, membership and head.
  // Its standing-renewal guard also forbids rebinding to a different source.
  await runMerchantAiMutation(
    tx,
    {
      ...deps.policy,
      ...input,
      actorUserId,
      expectedStateVersion: input.stateVersion,
      operation: 'change',
      state: 'enabled',
      capabilities: candidate.head.capabilities,
      reasonCode: STANDING_RENEWAL_REASON,
    },
    deps.idGen,
    true,
  )
  return { status: 'renewed' }
}

export function standingRenewalErrorSkip(error: unknown): StandingRenewalSkip | null {
  if (error instanceof MerchantAiAuthorizationStoreError) {
    if (error.code === 'no_op') return 'already_renewed'
    if (
      ['version_conflict', 'invalid_transition', 'idempotency_conflict'].includes(
        error.code,
      )
    )
      return 'head_changed'
    if (error.code === 'property_inactive') return 'property_not_manageable'
    if (['membership_denied', 'assignment_denied'].includes(error.code))
      return 'no_account_admin'
  }
  const code = error as { code?: string; cause?: { code?: string } } | null
  return [code?.code, code?.cause?.code].includes('55P03') ? 'lock_timeout' : null
}

export function createStandingRenewalStore(deps: Deps): StandingRenewalStore {
  return {
    async listLapsed() {
      const result = await deps.db.execute<{
        organization_id: string
        property_id: string
        state_version: number
      }>(sql`
        SELECT organization_id, property_id, state_version FROM merchant_ai_enablement
        WHERE state = 'enabled' AND NOT ${merchantAiNoticeInForceSql(sql`notice_version`, sql`notice_digest`, sql`capabilities`)}
        ORDER BY property_id
      `)
      return result.rows.map((row) => ({
        organizationId: row.organization_id,
        propertyId: row.property_id,
        stateVersion: row.state_version,
      }))
    },
    async renew(input) {
      try {
        return await deps.db.transaction((tx) => renewInTransaction(tx, deps, input))
      } catch (error) {
        const reason = standingRenewalErrorSkip(error)
        if (reason) return skipped(reason)
        throw error
      }
    },
  }
}
