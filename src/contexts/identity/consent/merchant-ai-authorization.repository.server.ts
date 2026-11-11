import { sql } from 'drizzle-orm'
import {
  getAiRuntimeCapability,
  isExecutionCompatibleWithConsent,
} from '#/shared/ai-runtime-capability-contract'
import type { MerchantAiConsentFence } from '#/shared/auth/execution-policy'
import type {
  MerchantAiCapability,
  MerchantAiPurpose,
} from '#/shared/domain/merchant-ai-capability'
import type { Database } from '#/shared/db/index'
import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'
import type { MerchantAiSnapshot } from '../domain/merchant-ai-authorization'
import type { MerchantAiAuthorizationStore } from './merchant-ai-authorization.server'
import { mapSnapshot, type SnapshotRow } from './merchant-ai-snapshot.server'
import { transitionMerchantAi } from './merchant-ai-transition.server'
import { resetMerchantAiForRestore } from './merchant-ai-transition-commit.server'
import { runMerchantAiConsentCeremony } from './merchant-ai-consent-ceremony.server'

export type MerchantAiAuthorizationFence = MerchantAiConsentFence

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
  if (!capability || capability === 'property_trends') return false
  const epochColumn = sql.identifier(EPOCH_COLUMN_BY_CAPABILITY[capability])
  const served = getAiRuntimeCapability(capability)
  const fence = input.expectedFence
  const result = await db.execute(sql`
    SELECT enablement.notice_version, enablement.notice_digest
    FROM merchant_ai_enablement AS enablement
    INNER JOIN properties AS property
      ON property.id = enablement.property_id
      AND property.organization_id = enablement.organization_id
    WHERE enablement.organization_id = ${input.organizationId}
      AND enablement.property_id = ${input.propertyId}::uuid
      AND enablement.state = 'enabled'
      AND ${capability} = ANY(enablement.capabilities)
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
          AND enablement.capability_runtime_profile_versions->>${capability} = ${fence?.recordedRuntimeProfileVersion ?? null}
        )
      )
    LIMIT 1
  `)
  const row = result.rows[0]
  return (
    row !== undefined &&
    isExecutionCompatibleWithConsent({
      capability,
      acknowledgedNotice: {
        noticeVersion: String(row.notice_version),
        noticeDigest: String(row.notice_digest),
      },
      servedExecution: fence?.servedExecution ?? served,
    })
  )
}

export const createMerchantAiAuthorizationStore = (
  db: Database,
  idGen: () => string,
  replyEffects?: ReplyScopeEffects,
): MerchantAiAuthorizationStore => {
  return {
    getSnapshot: (input) => getMerchantAiAuthorizationSnapshot(db, input),

    mutate: (input) =>
      db.transaction(
        async (tx) =>
          (
            await transitionMerchantAi(
              tx,
              { kind: 'command', command: input },
              idGen,
              replyEffects,
            )
          ).snapshot,
      ),

    enableForProperties: (input) =>
      runMerchantAiConsentCeremony(db, input, idGen, replyEffects),

    restoreReset: (input) =>
      db.transaction((tx) => resetMerchantAiForRestore(tx, input, idGen, replyEffects)),
  }
}
