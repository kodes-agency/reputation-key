import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { resolveAiRuntimeCapabilitySet } from '#/shared/ai-runtime-capability-contract'
import {
  RECORDED_RUNTIME_PROFILE_VERSIONS,
  type CapabilityRuntimeProfileVersions,
  type MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { createAiAdvisoryScope } from '#/shared/ai-lock-order-v1'
import type { Tx } from '#/shared/outbox/commit'
import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'
import { STANDING_RENEWAL_REASON } from '../domain/merchant-ai-standing-renewal'
import {
  isMerchantAiGrantCurrent,
  planMerchantAiConsentTransition,
  type MerchantAiSnapshot,
  type MerchantAiState,
} from '../domain/merchant-ai-authorization'
import { decideMemberPropertyAuthority } from '../infrastructure/repositories/member-property-authority'
import {
  MerchantAiAuthorizationStoreError,
  type MerchantAiMutationInput,
} from './merchant-ai-authorization.server'
import {
  lockMerchantAiHead,
  mapSnapshot,
  readIdempotentEvidence,
  readInteger,
  type SnapshotRow,
} from './merchant-ai-snapshot.server'
import { commitGrantTransition } from './merchant-ai-transition-commit.server'

// Every Merchant AI write goes through `transitionMerchantAi` inside the
// caller's transaction: a single-Property command, a standing renewal, and
// each Property of a consent ceremony. It takes the locks in one order
// (provider source, Property, membership, head), applies the source, runtime
// and lineage fences, then commits through merchant-ai-transition-commit.

type MerchantAiOperation = MerchantAiMutationInput['operation']

type MerchantAiTransitionTarget = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
  now: Date
}>

/** A ceremony's grant for one Property: the locked head decides enable, change or nothing. */
export type MerchantAiConsentGrant = Omit<
  MerchantAiMutationInput,
  'operation' | 'state' | 'expectedStateVersion'
>

export type MerchantAiTransitionRequest =
  | Readonly<{
      kind: 'command'
      command: MerchantAiMutationInput
      /** A replayed key answers `no_op` instead of the committed snapshot. */
      replayIsNoOp?: boolean
    }>
  | Readonly<{
      kind: 'consent'
      grant: MerchantAiConsentGrant
      /** The ceremony's hash, shared by every evidence row it writes. */
      requestHash: string
    }>

export type MerchantAiTransitionResult = Readonly<{
  operation: MerchantAiOperation | 'unchanged'
  snapshot: MerchantAiSnapshot
}>

/** A revoke carries no capabilities; the resolver refuses an empty set. */
export function runtimeProfilesFor(
  capabilities: ReadonlyArray<MerchantAiCapability>,
): CapabilityRuntimeProfileVersions {
  return capabilities.length > 0
    ? Object.freeze({
        ...resolveAiRuntimeCapabilitySet(
          capabilities.filter((capability) => capability !== 'property_trends'),
        ),
        ...(capabilities.includes('property_trends')
          ? { property_trends: RECORDED_RUNTIME_PROFILE_VERSIONS.property_trends[0]! }
          : {}),
      })
    : Object.freeze({})
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

/**
 * Fence the Property source the transition authorizes and take its
 * provider-source advisory lock. A revoke fences the epoch it authorized; any
 * other transition fences the Property's current epoch.
 */
async function lockProviderSource(
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

/**
 * Lock the Property row and re-check it under the lock. Returns the locked
 * source epoch.
 */
async function lockTransitionProperty(
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
async function requireManagementAuthority(
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

async function requireStandingRenewalOwner(
  tx: Tx,
  input: Pick<MerchantAiMutationInput, 'actorUserId' | 'reasonCode'>,
  role: string,
) {
  if (input.reasonCode !== STANDING_RENEWAL_REASON) return
  const liveUser = await tx.execute(
    sql`SELECT id FROM "user" WHERE id = ${input.actorUserId} FOR SHARE`,
  )
  if (role !== 'owner' || liveUser.rows.length !== 1) {
    throw new MerchantAiAuthorizationStoreError(
      'membership_denied',
      'A live account admin is required',
    )
  }
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

type Decision =
  | Readonly<{ kind: 'unchanged'; current: MerchantAiSnapshot }>
  | Readonly<{
      kind: 'write'
      input: MerchantAiMutationInput
      runtimeProfiles: CapabilityRuntimeProfileVersions
      authorizedSourceEpoch: number
    }>

/** An explicit command: its operation and expected version must fit the locked head. */
function decideCommand(
  input: MerchantAiMutationInput,
  current: MerchantAiSnapshot | null,
  lockedPropertySourceEpoch: number,
  discoveredSourceEpoch: number,
): Decision {
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
  if (
    input.reasonCode === STANDING_RENEWAL_REASON &&
    current?.authorizedSourceEpoch !== lockedPropertySourceEpoch
  ) {
    throw new MerchantAiAuthorizationStoreError(
      'property_inactive',
      'Standing renewal cannot change the source',
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
  return { kind: 'write', input, runtimeProfiles, authorizedSourceEpoch }
}

/** A ceremony's grant: enable a head that is not enabled, re-grant one that differs. */
function decideConsent(
  grant: MerchantAiConsentGrant,
  current: MerchantAiSnapshot | null,
  lockedPropertySourceEpoch: number,
): Decision {
  const runtimeProfiles = runtimeProfilesFor(grant.capabilities)
  const plan = planMerchantAiConsentTransition(current, {
    ...grant,
    capabilityRuntimeProfileVersions: runtimeProfiles,
    authorizedSourceEpoch: lockedPropertySourceEpoch,
  })
  if (plan.kind === 'unchanged') return { kind: 'unchanged', current: plan.current }
  return {
    kind: 'write',
    input: {
      ...grant,
      operation: plan.kind,
      state: 'enabled',
      expectedStateVersion: current?.stateVersion ?? 0,
    },
    runtimeProfiles,
    authorizedSourceEpoch: lockedPropertySourceEpoch,
  }
}

/**
 * The one Merchant AI transition for a Property, inside the caller's
 * transaction. A command replays by its idempotency key; a ceremony replays
 * as a whole before it reaches here.
 */
export async function transitionMerchantAi(
  tx: Tx,
  request: MerchantAiTransitionRequest,
  idGen: () => string,
  replyEffects: ReplyScopeEffects | undefined,
): Promise<MerchantAiTransitionResult> {
  const target = request.kind === 'command' ? request.command : request.grant
  // A ceremony never revokes, and the lock steps only distinguish a revoke, so
  // it fences as an enable before the locked head decides enable or change.
  const lockOperation = request.kind === 'command' ? request.command.operation : 'enable'
  const requestHash =
    request.kind === 'command'
      ? canonicalRequestHash(request.command)
      : request.requestHash
  const discoveredSourceEpoch = await lockProviderSource(tx, target, lockOperation)

  if (request.kind === 'command') {
    const replay = await readIdempotentEvidence(tx, target)
    if (replay) {
      if (replay.request_hash !== requestHash) {
        throw new MerchantAiAuthorizationStoreError(
          'idempotency_conflict',
          'Idempotency key was already used for a different command',
        )
      }
      if (request.replayIsNoOp)
        throw new MerchantAiAuthorizationStoreError('no_op', 'Already renewed')
      return { operation: request.command.operation, snapshot: mapSnapshot(replay) }
    }
  }

  const lockedPropertySourceEpoch = await lockTransitionProperty(
    tx,
    target,
    lockOperation,
    discoveredSourceEpoch,
  )
  const memberRole = await requireManagementAuthority(tx, target)
  await requireStandingRenewalOwner(tx, target, memberRole)
  const current = await lockMerchantAiHead(tx, target)

  const decision =
    request.kind === 'command'
      ? decideCommand(
          request.command,
          current,
          lockedPropertySourceEpoch,
          discoveredSourceEpoch,
        )
      : decideConsent(request.grant, current, lockedPropertySourceEpoch)
  if (decision.kind === 'unchanged') {
    return { operation: 'unchanged', snapshot: decision.current }
  }
  const snapshot = await commitGrantTransition(
    tx,
    decision.input,
    {
      current,
      runtimeProfiles: decision.runtimeProfiles,
      authorizedSourceEpoch: decision.authorizedSourceEpoch,
      requestHash,
    },
    idGen,
    replyEffects,
  )
  return { operation: decision.input.operation, snapshot }
}
