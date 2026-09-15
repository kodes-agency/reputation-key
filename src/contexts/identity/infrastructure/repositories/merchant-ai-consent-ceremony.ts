import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import { toDomainRole } from '#/shared/domain/roles'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { planMerchantAiConsentTransition } from '../../domain/merchant-ai-authorization'
import {
  MerchantAiAuthorizationStoreError,
  type MerchantAiConsentCeremonyInput,
  type MerchantAiPropertyConsentResult,
} from '../../application/use-cases/merchant-ai-authorization'
import {
  commitMerchantAiTransition,
  lockMerchantAiHead,
  lockProviderSource,
  lockTransitionProperty,
  mapSnapshot,
  requireManagementAuthority,
  runtimeProfilesFor,
  type SnapshotRow,
} from './merchant-ai-transition'

// One consent ceremony over several Properties (decision 3). Each Property
// runs the single-Property steps and fences; the whole ceremony is one
// transaction, so its enablement rows, evidence rows and outbox facts commit
// together or not at all. Every evidence row it writes shares the ceremony id
// and the ceremony's request hash.

function ceremonyRequestHash(input: MerchantAiConsentCeremonyInput): string {
  const canonicalRequest = canonicalizeRfc8785({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    // The set of Properties, not the order they were listed in.
    propertyIds: [...input.propertyIds].sort(),
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
    .update('merchant-ai-consent-ceremony-v1\0', 'utf8')
    .update(canonicalRequest, 'utf8')
    .digest('hex')
}

/**
 * Evidence idempotency keys are unique per Organization, so each Property's row
 * gets `<prefix><propertyId>`. The prefix is derived from the ceremony's key
 * alone: every row of any ceremony that used this key shares it, which is how
 * a reused key is found even when the Property set differs.
 */
function ceremonyKeyPrefix(idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update('merchant-ai-consent-ceremony-key-v1\0', 'utf8')
    .update(idempotencyKey, 'utf8')
    .digest('hex')
  return `ceremony-${digest.slice(0, 32)}:`
}

type CeremonyFacts = Readonly<{
  keyPrefix: string
  requestHash: string
}>

/** Serializes attempts of the same ceremony so a retry sees the first commit. */
async function lockCeremonyKey(
  tx: Tx,
  input: MerchantAiConsentCeremonyInput,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`merchant-ai-consent-ceremony-v1:${input.organizationId}:${input.idempotencyKey}`}, 0)
    )
  `)
}

async function readCurrentHead(
  tx: Tx,
  input: MerchantAiConsentCeremonyInput,
  propertyId: string,
): Promise<MerchantAiPropertyConsentResult['snapshot']> {
  const result = await tx.execute(sql`
    SELECT *
    FROM merchant_ai_enablement
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${propertyId}::uuid
    LIMIT 1
  `)
  const row = result.rows[0] as SnapshotRow | undefined
  if (!row) {
    throw new MerchantAiAuthorizationStoreError(
      'property_inactive',
      'Property source is unavailable',
      propertyId,
    )
  }
  return mapSnapshot(row)
}

/**
 * The committed result of an earlier attempt, or null when this key has not
 * written anything. A Property the ceremony left unchanged wrote no row, so
 * its replayed result is its current grant. A ceremony that changed nothing
 * wrote no rows at all; running it again is then equally a no-op unless the
 * grants moved in between.
 */
async function replayCeremony(
  tx: Tx,
  input: MerchantAiConsentCeremonyInput,
  facts: CeremonyFacts,
): Promise<ReadonlyArray<MerchantAiPropertyConsentResult> | null> {
  const replayResult = await tx.execute(sql`
    SELECT *
    FROM merchant_ai_consent_evidence
    WHERE organization_id = ${input.organizationId}
      AND starts_with(idempotency_key, ${facts.keyPrefix})
  `)
  const rows = replayResult.rows as SnapshotRow[]
  if (rows.length === 0) return null
  if (rows.some((row) => row.request_hash !== facts.requestHash)) {
    throw new MerchantAiAuthorizationStoreError(
      'idempotency_conflict',
      'Idempotency key was already used for a different command',
    )
  }
  const rowsByProperty = new Map(rows.map((row) => [String(row.property_id), row]))
  const results: MerchantAiPropertyConsentResult[] = []
  for (const propertyId of input.propertyIds) {
    const row = rowsByProperty.get(propertyId)
    results.push(
      row
        ? {
            propertyId,
            outcome: row.transition_kind === 'enable' ? 'enabled' : 'changed',
            snapshot: mapSnapshot(row),
          }
        : {
            propertyId,
            outcome: 'unchanged',
            snapshot: await readCurrentHead(tx, input, propertyId),
          },
    )
  }
  return results
}

async function requireCurrentAccountAdmin(
  tx: Tx,
  input: MerchantAiConsentCeremonyInput,
): Promise<void> {
  const membershipResult = await tx.execute(sql`
    SELECT role
    FROM member
    WHERE "organizationId" = ${input.organizationId}
      AND "userId" = ${input.actorUserId}
    FOR SHARE
  `)
  const membership = membershipResult.rows[0] as SnapshotRow | undefined
  if (!membership || toDomainRole(String(membership.role)) !== 'AccountAdmin') {
    throw new MerchantAiAuthorizationStoreError(
      'membership_denied',
      'Consent for several properties at once requires a current account admin',
    )
  }
}

async function consentForProperty(
  tx: Tx,
  input: MerchantAiConsentCeremonyInput,
  propertyId: string,
  facts: CeremonyFacts,
  idGen: () => string,
): Promise<MerchantAiPropertyConsentResult> {
  const target = {
    organizationId: input.organizationId,
    propertyId,
    actorUserId: input.actorUserId,
    now: input.now,
  }
  // A ceremony never revokes, and the lock steps only distinguish a revoke, so
  // it fences as an enable before the locked head decides enable or change.
  const discoveredSourceEpoch = await lockProviderSource(tx, target, 'enable')
  const lockedPropertySourceEpoch = await lockTransitionProperty(
    tx,
    target,
    'enable',
    discoveredSourceEpoch,
  )
  await requireManagementAuthority(tx, target)
  const current = await lockMerchantAiHead(tx, target)

  const runtimeProfiles = runtimeProfilesFor(input.capabilities)
  const plan = planMerchantAiConsentTransition(current, {
    ...input,
    capabilityRuntimeProfileVersions: runtimeProfiles,
    authorizedSourceEpoch: lockedPropertySourceEpoch,
  })
  if (plan.kind === 'unchanged') {
    return { propertyId, outcome: 'unchanged', snapshot: plan.current }
  }

  const snapshot = await commitMerchantAiTransition(
    tx,
    {
      organizationId: input.organizationId,
      propertyId,
      actorUserId: input.actorUserId,
      idempotencyKey: `${facts.keyPrefix}${propertyId}`,
      expectedStateVersion: current?.stateVersion ?? 0,
      operation: plan.kind,
      state: 'enabled',
      capabilities: input.capabilities,
      reasonCode: input.reasonCode,
      noticeVersion: input.noticeVersion,
      noticeDigest: input.noticeDigest,
      sourcePolicyId: input.sourcePolicyId,
      routingPolicyVersion: input.routingPolicyVersion,
      providerDeploymentProfileVersion: input.providerDeploymentProfileVersion,
      redactionProfileFamily: input.redactionProfileFamily,
      now: input.now,
      ceremonyId: input.ceremonyId,
    },
    {
      current,
      runtimeProfiles,
      authorizedSourceEpoch: lockedPropertySourceEpoch,
      requestHash: facts.requestHash,
    },
    idGen,
  )
  return {
    propertyId,
    outcome: plan.kind === 'enable' ? 'enabled' : 'changed',
    snapshot,
  }
}

/** Names the Property a refusal came from; the whole ceremony still rolls back. */
function attributeRefusal(error: unknown, propertyId: string): unknown {
  return error instanceof MerchantAiAuthorizationStoreError &&
    error.propertyId === undefined
    ? new MerchantAiAuthorizationStoreError(error.code, error.message, propertyId)
    : error
}

export function runMerchantAiConsentCeremony(
  db: Database,
  input: MerchantAiConsentCeremonyInput,
  idGen: () => string,
): Promise<ReadonlyArray<MerchantAiPropertyConsentResult>> {
  const facts: CeremonyFacts = {
    keyPrefix: ceremonyKeyPrefix(input.idempotencyKey),
    requestHash: ceremonyRequestHash(input),
  }
  return db.transaction(async (tx) => {
    await lockCeremonyKey(tx, input)
    // Like a single-Property replay, this answers before the authority
    // re-checks below; the use case has already authorized the current actor.
    const replay = await replayCeremony(tx, input, facts)
    if (replay) return replay

    await requireCurrentAccountAdmin(tx, input)
    const results = new Map<string, MerchantAiPropertyConsentResult>()
    // One lock order for every ceremony, whatever order the caller listed.
    for (const propertyId of [...input.propertyIds].sort()) {
      try {
        results.set(
          propertyId,
          await consentForProperty(tx, input, propertyId, facts, idGen),
        )
      } catch (error) {
        throw attributeRefusal(error, propertyId)
      }
    }
    return input.propertyIds.flatMap((propertyId) => {
      const result = results.get(propertyId)
      return result ? [result] : []
    })
  })
}
