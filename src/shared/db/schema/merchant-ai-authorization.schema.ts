import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { reviewAiAnalysisHeads } from './review.schema'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

const validCapabilitySet = (state: { name: string }, capabilities: { name: string }) =>
  sql.raw(`(
    (
      "${state.name}" = 'enabled'
      AND (
        "${capabilities.name}" = ARRAY['review_analysis']::text[]
        OR "${capabilities.name}" = ARRAY['reply_drafting']::text[]
        OR "${capabilities.name}" = ARRAY['review_analysis', 'reply_drafting']::text[]
        OR "${capabilities.name}" = ARRAY['review_analysis', 'property_trends']::text[]
        OR "${capabilities.name}" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]
      )
    )
    OR ("${state.name}" IN ('disabled', 'revoked') AND "${capabilities.name}" = ARRAY[]::text[])
  )`)

const validRuntimeProfileMap = (
  capabilities: { name: string },
  runtimeProfiles: { name: string },
) =>
  sql.raw(`(
    ("${capabilities.name}" = ARRAY[]::text[] AND "${runtimeProfiles.name}" = '{}'::jsonb)
    OR ("${capabilities.name}" = ARRAY['review_analysis']::text[] AND "${runtimeProfiles.name}" = '{"review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("${capabilities.name}" = ARRAY['reply_drafting']::text[] AND "${runtimeProfiles.name}" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::jsonb)
    OR ("${capabilities.name}" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "${runtimeProfiles.name}" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("${capabilities.name}" = ARRAY['review_analysis', 'property_trends']::text[] AND "${runtimeProfiles.name}" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("${capabilities.name}" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "${runtimeProfiles.name}" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
  )`)

export const merchantAiConsentEvidence = pgTable(
  'merchant_ai_consent_evidence',
  {
    authorizationLineageId: uuid('authorization_lineage_id').notNull(),
    stateVersion: integer('state_version').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    transitionKind: text('transition_kind').notNull(),
    state: text('state').notNull(),
    capabilities: text('capabilities').array().notNull(),
    capabilityRuntimeProfileVersions: jsonb('capability_runtime_profile_versions')
      .$type<Readonly<Record<string, string>>>()
      .notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    replyDraftingEpoch: integer('reply_drafting_epoch').notNull(),
    propertyTrendsEpoch: integer('property_trends_epoch').notNull(),
    authorizedSourceEpoch: integer('authorized_source_epoch').notNull(),
    analysisStartSequence: bigint('analysis_start_sequence', {
      mode: 'number',
    }).notNull(),
    noticeVersion: varchar('notice_version', { length: 100 }).notNull(),
    noticeDigest: varchar('notice_digest', { length: 64 }).notNull(),
    sourcePolicyId: varchar('source_policy_id', { length: 150 }).notNull(),
    routingPolicyVersion: integer('routing_policy_version').notNull(),
    processingRegion: varchar('processing_region', { length: 20 }).notNull(),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    }).notNull(),
    redactionProfileFamily: varchar('redaction_profile_family', {
      length: 100,
    }).notNull(),
    actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.authorizationLineageId, t.stateVersion],
      name: 'merchant_ai_consent_evidence_pk',
    }),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'merchant_ai_consent_evidence_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.propertyId, t.authorizedSourceEpoch],
      foreignColumns: [
        reviewAiAnalysisHeads.organizationId,
        reviewAiAnalysisHeads.propertyId,
        reviewAiAnalysisHeads.sourceEpoch,
      ],
      name: 'merchant_ai_consent_evidence_review_head_fk',
    }).onDelete('restrict'),
    uniqueIndex('merchant_ai_consent_evidence_idempotency_unique').on(
      t.organizationId,
      t.idempotencyKey,
    ),
    index('merchant_ai_consent_evidence_property_version_idx').on(
      t.organizationId,
      t.propertyId,
      t.stateVersion,
    ),
    check(
      'merchant_ai_consent_evidence_transition_valid',
      sql`${t.transitionKind} IN ('enable', 'change', 'revoke', 'restore_reset', 'analysis_backfill')`,
    ),
    check(
      'merchant_ai_consent_evidence_state_valid',
      sql`${t.state} IN ('disabled', 'enabled', 'revoked')`,
    ),
    check(
      'merchant_ai_consent_evidence_versions_valid',
      sql`${t.stateVersion} >= 1 AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.replyDraftingEpoch} >= 1 AND ${t.propertyTrendsEpoch} >= 1 AND ${t.authorizedSourceEpoch} >= 0 AND ${t.analysisStartSequence} >= 0 AND ${t.routingPolicyVersion} >= 1`,
    ),
    check(
      'merchant_ai_consent_evidence_analysis_sequence_safe',
      sql`${t.analysisStartSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'merchant_ai_consent_evidence_region_valid',
      sql`${t.processingRegion} = 'global'`,
    ),
    check(
      'merchant_ai_consent_evidence_profile_valid',
      sql`${t.providerDeploymentProfileVersion} = 'private-beta-global-v1'`,
    ),
    check(
      'merchant_ai_consent_evidence_notice_digest_valid',
      sql`${t.noticeDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    // Consent evidence is append-only, so a notice re-version must not
    // invalidate consent already recorded under the previous notice. Each
    // known version is pinned to its own digest — a row may never mix a
    // version with another version's digest (migration 0062).
    check(
      'merchant_ai_consent_evidence_contract_valid',
      sql`(
          (${t.noticeVersion} = 'merchant-ai-notice-2026-08-15.v1'
            AND ${t.noticeDigest} = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR (${t.noticeVersion} = 'merchant-ai-notice-2026-08-19.v1'
            AND ${t.noticeDigest} = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
        )
        AND ${t.sourcePolicyId} = 'google-business-profile-source-policy-v1'
        AND ${t.routingPolicyVersion} = 1
        AND ${t.redactionProfileFamily} = 'gbp-review-global-v1'`,
    ),
    check(
      'merchant_ai_consent_evidence_capabilities_valid',
      validCapabilitySet(t.state, t.capabilities),
    ),
    check(
      'merchant_ai_consent_evidence_runtime_map_valid',
      validRuntimeProfileMap(t.capabilities, t.capabilityRuntimeProfileVersions),
    ),
    check(
      'merchant_ai_consent_evidence_request_hash_valid',
      sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'merchant_ai_consent_evidence_reason_valid',
      sql`${t.reasonCode} ~ '^[a-z][a-z0-9_]{2,63}$'`,
    ),
  ],
)

export const merchantAiEnablement = pgTable(
  'merchant_ai_enablement',
  {
    propertyId: uuid('property_id')
      .primaryKey()
      .references(() => properties.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    authorizationLineageId: uuid('authorization_lineage_id').notNull(),
    state: text('state').notNull(),
    capabilities: text('capabilities').array().notNull(),
    capabilityRuntimeProfileVersions: jsonb('capability_runtime_profile_versions')
      .$type<Readonly<Record<string, string>>>()
      .notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    replyDraftingEpoch: integer('reply_drafting_epoch').notNull(),
    propertyTrendsEpoch: integer('property_trends_epoch').notNull(),
    authorizedSourceEpoch: integer('authorized_source_epoch').notNull(),
    analysisStartSequence: bigint('analysis_start_sequence', {
      mode: 'number',
    }).notNull(),
    stateVersion: integer('state_version').notNull(),
    noticeVersion: varchar('notice_version', { length: 100 }).notNull(),
    noticeDigest: varchar('notice_digest', { length: 64 }).notNull(),
    sourcePolicyId: varchar('source_policy_id', { length: 150 }).notNull(),
    routingPolicyVersion: integer('routing_policy_version').notNull(),
    processingRegion: varchar('processing_region', { length: 20 }).notNull(),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    }).notNull(),
    redactionProfileFamily: varchar('redaction_profile_family', {
      length: 100,
    }).notNull(),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'merchant_ai_enablement_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.authorizationLineageId, t.stateVersion],
      foreignColumns: [
        merchantAiConsentEvidence.authorizationLineageId,
        merchantAiConsentEvidence.stateVersion,
      ],
      name: 'merchant_ai_enablement_evidence_head_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.organizationId, t.propertyId, t.authorizedSourceEpoch],
      foreignColumns: [
        reviewAiAnalysisHeads.organizationId,
        reviewAiAnalysisHeads.propertyId,
        reviewAiAnalysisHeads.sourceEpoch,
      ],
      name: 'merchant_ai_enablement_review_head_fk',
    }).onDelete('restrict'),
    check(
      'merchant_ai_enablement_state_valid',
      sql`${t.state} IN ('disabled', 'enabled', 'revoked')`,
    ),
    check(
      'merchant_ai_enablement_versions_valid',
      sql`${t.stateVersion} >= 1 AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.replyDraftingEpoch} >= 1 AND ${t.propertyTrendsEpoch} >= 1 AND ${t.authorizedSourceEpoch} >= 0 AND ${t.analysisStartSequence} >= 0 AND ${t.routingPolicyVersion} >= 1`,
    ),
    check(
      'merchant_ai_enablement_analysis_sequence_safe',
      sql`${t.analysisStartSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check('merchant_ai_enablement_region_valid', sql`${t.processingRegion} = 'global'`),
    check(
      'merchant_ai_enablement_profile_valid',
      sql`${t.providerDeploymentProfileVersion} = 'private-beta-global-v1'`,
    ),
    check(
      'merchant_ai_enablement_notice_digest_valid',
      sql`${t.noticeDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    // Same known-version set as the evidence table: the live enablement row was
    // granted under the 08-15 notice and must stay valid until the owner
    // re-consents under 08-19 (migration 0062).
    check(
      'merchant_ai_enablement_contract_valid',
      sql`(
          (${t.noticeVersion} = 'merchant-ai-notice-2026-08-15.v1'
            AND ${t.noticeDigest} = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR (${t.noticeVersion} = 'merchant-ai-notice-2026-08-19.v1'
            AND ${t.noticeDigest} = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
        )
        AND ${t.sourcePolicyId} = 'google-business-profile-source-policy-v1'
        AND ${t.routingPolicyVersion} = 1
        AND ${t.redactionProfileFamily} = 'gbp-review-global-v1'`,
    ),
    check(
      'merchant_ai_enablement_capabilities_valid',
      validCapabilitySet(t.state, t.capabilities),
    ),
    check(
      'merchant_ai_enablement_runtime_map_valid',
      validRuntimeProfileMap(t.capabilities, t.capabilityRuntimeProfileVersions),
    ),
    index('merchant_ai_enablement_org_idx').on(t.organizationId, t.updatedAt.desc()),
  ],
)

export type MerchantAiEnablementRow = typeof merchantAiEnablement.$inferSelect
export type MerchantAiConsentEvidenceRow = typeof merchantAiConsentEvidence.$inferSelect
