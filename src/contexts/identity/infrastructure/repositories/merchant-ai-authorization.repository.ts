import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import {
  AI_RUNTIME_CAPABILITIES_V1,
  resolveAiRuntimeCapabilitySet,
} from '#/shared/ai-runtime-capability-contract'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
  type MerchantAiPurpose,
} from '#/shared/domain/merchant-ai-capability'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { createAiAdvisoryScope } from '#/shared/ai-lock-order-v1'
import type { Database } from '#/shared/db'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { organizationId } from '#/shared/domain/ids'
import { deleteAiDraftsForAuthorization } from '#/shared/ai-provider-control/ai-draft-purge'
import { identityMerchantAiChanged } from '../../domain/events'
import { decideMemberPropertyAuthority } from './member-property-authority'
import type {
  MerchantAiCapabilityEpochs,
  MerchantAiSnapshot,
  MerchantAiState,
} from '../../domain/merchant-ai-authorization'
import {
  MerchantAiAuthorizationStoreError,
  type MerchantAiAuthorizationStore,
  type MerchantAiMutationInput,
} from '../../application/use-cases/merchant-ai-authorization'

type SnapshotRow = Record<string, unknown>

export type MerchantAiAuthorizationFence = Readonly<{
  authorizationLineageId: string
  capabilityEpoch: number
  authorizedSourceEpoch: number
  stateVersion: number
  noticeDigest: string
  runtimeProfileVersion: string
}>

const CAPABILITY_BY_PURPOSE = {
  'ai.analyze': 'review_analysis',
  'ai.generate_reply': 'reply_drafting',
  'ai.detect_trends': 'property_trends',
} as const satisfies Readonly<Record<MerchantAiPurpose, MerchantAiCapability>>

const EPOCH_COLUMN_BY_CAPABILITY = {
  review_analysis: 'review_analysis_epoch',
  reply_drafting: 'reply_drafting_epoch',
  property_trends: 'property_trends_epoch',
} as const satisfies Readonly<Record<MerchantAiCapability, string>>

const RUNTIME_PROFILE_BY_CAPABILITY = Object.fromEntries(
  AI_RUNTIME_CAPABILITIES_V1.map((entry) => [
    entry.capability,
    entry.runtimeProfileVersion,
  ]),
) as Readonly<Record<MerchantAiCapability, string>>

function failInvalidRecord(message: string): never {
  throw new MerchantAiAuthorizationStoreError('invalid_record', message)
}

function readInteger(row: SnapshotRow, column: string, minimum: number): number {
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
): Readonly<Partial<Record<MerchantAiCapability, string>>> {
  const actual = row.capability_runtime_profile_versions
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    failInvalidRecord('Invalid capability runtime profile row')
  }
  const expected =
    capabilities.length === 0
      ? Object.freeze({})
      : resolveAiRuntimeCapabilitySet(capabilities)
  if (canonicalizeRfc8785(actual) !== canonicalizeRfc8785(expected)) {
    failInvalidRecord('Invalid capability runtime profile row')
  }
  return expected
}

function mapSnapshot(row: SnapshotRow): MerchantAiSnapshot {
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

function sameCapabilities(
  left: ReadonlyArray<MerchantAiCapability>,
  right: ReadonlyArray<MerchantAiCapability>,
): boolean {
  return (
    left.length === right.length &&
    left.every((capability, index) => capability === right[index])
  )
}

function executionContractChanged(
  current: MerchantAiSnapshot,
  input: MerchantAiMutationInput,
): boolean {
  return (
    current.noticeVersion !== input.noticeVersion ||
    current.noticeDigest !== input.noticeDigest ||
    current.sourcePolicyId !== input.sourcePolicyId ||
    current.routingPolicyVersion !== input.routingPolicyVersion ||
    current.providerDeploymentProfileVersion !== input.providerDeploymentProfileVersion ||
    current.redactionProfileFamily !== input.redactionProfileFamily
  )
}

function nextCapabilityEpochs(
  current: MerchantAiSnapshot | null,
  input: MerchantAiMutationInput,
  runtimeProfiles: Readonly<Partial<Record<MerchantAiCapability, string>>>,
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

async function getMerchantAiAuthorizationSnapshot(
  db: Database,
  input: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<MerchantAiSnapshot | null> {
  const result = await db.execute(sql`
    SELECT *
    FROM merchant_ai_enablement
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
    LIMIT 1
  `)
  const row = result.rows[0] as SnapshotRow | undefined
  return row ? mapSnapshot(row) : null
}

export async function hasActiveMerchantAiConsent(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyId: string
    purpose: string
    expectedFence?: MerchantAiAuthorizationFence
  }>,
): Promise<boolean> {
  const capability =
    CAPABILITY_BY_PURPOSE[input.purpose as keyof typeof CAPABILITY_BY_PURPOSE]
  if (!capability) return false
  const epochColumn = sql.identifier(EPOCH_COLUMN_BY_CAPABILITY[capability])
  const runtimeProfileVersion = RUNTIME_PROFILE_BY_CAPABILITY[capability]
  const fence = input.expectedFence
  const result = await db.execute(sql`
    SELECT 1 AS one
    FROM merchant_ai_enablement AS enablement
    INNER JOIN properties AS property
      ON property.id = enablement.property_id
      AND property.organization_id = enablement.organization_id
    WHERE enablement.organization_id = ${input.organizationId}
      AND enablement.property_id = ${input.propertyId}::uuid
      AND enablement.state = 'enabled'
      AND ${capability} = ANY(enablement.capabilities)
      AND enablement.capability_runtime_profile_versions->>${capability} = ${runtimeProfileVersion}
      AND enablement.authorized_source_epoch = property.source_epoch
      AND property.lifecycle_state = 'active'
      AND property.google_binding_state = 'active'
      AND (
        ${fence?.authorizationLineageId ?? null}::uuid IS NULL
        OR (
          enablement.authorization_lineage_id = ${fence?.authorizationLineageId ?? null}::uuid
          AND enablement.${epochColumn} = ${fence?.capabilityEpoch ?? null}::integer
          AND enablement.authorized_source_epoch = ${fence?.authorizedSourceEpoch ?? null}::integer
          AND enablement.state_version = ${fence?.stateVersion ?? null}::integer
          AND enablement.notice_digest = ${fence?.noticeDigest ?? null}
          AND enablement.capability_runtime_profile_versions->>${capability} = ${fence?.runtimeProfileVersion ?? null}
        )
      )
    LIMIT 1
  `)
  return result.rows.length === 1
}

export const createMerchantAiAuthorizationStore = (
  db: Database,
  idGen: () => string,
): MerchantAiAuthorizationStore => {
  return {
    getSnapshot: (input) => getMerchantAiAuthorizationSnapshot(db, input),

    async mutate(input) {
      const requestHash = canonicalRequestHash(input)
      const capabilityArray =
        input.capabilities.length === 0
          ? sql`ARRAY[]::text[]`
          : sql`ARRAY[${sql.join(
              input.capabilities.map((capability) => sql`${capability}`),
              sql`, `,
            )}]::text[]`

      // Pre-existing finding (cyclomatic 63 over one 336-line transaction, no
      // unit coverage: the store is integration-tested); WP3.1 only removed the
      // post-commit bus emit. Splitting the transaction is WP3.3-B's job.
      // fallow-ignore-next-line complexity
      return db.transaction(async (tx) => {
        const sourceDiscoveryResult = await tx.execute(sql`
          SELECT
            property.source_epoch,
            enablement.authorized_source_epoch
          FROM properties AS property
          LEFT JOIN merchant_ai_enablement AS enablement
            ON enablement.organization_id = property.organization_id
            AND enablement.property_id = property.id
          WHERE property.organization_id = ${input.organizationId}
            AND property.id = ${input.propertyId}::uuid
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
          input.operation === 'revoke' &&
          sourceDiscovery.authorized_source_epoch !== null &&
          sourceDiscovery.authorized_source_epoch !== undefined
            ? readInteger(sourceDiscovery, 'authorized_source_epoch', 0)
            : propertySourceEpoch
        const providerSourceScope = createAiAdvisoryScope('provider-source', [
          input.organizationId,
          input.propertyId,
          discoveredSourceEpoch,
        ])
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(ai_advisory_lock_key_v1(${providerSourceScope}))
        `)

        const replayResult = await tx.execute(sql`
          SELECT *
          FROM merchant_ai_consent_evidence
          WHERE organization_id = ${input.organizationId}
            AND idempotency_key = ${input.idempotencyKey}
          LIMIT 1
        `)
        const replay = replayResult.rows[0] as SnapshotRow | undefined
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
          SELECT lifecycle_state, deleted_at, google_binding_state, source_epoch
          FROM properties
          WHERE organization_id = ${input.organizationId}
            AND id = ${input.propertyId}::uuid
          FOR UPDATE
        `)
        const property = propertyResult.rows[0] as SnapshotRow | undefined
        if (
          !property ||
          property.deleted_at !== null ||
          (input.operation !== 'revoke' &&
            (property.lifecycle_state !== 'active' ||
              property.google_binding_state !== 'active'))
        ) {
          throw new MerchantAiAuthorizationStoreError(
            'property_inactive',
            input.operation === 'revoke'
              ? 'Property must exist'
              : 'Property and Google source must be active',
          )
        }
        const lockedPropertySourceEpoch = readInteger(property, 'source_epoch', 0)
        if (
          input.operation !== 'revoke' &&
          lockedPropertySourceEpoch !== discoveredSourceEpoch
        ) {
          throw new MerchantAiAuthorizationStoreError(
            'property_inactive',
            'Property source changed during Merchant AI authorization',
          )
        }

        const membershipResult = await tx.execute(sql`
          SELECT role
          FROM member
          WHERE "organizationId" = ${input.organizationId}
            AND "userId" = ${input.actorUserId}
          FOR SHARE
        `)
        const membership = membershipResult.rows[0] as SnapshotRow | undefined
        if (!membership) {
          throw new MerchantAiAuthorizationStoreError(
            'membership_denied',
            'Current organization membership is required',
          )
        }
        const authority = await decideMemberPropertyAuthority(tx, {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          userId: input.actorUserId,
          memberRole: String(membership.role),
          permission: 'ai.manage',
          at: input.now,
        })
        if (!authority.allowed) {
          throw new MerchantAiAuthorizationStoreError(
            authority.reason,
            authority.reason === 'assignment_denied'
              ? 'Current Property authority is required'
              : 'Current AI management authority is required',
          )
        }

        const currentResult = await tx.execute(sql`
          SELECT *
          FROM merchant_ai_enablement
          WHERE organization_id = ${input.organizationId}
            AND property_id = ${input.propertyId}::uuid
          FOR UPDATE
        `)
        const currentRow = currentResult.rows[0] as SnapshotRow | undefined
        const current = currentRow ? mapSnapshot(currentRow) : null
        const currentState = current?.state
        const transitionAllowed =
          (input.operation === 'enable' &&
            (currentState === undefined ||
              currentState === 'disabled' ||
              currentState === 'revoked')) ||
          (input.operation === 'change' && currentState === 'enabled') ||
          (input.operation === 'revoke' && currentState === 'enabled')
        if (!transitionAllowed) {
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

        const runtimeProfiles = resolveAiRuntimeCapabilitySet(input.capabilities)

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
        const sourceRebound =
          current !== null && current.authorizedSourceEpoch !== authorizedSourceEpoch
        const contractChanged =
          current !== null && executionContractChanged(current, input)
        const profileChanged =
          contractChanged ||
          (current !== null &&
            canonicalizeRfc8785(current.capabilityRuntimeProfileVersions) !==
              canonicalizeRfc8785(runtimeProfiles))
        const membershipChanged =
          current === null || !sameCapabilities(current.capabilities, input.capabilities)
        if (
          input.operation === 'change' &&
          !membershipChanged &&
          !sourceRebound &&
          !profileChanged
        ) {
          throw new MerchantAiAuthorizationStoreError(
            'no_op',
            'Merchant AI settings did not change',
          )
        }

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
        const analysisWasEnabled =
          current?.capabilities.includes('review_analysis') ?? false
        const analysisWillBeEnabled = input.capabilities.includes('review_analysis')
        const resetsAnalysisWatermark =
          input.operation === 'enable' ||
          (input.operation === 'change' &&
            analysisWillBeEnabled &&
            (!analysisWasEnabled || sourceRebound))
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
      })
    },

    async restoreReset(input) {
      const requestHash = createHash('sha256')
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
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.propertyId}`}, 0))`,
        )

        const replayResult = await tx.execute(sql`
          SELECT *
          FROM merchant_ai_consent_evidence
          WHERE organization_id = ${input.organizationId}
            AND idempotency_key = ${input.idempotencyKey}
          LIMIT 1
        `)
        const replay = replayResult.rows[0] as SnapshotRow | undefined
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
        const sourceEpoch = Number(property.source_epoch)

        const currentResult = await tx.execute(sql`
          SELECT *
          FROM merchant_ai_enablement
          WHERE organization_id = ${input.organizationId}
            AND property_id = ${input.propertyId}::uuid
          FOR UPDATE
        `)
        const currentRow = currentResult.rows[0] as SnapshotRow | undefined
        const current = currentRow ? mapSnapshot(currentRow) : null
        if (input.expectedStateVersion !== (current?.stateVersion ?? 0)) {
          throw new MerchantAiAuthorizationStoreError(
            'version_conflict',
            'Merchant AI state changed before restore reset',
          )
        }

        const runtimeProfiles = Object.freeze({})

        const authorizationLineageId = idGen()
        const capabilityEpochs = Object.freeze({
          review_analysis: 1,
          reply_drafting: 1,
          property_trends: 1,
        }) satisfies MerchantAiCapabilityEpochs
        const runtimeProfilesJson = canonicalizeRfc8785(runtimeProfiles)

        const evidenceResult = await tx.execute(sql`
          SELECT (
            apply_merchant_ai_transition_v1(
              ${authorizationLineageId}::uuid,
              ${input.expectedStateVersion},
              1,
              ${input.organizationId},
              ${input.propertyId}::uuid,
              'restore_reset',
              'disabled',
              ARRAY[]::text[],
              ${runtimeProfilesJson}::jsonb,
              1,
              1,
              1,
              ${sourceEpoch},
              0,
              ${input.noticeVersion},
              ${input.noticeDigest},
              ${input.sourcePolicyId},
              ${input.routingPolicyVersion},
              'global',
              ${input.providerDeploymentProfileVersion},
              ${input.redactionProfileFamily},
              'restore-controller',
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

        const snapshot = mapSnapshot(evidence)
        const event = identityMerchantAiChanged({
          organizationId: organizationId(input.organizationId),
          propertyId: input.propertyId,
          authorizationLineageId,
          state: 'disabled',
          reviewAnalysisEpoch: capabilityEpochs.review_analysis,
          replyDraftingEpoch: capabilityEpochs.reply_drafting,
          propertyTrendsEpoch: capabilityEpochs.property_trends,
          authorizedSourceEpoch: sourceEpoch,
          analysisStartSequence: 0,
          stateVersion: 1,
          occurredAt: input.now,
        })
        await insertOutboxRow(tx, event)
        return snapshot
      })
    },
  }
}
