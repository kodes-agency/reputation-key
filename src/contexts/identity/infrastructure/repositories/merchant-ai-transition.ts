import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { resolveAiRuntimeCapabilitySet } from '#/shared/ai-runtime-capability-contract'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type CapabilityRuntimeProfileVersions,
  type MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { createAiAdvisoryScope } from '#/shared/ai-lock-order-v1'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { organizationId } from '#/shared/domain/ids'
import { deleteAiDraftsForAuthorization } from '#/shared/db/ai/ai-draft-purge'
import { identityMerchantAiChanged } from '../../domain/events'
import {
  isMerchantAiExecutionContractCurrent,
  isMerchantAiGrantCurrent,
  type MerchantAiCapabilityEpochs,
  type MerchantAiSnapshot,
  type MerchantAiState,
} from '../../domain/merchant-ai-authorization'
import { decideMemberPropertyAuthority } from './member-property-authority'
import { deleteMerchantAiDecisionDeferral } from './merchant-ai-decision.repository'
import {
  MerchantAiAuthorizationStoreError,
  type MerchantAiMutationInput,
} from '../../application/use-cases/merchant-ai-authorization'

// The steps of one Merchant AI transition, in lock order. A single-property
// command runs them all in its own transaction; they are separate so a later
// command can run them for several Properties inside one transaction without
// a second copy of the fences.

export type SnapshotRow = Record<string, unknown>

export type MerchantAiTransitionTarget = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
  now: Date
}>

type MerchantAiOperation = MerchantAiMutationInput['operation']

function failInvalidRecord(message: string): never {
  throw new MerchantAiAuthorizationStoreError('invalid_record', message)
}

export function readInteger(row: SnapshotRow, column: string, minimum: number): number {
  const value = Number(row[column])
  if (!Number.isSafeInteger(value) || value < minimum) {
    failInvalidRecord(`Invalid Merchant AI ${column} row`)
  }
  return value
}

function readSafeBigint(row: SnapshotRow, column: string, minimum: number): number {
  const raw = row[column]
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < minimum) {
      failInvalidRecord(`Invalid Merchant AI ${column} row`)
    }
    return raw
  }
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw)) {
    failInvalidRecord(`Invalid Merchant AI ${column} row`)
  }
  let value: bigint
  try {
    value = BigInt(raw)
  } catch {
    failInvalidRecord(`Invalid Merchant AI ${column} row`)
  }
  if (value < BigInt(minimum) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    failInvalidRecord(`Invalid Merchant AI ${column} row`)
  }
  return Number(value)
}

function readNonEmptyString(row: SnapshotRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string' || value.length === 0) {
    failInvalidRecord(`Invalid Merchant AI ${column} row`)
  }
  return value
}

function normalizeCapabilities(value: unknown): ReadonlyArray<MerchantAiCapability> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    failInvalidRecord('Invalid capabilities row')
  }
  const values = new Set(value)
  const normalized = CURRENT_MERCHANT_AI_CAPABILITIES.filter((capability) =>
    values.has(capability),
  )
  if (normalized.length !== value.length) {
    failInvalidRecord('Invalid capabilities row')
  }
  if (values.has('property_trends') && !values.has('review_analysis')) {
    failInvalidRecord('Invalid capability dependency row')
  }
  return normalized
}

function readRuntimeProfiles(
  row: SnapshotRow,
  capabilities: ReadonlyArray<MerchantAiCapability>,
): CapabilityRuntimeProfileVersions {
  const actual = row.capability_runtime_profile_versions
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    failInvalidRecord('Invalid capability runtime profile row')
  }
  const expected = runtimeProfilesFor(capabilities)
  if (canonicalizeRfc8785(actual) !== canonicalizeRfc8785(expected)) {
    failInvalidRecord('Invalid capability runtime profile row')
  }
  return expected
}

/** A revoke carries no capabilities; the resolver refuses an empty set. */
export function runtimeProfilesFor(
  capabilities: ReadonlyArray<MerchantAiCapability>,
): CapabilityRuntimeProfileVersions {
  return capabilities.length > 0
    ? resolveAiRuntimeCapabilitySet(capabilities)
    : Object.freeze({})
}

export function mapSnapshot(row: SnapshotRow): MerchantAiSnapshot {
  const state = row.state
  if (state !== 'disabled' && state !== 'enabled' && state !== 'revoked') {
    failInvalidRecord('Invalid Merchant AI state row')
  }
  if (row.provider_deployment_profile_version !== 'private-beta-global-v1') {
    failInvalidRecord('Invalid Merchant AI deployment profile row')
  }
  if (row.processing_region !== 'global') {
    failInvalidRecord('Invalid processing region row')
  }

  const capabilities = normalizeCapabilities(row.capabilities)
  const capabilityRuntimeProfileVersions = readRuntimeProfiles(row, capabilities)
  const capabilityEpochs = Object.freeze({
    review_analysis: readInteger(row, 'review_analysis_epoch', 1),
    reply_drafting: readInteger(row, 'reply_drafting_epoch', 1),
    property_trends: readInteger(row, 'property_trends_epoch', 1),
  }) satisfies MerchantAiCapabilityEpochs

  return Object.freeze({
    organizationId: readNonEmptyString(row, 'organization_id'),
    propertyId: readNonEmptyString(row, 'property_id'),
    authorizationLineageId: readNonEmptyString(row, 'authorization_lineage_id'),
    state,
    capabilities,
    capabilityRuntimeProfileVersions,
    capabilityEpochs,
    // 0-based, unlike the capability epochs and state version below.
    authorizedSourceEpoch: readInteger(row, 'authorized_source_epoch', 0),
    analysisStartSequence: readSafeBigint(row, 'analysis_start_sequence', 0),
    stateVersion: readInteger(row, 'state_version', 1),
    noticeVersion: readNonEmptyString(row, 'notice_version'),
    noticeDigest: readNonEmptyString(row, 'notice_digest'),
    sourcePolicyId: readNonEmptyString(row, 'source_policy_id'),
    routingPolicyVersion: readInteger(row, 'routing_policy_version', 1),
    processingRegion: 'global',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    redactionProfileFamily: readNonEmptyString(row, 'redaction_profile_family'),
  })
}

function canonicalRequestHash(input: MerchantAiMutationInput): string {
  const canonicalRequest = canonicalizeRfc8785({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    expectedStateVersion: input.expectedStateVersion,
    state: input.state,
    capabilities: input.capabilities,
    reasonCode: input.reasonCode,
    noticeVersion: input.noticeVersion,
    noticeDigest: input.noticeDigest,
    processingRegion: 'global',
    sourcePolicyId: input.sourcePolicyId,
    routingPolicyVersion: input.routingPolicyVersion,
    providerDeploymentProfileVersion: input.providerDeploymentProfileVersion,
    redactionProfileFamily: input.redactionProfileFamily,
  })
  return createHash('sha256')
    .update('merchant-ai-command-v1\0', 'utf8')
    .update(canonicalRequest, 'utf8')
    .digest('hex')
}

function nextCapabilityEpochs(
  current: MerchantAiSnapshot | null,
  input: MerchantAiMutationInput,
  runtimeProfiles: CapabilityRuntimeProfileVersions,
  sourceRebound: boolean,
  contractChanged: boolean,
): MerchantAiCapabilityEpochs {
  if (!current) {
    return Object.freeze({
      review_analysis: 1,
      reply_drafting: 1,
      property_trends: 1,
    })
  }

  const previous = new Set(current.capabilities)
  const next = new Set(input.capabilities)
  const incrementAll = input.operation === 'enable' || input.operation === 'revoke'
  const epochFor = (capability: MerchantAiCapability): number => {
    const membershipChanged = previous.has(capability) !== next.has(capability)
    const capabilityMappingChanged =
      contractChanged ||
      current.capabilityRuntimeProfileVersions[capability] !== runtimeProfiles[capability]
    const enabledAcrossMappingChange =
      capabilityMappingChanged && (previous.has(capability) || next.has(capability))
    const enabledAcrossSourceRebind =
      sourceRebound && (previous.has(capability) || next.has(capability))
    return (
      current.capabilityEpochs[capability] +
      (incrementAll ||
      membershipChanged ||
      enabledAcrossMappingChange ||
      enabledAcrossSourceRebind
        ? 1
        : 0)
    )
  }

  return Object.freeze({
    review_analysis: epochFor('review_analysis'),
    reply_drafting: epochFor('reply_drafting'),
    property_trends: epochFor('property_trends'),
  })
}

/**
 * Fence the Property source the transition authorizes and take its
 * provider-source advisory lock. A revoke fences the epoch it authorized; any
 * other transition fences the Property's current epoch.
 */
export async function lockProviderSource(
  tx: Tx,
  target: MerchantAiTransitionTarget,
  operation: MerchantAiOperation,
): Promise<number> {
  const sourceDiscoveryResult = await tx.execute(sql`
    SELECT
      property.source_epoch,
      enablement.authorized_source_epoch
    FROM properties AS property
    LEFT JOIN merchant_ai_enablement AS enablement
      ON enablement.organization_id = property.organization_id
      AND enablement.property_id = property.id
    WHERE property.organization_id = ${target.organizationId}
      AND property.id = ${target.propertyId}::uuid
    LIMIT 1
  `)
  const sourceDiscovery = sourceDiscoveryResult.rows[0] as SnapshotRow | undefined
  if (!sourceDiscovery) {
    throw new MerchantAiAuthorizationStoreError(
      'property_inactive',
      'Property source is unavailable',
    )
  }
  // Source epoch is 0-based (drizzle/0060): a property that has never been
  // edited sits at 0, and enabling AI on it must not read as a corrupt row.
  const propertySourceEpoch = readInteger(sourceDiscovery, 'source_epoch', 0)
  const discoveredSourceEpoch =
    operation === 'revoke' &&
    sourceDiscovery.authorized_source_epoch !== null &&
    sourceDiscovery.authorized_source_epoch !== undefined
      ? readInteger(sourceDiscovery, 'authorized_source_epoch', 0)
      : propertySourceEpoch
  const providerSourceScope = createAiAdvisoryScope('provider-source', [
    target.organizationId,
    target.propertyId,
    discoveredSourceEpoch,
  ])
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(ai_advisory_lock_key_v1(${providerSourceScope}))
  `)
  return discoveredSourceEpoch
}

export async function readIdempotentEvidence(
  tx: Tx,
  input: Readonly<{ organizationId: string; idempotencyKey: string }>,
): Promise<SnapshotRow | undefined> {
  const replayResult = await tx.execute(sql`
    SELECT *
    FROM merchant_ai_consent_evidence
    WHERE organization_id = ${input.organizationId}
      AND idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `)
  return replayResult.rows[0] as SnapshotRow | undefined
}

/**
 * Lock the Property row and re-check it under the lock. Returns the locked
 * source epoch.
 */
export async function lockTransitionProperty(
  tx: Tx,
  target: MerchantAiTransitionTarget,
  operation: MerchantAiOperation,
  discoveredSourceEpoch: number,
): Promise<number> {
  const propertyResult = await tx.execute(sql`
    SELECT lifecycle_state, deleted_at, google_binding_state, source_epoch
    FROM properties
    WHERE organization_id = ${target.organizationId}
      AND id = ${target.propertyId}::uuid
    FOR UPDATE
  `)
  const property = propertyResult.rows[0] as SnapshotRow | undefined
  if (
    !property ||
    property.deleted_at !== null ||
    (operation !== 'revoke' &&
      (property.lifecycle_state !== 'active' ||
        property.google_binding_state !== 'active'))
  ) {
    throw new MerchantAiAuthorizationStoreError(
      'property_inactive',
      operation === 'revoke'
        ? 'Property must exist'
        : 'Property and Google source must be active',
    )
  }
  const lockedPropertySourceEpoch = readInteger(property, 'source_epoch', 0)
  if (operation !== 'revoke' && lockedPropertySourceEpoch !== discoveredSourceEpoch) {
    throw new MerchantAiAuthorizationStoreError(
      'property_inactive',
      'Property source changed during Merchant AI authorization',
    )
  }
  return lockedPropertySourceEpoch
}

/**
 * Re-check the actor's current membership and AI management authority for the
 * Property while holding the membership row. Returns the membership role.
 */
export async function requireManagementAuthority(
  tx: Tx,
  target: MerchantAiTransitionTarget,
): Promise<string> {
  const membershipResult = await tx.execute(sql`
    SELECT role
    FROM member
    WHERE "organizationId" = ${target.organizationId}
      AND "userId" = ${target.actorUserId}
    FOR SHARE
  `)
  const membership = membershipResult.rows[0] as SnapshotRow | undefined
  if (!membership) {
    throw new MerchantAiAuthorizationStoreError(
      'membership_denied',
      'Current organization membership is required',
    )
  }
  const memberRole = String(membership.role)
  const authority = await decideMemberPropertyAuthority(tx, {
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    userId: target.actorUserId,
    memberRole,
    permission: 'ai.manage',
    at: target.now,
  })
  if (!authority.allowed) {
    throw new MerchantAiAuthorizationStoreError(
      authority.reason,
      authority.reason === 'assignment_denied'
        ? 'Current Property authority is required'
        : 'Current AI management authority is required',
    )
  }
  return memberRole
}

export async function lockMerchantAiHead(
  tx: Tx,
  target: Pick<MerchantAiTransitionTarget, 'organizationId' | 'propertyId'>,
): Promise<MerchantAiSnapshot | null> {
  const currentResult = await tx.execute(sql`
    SELECT *
    FROM merchant_ai_enablement
    WHERE organization_id = ${target.organizationId}
      AND property_id = ${target.propertyId}::uuid
    FOR UPDATE
  `)
  const currentRow = currentResult.rows[0] as SnapshotRow | undefined
  return currentRow ? mapSnapshot(currentRow) : null
}

/**
 * Write one validated transition: the Review analysis frontier, the evidence
 * row and head (through `apply_merchant_ai_transition_v1`), the draft purge,
 * and the identifier-only outbox fact. The caller has already locked the
 * Property, the membership row, and the head in that order.
 */
export async function commitMerchantAiTransition(
  tx: Tx,
  input: MerchantAiMutationInput,
  facts: Readonly<{
    current: MerchantAiSnapshot | null
    runtimeProfiles: CapabilityRuntimeProfileVersions
    authorizedSourceEpoch: number
    requestHash: string
  }>,
  idGen: () => string,
): Promise<MerchantAiSnapshot> {
  const { current, runtimeProfiles, authorizedSourceEpoch, requestHash } = facts
  const sourceRebound =
    current !== null && current.authorizedSourceEpoch !== authorizedSourceEpoch
  const contractChanged =
    current !== null && !isMerchantAiExecutionContractCurrent(current, input)

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

  const authorizationLineageId = current?.authorizationLineageId ?? idGen()
  const stateVersion = (current?.stateVersion ?? 0) + 1
  const capabilityEpochs = nextCapabilityEpochs(
    current,
    input,
    runtimeProfiles,
    sourceRebound,
    contractChanged,
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
  const runtimeProfilesJson = canonicalizeRfc8785(runtimeProfiles)
  const capabilityArray =
    input.capabilities.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(
          input.capabilities.map((capability) => sql`${capability}`),
          sql`, `,
        )}]::text[]`

  const evidenceResult = await tx.execute(sql`
    SELECT (
      apply_merchant_ai_transition_v1(
        ${authorizationLineageId}::uuid,
        ${input.expectedStateVersion},
        ${stateVersion},
        ${input.organizationId},
        ${input.propertyId}::uuid,
        ${input.operation},
        ${input.state},
        ${capabilityArray},
        ${runtimeProfilesJson}::jsonb,
        ${capabilityEpochs.review_analysis},
        ${capabilityEpochs.reply_drafting},
        ${capabilityEpochs.property_trends},
        ${authorizedSourceEpoch},
        ${analysisStartSequence},
        ${input.noticeVersion},
        ${input.noticeDigest},
        ${input.sourcePolicyId},
        ${input.routingPolicyVersion},
        'global',
        ${input.providerDeploymentProfileVersion},
        ${input.redactionProfileFamily},
        ${input.actorUserId},
        ${input.reasonCode},
        ${input.idempotencyKey},
        ${requestHash},
        ${input.now}
      )
    ).*
  `)
  const evidence = evidenceResult.rows[0] as SnapshotRow

  await deleteAiDraftsForAuthorization(tx, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
  })
  if (input.state === 'enabled') {
    // The decision is made: a standing "not now" ends with the enable that
    // supersedes it, in the same transaction (a change starts from an enabled
    // head, so this deletes nothing there).
    await deleteMerchantAiDecisionDeferral(tx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    })
  }
  const snapshot = mapSnapshot(evidence)
  const event = identityMerchantAiChanged({
    organizationId: organizationId(input.organizationId),
    propertyId: input.propertyId,
    authorizationLineageId,
    state: input.state,
    reviewAnalysisEpoch: capabilityEpochs.review_analysis,
    replyDraftingEpoch: capabilityEpochs.reply_drafting,
    propertyTrendsEpoch: capabilityEpochs.property_trends,
    authorizedSourceEpoch,
    analysisStartSequence,
    stateVersion,
    occurredAt: input.now,
  })
  await insertOutboxRow(tx, event)
  return snapshot
}

function allowsTransition(
  operation: MerchantAiOperation,
  currentState: MerchantAiState | undefined,
): boolean {
  return (
    (operation === 'enable' &&
      (currentState === undefined ||
        currentState === 'disabled' ||
        currentState === 'revoked')) ||
    (operation === 'change' && currentState === 'enabled') ||
    (operation === 'revoke' && currentState === 'enabled')
  )
}

/** One single-property enable, change, or revoke inside the caller's transaction. */
export async function runMerchantAiMutation(
  tx: Tx,
  input: MerchantAiMutationInput,
  idGen: () => string,
): Promise<MerchantAiSnapshot> {
  const requestHash = canonicalRequestHash(input)
  const discoveredSourceEpoch = await lockProviderSource(tx, input, input.operation)

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

  const lockedPropertySourceEpoch = await lockTransitionProperty(
    tx,
    input,
    input.operation,
    discoveredSourceEpoch,
  )
  await requireManagementAuthority(tx, input)

  const current = await lockMerchantAiHead(tx, input)
  if (!allowsTransition(input.operation, current?.state)) {
    throw new MerchantAiAuthorizationStoreError(
      'invalid_transition',
      `Merchant AI state does not allow ${input.operation}`,
    )
  }
  if (input.expectedStateVersion !== (current?.stateVersion ?? 0)) {
    throw new MerchantAiAuthorizationStoreError(
      'version_conflict',
      'Merchant AI state changed; reload before retrying',
    )
  }
  const expectedState: MerchantAiState =
    input.operation === 'revoke' ? 'revoked' : 'enabled'
  if (input.state !== expectedState) {
    throw new MerchantAiAuthorizationStoreError(
      'invalid_transition',
      'Merchant AI command state does not match its operation',
    )
  }

  const runtimeProfiles = runtimeProfilesFor(input.capabilities)
  const authorizedSourceEpoch =
    input.operation === 'revoke' && current
      ? current.authorizedSourceEpoch
      : lockedPropertySourceEpoch
  if (authorizedSourceEpoch !== discoveredSourceEpoch) {
    throw new MerchantAiAuthorizationStoreError(
      'property_inactive',
      'Property source changed during Merchant AI authorization',
    )
  }
  if (
    input.operation === 'change' &&
    current !== null &&
    isMerchantAiGrantCurrent(current, {
      ...input,
      capabilityRuntimeProfileVersions: runtimeProfiles,
      authorizedSourceEpoch,
    })
  ) {
    throw new MerchantAiAuthorizationStoreError(
      'no_op',
      'Merchant AI settings did not change',
    )
  }

  return commitMerchantAiTransition(
    tx,
    input,
    { current, runtimeProfiles, authorizedSourceEpoch, requestHash },
    idGen,
  )
}
