import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  RECORDED_RUNTIME_PROFILE_VERSIONS,
  type CapabilityRuntimeProfileVersions,
  type MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'
import type {
  MerchantAiCapabilityEpochs,
  MerchantAiSnapshot,
} from '../domain/merchant-ai-authorization'
import { MerchantAiAuthorizationStoreError } from './merchant-ai-authorization.server'

// Reads a stored Merchant AI head or evidence row. Anything the database could
// hold but no transition writes is refused as an invalid record.

export type SnapshotRow = Record<string, unknown>

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

export function readSafeBigint(
  row: SnapshotRow,
  column: string,
  minimum: number,
): number {
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
  // The recorded map is what the grant was made under, which may be an earlier
  // profile than the one served (RECORDED_RUNTIME_PROFILE_VERSIONS): it must name
  // exactly the grant's capabilities, each under a version some grant has held. The
  // served map is `runtimeProfilesFor`, and a grant that differs from it is the one
  // an AccountAdmin's next consent replaces.
  const recorded = actual as Readonly<Record<string, unknown>>
  const keys = Object.keys(recorded)
  if (
    keys.length !== capabilities.length ||
    capabilities.some((capability) => {
      const version = recorded[capability]
      return (
        typeof version !== 'string' ||
        !RECORDED_RUNTIME_PROFILE_VERSIONS[capability].includes(version)
      )
    })
  ) {
    failInvalidRecord('Invalid capability runtime profile row')
  }
  return Object.freeze(
    Object.fromEntries(
      capabilities.map((capability) => [capability, String(recorded[capability])]),
    ),
  ) as CapabilityRuntimeProfileVersions
}

export function mapSnapshot(row: SnapshotRow): MerchantAiSnapshot {
  const state = row.state
  if (state !== 'disabled' && state !== 'enabled' && state !== 'revoked') {
    failInvalidRecord('Invalid Merchant AI state row')
  }
  const providerDeploymentProfileVersion = row.provider_deployment_profile_version
  if (
    providerDeploymentProfileVersion !== 'private-beta-global-v1' &&
    providerDeploymentProfileVersion !== 'private-beta-global-v2' &&
    providerDeploymentProfileVersion !== 'private-beta-global-v3'
  ) {
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
    providerDeploymentProfileVersion,
    redactionProfileFamily: readNonEmptyString(row, 'redaction_profile_family'),
  })
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

export async function lockMerchantAiHead(
  tx: Tx,
  target: Readonly<{ organizationId: string; propertyId: string }>,
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
