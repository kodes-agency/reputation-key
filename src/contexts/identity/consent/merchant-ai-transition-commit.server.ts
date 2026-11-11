import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { nextMerchantAiCapabilityEpochs } from '../domain/merchant-ai-capability-epochs'
import { materiallyChangedMerchantAiCapabilities } from '#/shared/merchant-ai-notice-change'
import type {
  CapabilityRuntimeProfileVersions,
  MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { organizationId } from '#/shared/domain/ids'
import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'
import {
  purgeAiDraftsForAuthorization,
  purgeAiDraftsForProfile,
} from '#/shared/db/ai/ai-draft-purge'
import { identityMerchantAiChanged } from '../domain/events'
import { standingRenewalKeepsSavedDrafts } from '../domain/merchant-ai-standing-renewal'
import type {
  MerchantAiCapabilityEpochs,
  MerchantAiSnapshot,
  MerchantAiState,
} from '../domain/merchant-ai-authorization'
import { deleteMerchantAiDecisionDeferral } from './merchant-ai-decision.repository.server'
import {
  MerchantAiAuthorizationStoreError,
  type MerchantAiMutationInput,
  type MerchantAiRestoreResetInput,
} from './merchant-ai-authorization.server'
import {
  lockMerchantAiHead,
  mapSnapshot,
  readIdempotentEvidence,
  readSafeBigint,
  type SnapshotRow,
} from './merchant-ai-snapshot.server'

// The commit every Merchant AI transition ends in: evidence and head through
// `apply_merchant_ai_transition_v1`, stale drafts, the superseded deferral and
// the outbox fact. `transitionMerchantAi` reaches it after its locks and
// fences; a restore reset, which has no actor and starts a new lineage,
// reaches it directly.

type MerchantAiOperation = MerchantAiMutationInput['operation']

function restoreRequestHash(input: MerchantAiRestoreResetInput): string {
  return createHash('sha256')
    .update('merchant-ai-restore-reset-v1\0', 'utf8')
    .update(
      canonicalizeRfc8785({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        idempotencyKey: input.idempotencyKey,
        expectedStateVersion: input.expectedStateVersion,
        reasonCode: input.reasonCode,
        noticeVersion: input.noticeVersion,
        noticeDigest: input.noticeDigest,
        sourcePolicyId: input.sourcePolicyId,
        routingPolicyVersion: input.routingPolicyVersion,
        providerDeploymentProfileVersion: input.providerDeploymentProfileVersion,
        redactionProfileFamily: input.redactionProfileFamily,
      }),
      'utf8',
    )
    .digest('hex')
}

/** One evidence row and the head it becomes, as `apply_merchant_ai_transition_v1` takes them. */
type TransitionRecord = Readonly<{
  organizationId: string
  propertyId: string
  authorizationLineageId: string
  expectedStateVersion: number
  stateVersion: number
  transitionKind: MerchantAiOperation | 'restore_reset'
  state: MerchantAiState
  capabilities: ReadonlyArray<MerchantAiCapability>
  runtimeProfiles: CapabilityRuntimeProfileVersions
  capabilityEpochs: MerchantAiCapabilityEpochs
  authorizedSourceEpoch: number
  analysisStartSequence: number
  policy: Pick<
    MerchantAiMutationInput,
    | 'noticeVersion'
    | 'noticeDigest'
    | 'sourcePolicyId'
    | 'routingPolicyVersion'
    | 'providerDeploymentProfileVersion'
    | 'redactionProfileFamily'
  >
  actorUserId: string
  reasonCode: string
  idempotencyKey: string
  requestHash: string
  now: Date
  ceremonyId: string | null
}>

/**
 * Write one validated transition: the evidence row and head, the saved drafts
 * it leaves stale, the standing deferral an enable supersedes, and the
 * identifier-only outbox fact. The caller holds the Property and head locks.
 */
async function writeTransition(
  tx: Tx,
  record: TransitionRecord,
  current: MerchantAiSnapshot | null,
  replyEffects: ReplyScopeEffects | undefined,
): Promise<MerchantAiSnapshot> {
  const capabilityArray =
    record.capabilities.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(
          record.capabilities.map((capability) => sql`${capability}`),
          sql`, `,
        )}]::text[]`
  const { policy, capabilityEpochs } = record
  const evidenceResult = await tx.execute(sql`
    SELECT (
      apply_merchant_ai_transition_v1(
        ${record.authorizationLineageId}::uuid,
        ${record.expectedStateVersion},
        ${record.stateVersion},
        ${record.organizationId},
        ${record.propertyId}::uuid,
        ${record.transitionKind},
        ${record.state},
        ${capabilityArray},
        ${canonicalizeRfc8785(record.runtimeProfiles)}::jsonb,
        ${capabilityEpochs.review_analysis},
        ${capabilityEpochs.reply_drafting},
        ${capabilityEpochs.property_trends},
        ${record.authorizedSourceEpoch},
        ${record.analysisStartSequence},
        ${policy.noticeVersion},
        ${policy.noticeDigest},
        ${policy.sourcePolicyId},
        ${policy.routingPolicyVersion},
        'global',
        ${policy.providerDeploymentProfileVersion},
        ${policy.redactionProfileFamily},
        ${record.actorUserId},
        ${record.reasonCode},
        ${record.idempotencyKey},
        ${record.requestHash},
        ${record.now},
        ${record.ceremonyId}::uuid
      )
    ).*
  `)
  const evidence = evidenceResult.rows[0] as SnapshotRow

  await withdrawStaleDrafts(tx, record, current, replyEffects)
  if (record.state === 'enabled') {
    // The decision is made: a standing "not now" ends with the enable that
    // supersedes it, in the same transaction (a change starts from an enabled
    // head, so this deletes nothing there).
    await deleteMerchantAiDecisionDeferral(tx, {
      organizationId: record.organizationId,
      propertyId: record.propertyId,
    })
  }
  const snapshot = mapSnapshot(evidence)
  await insertOutboxRow(
    tx,
    identityMerchantAiChanged({
      organizationId: organizationId(record.organizationId),
      propertyId: record.propertyId,
      authorizationLineageId: record.authorizationLineageId,
      state: record.state,
      reviewAnalysisEpoch: capabilityEpochs.review_analysis,
      replyDraftingEpoch: capabilityEpochs.reply_drafting,
      propertyTrendsEpoch: capabilityEpochs.property_trends,
      authorizedSourceEpoch: record.authorizedSourceEpoch,
      analysisStartSequence: record.analysisStartSequence,
      stateVersion: record.stateVersion,
      occurredAt: record.now,
    }),
  )
  return snapshot
}

/** Withdraw the saved AI drafts this transition leaves stale, unless a standing renewal keeps them. */
async function withdrawStaleDrafts(
  tx: Tx,
  record: TransitionRecord,
  current: MerchantAiSnapshot | null,
  replyEffects: ReplyScopeEffects | undefined,
): Promise<void> {
  if (
    standingRenewalKeepsSavedDrafts(record.reasonCode, current, {
      capabilityEpochs: record.capabilityEpochs,
      runtimeProfiles: record.runtimeProfiles,
      providerDeploymentProfileVersion: record.policy.providerDeploymentProfileVersion,
    })
  )
    return
  const purgeDrafts =
    record.state !== 'enabled' || !record.capabilities.includes('reply_drafting')
      ? purgeAiDraftsForAuthorization
      : purgeAiDraftsForProfile
  await purgeDrafts(
    tx,
    {
      organizationId: record.organizationId,
      propertyId: record.propertyId,
    },
    replyEffects,
  )
}

/**
 * Commit an enable, change or revoke whose locks and fences have passed: the
 * Review analysis frontier, the next epochs, and the shared write.
 */
export async function commitGrantTransition(
  tx: Tx,
  input: MerchantAiMutationInput,
  facts: Readonly<{
    current: MerchantAiSnapshot | null
    runtimeProfiles: CapabilityRuntimeProfileVersions
    authorizedSourceEpoch: number
    requestHash: string
  }>,
  idGen: () => string,
  replyEffects: ReplyScopeEffects | undefined,
): Promise<MerchantAiSnapshot> {
  const { current, runtimeProfiles, authorizedSourceEpoch, requestHash } = facts
  const sourceRebound =
    current !== null && current.authorizedSourceEpoch !== authorizedSourceEpoch
  const materiallyChanged =
    current === null ? [] : materiallyChangedMerchantAiCapabilities(current, input)

  let currentAnalysisHeadSequence: number | null = null
  if (input.operation !== 'revoke') {
    // A Property with no Reviews has no allocator row yet: Review creates
    // it lazily when the first material revision receives a sequence.
    // Merchant authorization still needs an exact frontier, so create the
    // explicit zero head while the Property row is locked, but only when
    // the source epoch truly has no Review identity. A missing head next
    // to an existing Review is corruption and must remain unavailable.
    // The Review allocator takes that same lock before incrementing,
    // making 0 an honest "no material revisions allocated" authority
    // rather than synthetic analyzed work or an inferred default.
    await tx.execute(sql`
      INSERT INTO review_ai_analysis_heads (
        organization_id, property_id, source_epoch, head_sequence
      )
      SELECT ${input.organizationId}, ${input.propertyId}::uuid,
             ${authorizedSourceEpoch}, 0
      WHERE NOT EXISTS (
        SELECT 1
        FROM reviews
        WHERE organization_id = ${input.organizationId}
          AND property_id = ${input.propertyId}::uuid
          AND source_epoch = ${authorizedSourceEpoch}
      )
      ON CONFLICT (organization_id, property_id, source_epoch) DO NOTHING
    `)
    const analysisHeadResult = await tx.execute(sql`
      SELECT head_sequence
      FROM review_ai_analysis_heads
      WHERE organization_id = ${input.organizationId}
        AND property_id = ${input.propertyId}::uuid
        AND source_epoch = ${authorizedSourceEpoch}
      FOR SHARE
    `)
    const analysisHead = analysisHeadResult.rows[0] as SnapshotRow | undefined
    if (!analysisHead) {
      throw new MerchantAiAuthorizationStoreError(
        'property_inactive',
        'Current Review analysis source head is unavailable',
      )
    }
    currentAnalysisHeadSequence = readSafeBigint(analysisHead, 'head_sequence', 0)
  }

  const capabilityEpochs = nextMerchantAiCapabilityEpochs(
    current,
    input,
    sourceRebound,
    materiallyChanged,
  )
  const analysisWillBeEnabled = input.capabilities.includes('review_analysis')
  const previousReviewAnalysisEpoch = current?.capabilityEpochs.review_analysis ?? 0
  const resetsAnalysisWatermark =
    analysisWillBeEnabled &&
    capabilityEpochs.review_analysis > previousReviewAnalysisEpoch
  const analysisStartSequence = resetsAnalysisWatermark
    ? currentAnalysisHeadSequence
    : (current?.analysisStartSequence ?? 0)
  if (analysisStartSequence === null) {
    throw new MerchantAiAuthorizationStoreError(
      'property_inactive',
      'Current Review analysis source head is unavailable',
    )
  }

  return writeTransition(
    tx,
    {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      authorizationLineageId: current?.authorizationLineageId ?? idGen(),
      expectedStateVersion: input.expectedStateVersion,
      stateVersion: (current?.stateVersion ?? 0) + 1,
      transitionKind: input.operation,
      state: input.state,
      capabilities: input.capabilities,
      runtimeProfiles,
      capabilityEpochs,
      authorizedSourceEpoch,
      analysisStartSequence,
      policy: input,
      actorUserId: input.actorUserId,
      reasonCode: input.reasonCode,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      now: input.now,
      ceremonyId: input.ceremonyId,
    },
    current,
    replyEffects,
  )
}

/**
 * Replace a restored head with a fresh disabled lineage, so no grant survives
 * a restore without a new merchant decision. Inside the caller's transaction.
 */
export async function resetMerchantAiForRestore(
  tx: Tx,
  input: MerchantAiRestoreResetInput,
  idGen: () => string,
  replyEffects: ReplyScopeEffects | undefined,
): Promise<MerchantAiSnapshot> {
  const requestHash = restoreRequestHash(input)
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.propertyId}`}, 0))`,
  )

  const replay = await readIdempotentEvidence(tx, input)
  if (replay) {
    if (replay.request_hash !== requestHash) {
      throw new MerchantAiAuthorizationStoreError(
        'idempotency_conflict',
        'Idempotency key was already used for a different command',
      )
    }
    return mapSnapshot(replay)
  }

  const propertyResult = await tx.execute(sql`
    SELECT source_epoch
    FROM properties
    WHERE organization_id = ${input.organizationId}
      AND id = ${input.propertyId}::uuid
      AND deleted_at IS NULL
    FOR UPDATE
  `)
  const property = propertyResult.rows[0] as SnapshotRow | undefined
  if (
    !property ||
    !Number.isSafeInteger(Number(property.source_epoch)) ||
    // 0-based source epoch (drizzle/0060): a never-edited property sits at
    // 0 and is still live. The liveness signal here is the row existing
    // with deleted_at IS NULL, not the epoch being non-zero.
    Number(property.source_epoch) < 0
  ) {
    throw new MerchantAiAuthorizationStoreError(
      'restore_reset_denied',
      'Restored Merchant AI state requires a live property',
    )
  }

  const current = await lockMerchantAiHead(tx, input)
  if (input.expectedStateVersion !== (current?.stateVersion ?? 0)) {
    throw new MerchantAiAuthorizationStoreError(
      'version_conflict',
      'Merchant AI state changed before restore reset',
    )
  }

  return writeTransition(
    tx,
    {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      authorizationLineageId: idGen(),
      expectedStateVersion: input.expectedStateVersion,
      stateVersion: 1,
      transitionKind: 'restore_reset',
      state: 'disabled',
      capabilities: [],
      runtimeProfiles: Object.freeze({}),
      capabilityEpochs: Object.freeze({
        review_analysis: 1,
        reply_drafting: 1,
        property_trends: 1,
      }),
      authorizedSourceEpoch: Number(property.source_epoch),
      analysisStartSequence: 0,
      policy: input,
      actorUserId: 'restore-controller',
      reasonCode: input.reasonCode,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      now: input.now,
      ceremonyId: null,
    },
    current,
    replyEffects,
  )
}
