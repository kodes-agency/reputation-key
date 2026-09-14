import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { AI_RUNTIME_CAPABILITIES_V1 } from '#/shared/ai-runtime-capability-contract'
import type {
  MerchantAiCapability,
  MerchantAiPurpose,
} from '#/shared/domain/merchant-ai-capability'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import type { Database } from '#/shared/db'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { organizationId } from '#/shared/domain/ids'
import { deleteAiDraftsForAuthorization } from '#/shared/db/ai/ai-draft-purge'
import { identityMerchantAiChanged } from '../../domain/events'
import type {
  MerchantAiCapabilityEpochs,
  MerchantAiSnapshot,
} from '../../domain/merchant-ai-authorization'
import {
  MerchantAiAuthorizationStoreError,
  type MerchantAiAuthorizationStore,
} from '../../application/use-cases/merchant-ai-authorization'
import {
  mapSnapshot,
  runMerchantAiMutation,
  type SnapshotRow,
} from './merchant-ai-transition'
import { runMerchantAiConsentCeremony } from './merchant-ai-consent-ceremony'

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

    mutate: (input) => db.transaction((tx) => runMerchantAiMutation(tx, input, idGen)),

    enableForProperties: (input) => runMerchantAiConsentCeremony(db, input, idGen),

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
