import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1 } from '../../ai-openai-provider-profile'
import { OPENAI_MODEL_SNAPSHOT } from '../../ai-openai-request-contract'
import { AI_PROPERTY_CALENDAR_PROFILE_V1 } from '../../ai-property-calendar-profile'
import { properties } from './property.schema'
import { reviews } from './review.schema'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

function stringifyPostgresJsonb(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyPostgresJsonb(entry)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).map(
      ([key, entry]) => ({ key, entry, encodedKey: Buffer.from(key, 'utf8') }),
    )
    entries.sort(
      (left, right) =>
        left.encodedKey.length - right.encodedKey.length ||
        Buffer.compare(left.encodedKey, right.encodedKey),
    )
    return `{${entries
      .map(({ key, entry }) => `${JSON.stringify(key)}: ${stringifyPostgresJsonb(entry)}`)
      .join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) {
    throw new TypeError('AI provider deployment contract must be JSON-serializable')
  }
  return encoded
}

const openAiDeploymentContractSql = sql.raw(
  `'${stringifyPostgresJsonb(OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1).replaceAll("'", "''")}'::jsonb`,
)

const openAiModelSnapshotSql = sql.raw(`'${OPENAI_MODEL_SNAPSHOT.replaceAll("'", "''")}'`)

export const aiGovernancePolicies = pgTable(
  'ai_governance_policies',
  {
    version: varchar('version', { length: 100 }).primaryKey(),
    region: varchar('region', { length: 20 }).notNull(),
    manualPublicationRequired: boolean('manual_publication_required').notNull(),
    policyDigest: varchar('policy_digest', { length: 64 }).notNull(),
    canonicalPolicy: jsonb('canonical_policy')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    check(
      'ai_governance_policies_version_valid',
      sql`${t.version} = 'ai-private-beta-policy-v1'`,
    ),
    check('ai_governance_policies_region_valid', sql`${t.region} = 'global'`),
    check(
      'ai_governance_policies_manual_valid',
      sql`${t.manualPublicationRequired} = true`,
    ),
    check(
      'ai_governance_policies_digest_valid',
      sql`${t.policyDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'ai_governance_policies_document_valid',
      sql`jsonb_typeof(${t.canonicalPolicy}) = 'object'`,
    ),
  ],
)

export const aiProviderDeploymentProfiles = pgTable(
  'ai_provider_deployment_profiles',
  {
    profileVersion: varchar('profile_version', { length: 100 }).primaryKey(),
    region: varchar('region', { length: 20 }).notNull(),
    provider: varchar('provider', { length: 40 }).notNull(),
    modelSnapshot: varchar('model_snapshot', { length: 100 }).notNull(),
    reasoningEffort: varchar('reasoning_effort', { length: 20 }).notNull(),
    serviceTier: varchar('service_tier', { length: 20 }).notNull(),
    store: boolean('store').notNull(),
    responseApiVersion: varchar('response_api_version', { length: 40 }).notNull(),
    deploymentContract: jsonb('deployment_contract')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    profileDigest: varchar('profile_digest', { length: 64 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    check(
      'ai_provider_profiles_version_valid',
      sql`${t.profileVersion} = 'private-beta-global-v1'`,
    ),
    check('ai_provider_profiles_region_valid', sql`${t.region} = 'global'`),
    check('ai_provider_profiles_provider_valid', sql`${t.provider} = 'openai'`),
    // Derived, not pinned: the literal tracks `OPENAI_MODEL_SNAPSHOT`, the same
    // constant the request shape is built from, so a model switch cannot leave the
    // schema asserting a snapshot the code no longer sends.
    check(
      'ai_provider_profiles_model_valid',
      sql`${t.modelSnapshot} = ${openAiModelSnapshotSql}`,
    ),
    // Deployment-level effort is delegated to `ai_operation_profiles.reasoning_effort`.
    // Pinning 'xhigh' here would assert a configuration the TypeScript ladder can no
    // longer produce, so the database would contradict the code.
    check(
      'ai_provider_profiles_reasoning_valid',
      sql`${t.reasoningEffort} = 'route-profile-effort'`,
    ),
    check('ai_provider_profiles_tier_valid', sql`${t.serviceTier} = 'default'`),
    check('ai_provider_profiles_store_false', sql`${t.store} = false`),
    check(
      'ai_provider_profiles_api_valid',
      sql`${t.responseApiVersion} = 'responses-v1'`,
    ),
    check(
      'ai_provider_profiles_contract_valid',
      sql`jsonb_typeof(${t.deploymentContract}) = 'object'
        AND ${t.deploymentContract} = ${openAiDeploymentContractSql}`,
    ),
    check(
      'ai_provider_profiles_digest_valid',
      sql`${t.profileDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

export const aiRoutingPolicies = pgTable(
  'ai_routing_policies',
  {
    version: integer('version').primaryKey(),
    region: varchar('region', { length: 20 }).notNull(),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    })
      .notNull()
      .references(() => aiProviderDeploymentProfiles.profileVersion, {
        onDelete: 'restrict',
      }),
    policyDigest: varchar('policy_digest', { length: 64 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    check('ai_routing_policies_version_valid', sql`${t.version} = 1`),
    check('ai_routing_policies_region_valid', sql`${t.region} = 'global'`),
    check('ai_routing_policies_digest_valid', sql`${t.policyDigest} ~ '^[0-9a-f]{64}$'`),
  ],
)

export const aiOperationProfiles = pgTable(
  'ai_operation_profiles',
  {
    profileVersion: varchar('profile_version', { length: 100 }).primaryKey(),
    command: varchar('command', { length: 32 }).notNull(),
    capability: varchar('capability', { length: 40 }),
    purpose: varchar('purpose', { length: 40 }).notNull(),
    sourceRoute: varchar('source_route', { length: 80 }).notNull(),
    gatewayPath: varchar('gateway_path', { length: 80 }).notNull(),
    callerRole: varchar('caller_role', { length: 40 }).notNull(),
    capabilityRuntimeProfileVersion: varchar('capability_runtime_profile_version', {
      length: 100,
    }),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    })
      .notNull()
      .references(() => aiProviderDeploymentProfiles.profileVersion, {
        onDelete: 'restrict',
      }),
    outputSchemaName: varchar('output_schema_name', { length: 100 }).notNull(),
    outputSchemaDigest: varchar('output_schema_digest', { length: 64 }).notNull(),
    promptDigest: varchar('prompt_digest', { length: 64 }).notNull(),
    artifactAttestations: jsonb('artifact_attestations')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    artifactAttestationsDigest: varchar('artifact_attestations_digest', {
      length: 64,
    }).notNull(),
    sdkRequestShapeDigest: varchar('sdk_request_shape_digest', { length: 64 }).notNull(),
    staticTokenBearingBytes: integer('static_token_bearing_bytes').notNull(),
    staticTokenBearingDigest: varchar('static_token_bearing_digest', {
      length: 64,
    }).notNull(),
    sourceByteLimit: integer('source_byte_limit').notNull(),
    providerPayloadByteLimit: integer('provider_payload_byte_limit').notNull(),
    preparedRequestByteLimit: integer('prepared_request_byte_limit').notNull(),
    responseByteLimit: integer('response_byte_limit').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    // Persisted, not implied: every other per-route request parameter is a column,
    // and the gateway byte-compares this row against its compiled contract. Holding
    // the effort only in code would leave `profile_digest` with a preimage that the
    // database cannot reproduce, so the catalogue would stop being auditable from
    // the database alone.
    reasoningEffort: varchar('reasoning_effort', { length: 16 }).notNull(),
    providerDeadlineMs: integer('provider_deadline_ms').notNull(),
    requestDeadlineMs: integer('request_deadline_ms').notNull(),
    executionLeaseMs: integer('execution_lease_ms').notNull(),
    profileDigest: varchar('profile_digest', { length: 64 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    check(
      'ai_operation_profiles_branch_valid',
      sql`(
        (${t.command} = 'analysis' AND ${t.capability} = 'review_analysis' AND ${t.profileVersion} = 'review-analysis-v1' AND ${t.purpose} = 'ai.analyze' AND ${t.sourceRoute} = 'review-analysis' AND ${t.gatewayPath} = '/v1/review-analysis' AND ${t.callerRole} = 'worker' AND ${t.capabilityRuntimeProfileVersion} = 'review-analysis-runtime-v1')
        OR (${t.command} = 'reply' AND ${t.capability} = 'reply_drafting' AND ${t.profileVersion} = 'reply-suggestion-v1' AND ${t.purpose} = 'ai.generate_reply' AND ${t.sourceRoute} = 'reply-suggestion' AND ${t.gatewayPath} = '/v1/reply-suggestion' AND ${t.callerRole} = 'web' AND ${t.capabilityRuntimeProfileVersion} = 'reply-drafting-runtime-v1')
        OR (${t.command} = 'trend' AND ${t.capability} = 'property_trends' AND ${t.profileVersion} = 'property-trend-v1' AND ${t.purpose} = 'ai.detect_trends' AND ${t.sourceRoute} = 'property-trend' AND ${t.gatewayPath} = '/v1/property-trend' AND ${t.callerRole} = 'worker' AND ${t.capabilityRuntimeProfileVersion} = 'property-trends-runtime-v1')
        OR (${t.command} = 'synthetic_canary' AND ${t.capability} IS NULL AND ${t.profileVersion} = 'synthetic-canary-v1' AND ${t.purpose} = 'ai.synthetic_canary' AND ${t.sourceRoute} = 'synthetic-canary' AND ${t.gatewayPath} = 'internal:synthetic-canary' AND ${t.callerRole} = 'release_canary' AND ${t.capabilityRuntimeProfileVersion} IS NULL)
      )`,
    ),
    check(
      'ai_operation_profiles_digests_valid',
      sql`${t.outputSchemaDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.promptDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.artifactAttestationsDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.sdkRequestShapeDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.staticTokenBearingDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.profileDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'ai_operation_profiles_limits_valid',
      sql`${t.maxOutputTokens} BETWEEN 1 AND 8192
        AND ${t.sourceByteLimit} BETWEEN 1 AND 65536
        AND ${t.providerPayloadByteLimit} BETWEEN 1 AND 65536
        AND ${t.preparedRequestByteLimit} BETWEEN 1 AND 131072
        AND ${t.responseByteLimit} = 131072
        AND ${t.staticTokenBearingBytes} BETWEEN 1 AND ${t.preparedRequestByteLimit}
        AND ${t.providerDeadlineMs} IN (60000, 90000)
        AND ${t.requestDeadlineMs} = ${t.providerDeadlineMs} + 10000
        AND ${t.executionLeaseMs} BETWEEN ${t.requestDeadlineMs} AND 300000`,
    ),
    check(
      // The provider rejects `minimal` for the pinned model snapshot, so it is
      // absent here as well as in the TypeScript ladder: a value the wire refuses
      // must not be storable. `xhigh` and `max` are excluded outright — measured
      // against the live deployment they exhaust the output budget on reasoning and
      // return an empty body on every non-trivial route.
      'ai_operation_profiles_reasoning_effort_valid',
      sql`${t.reasoningEffort} IN ('none', 'low', 'medium', 'high')`,
    ),
  ],
)

export const aiRuntimeCapabilityProfiles = pgTable(
  'ai_runtime_capability_profiles',
  {
    runtimeProfileVersion: varchar('runtime_profile_version', {
      length: 100,
    }).primaryKey(),
    capability: varchar('capability', { length: 40 }).notNull(),
    purpose: varchar('purpose', { length: 40 }).notNull(),
    sourceRoute: varchar('source_route', { length: 80 }).notNull(),
    gatewayPath: varchar('gateway_path', { length: 80 }).notNull(),
    gatewayProfileVersion: varchar('gateway_profile_version', { length: 100 }).notNull(),
    caller: varchar('caller', { length: 20 }).notNull(),
    operationProfileVersion: varchar('operation_profile_version', { length: 100 })
      .notNull()
      .references(() => aiOperationProfiles.profileVersion, { onDelete: 'restrict' }),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    })
      .notNull()
      .references(() => aiProviderDeploymentProfiles.profileVersion, {
        onDelete: 'restrict',
      }),
    noticeVersion: varchar('notice_version', { length: 100 }).notNull(),
    noticeDigest: varchar('notice_digest', { length: 64 }).notNull(),
    catalogueDigest: varchar('catalogue_digest', { length: 64 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ai_runtime_capability_profiles_complete_unique').on(
      t.providerDeploymentProfileVersion,
      t.capability,
      t.runtimeProfileVersion,
    ),
    check(
      'ai_runtime_capability_profiles_branch_valid',
      sql`(
        (${t.capability} = 'review_analysis' AND ${t.runtimeProfileVersion} = 'review-analysis-runtime-v1' AND ${t.purpose} = 'ai.analyze' AND ${t.sourceRoute} = 'review-analysis' AND ${t.gatewayPath} = '/v1/review-analysis' AND ${t.gatewayProfileVersion} = 'review-analysis-gateway-v1' AND ${t.caller} = 'worker' AND ${t.operationProfileVersion} = 'review-analysis-v1')
        OR (${t.capability} = 'reply_drafting' AND ${t.runtimeProfileVersion} = 'reply-drafting-runtime-v1' AND ${t.purpose} = 'ai.generate_reply' AND ${t.sourceRoute} = 'reply-suggestion' AND ${t.gatewayPath} = '/v1/reply-suggestion' AND ${t.gatewayProfileVersion} = 'reply-suggestion-gateway-v1' AND ${t.caller} = 'web' AND ${t.operationProfileVersion} = 'reply-suggestion-v1')
        OR (${t.capability} = 'property_trends' AND ${t.runtimeProfileVersion} = 'property-trends-runtime-v1' AND ${t.purpose} = 'ai.detect_trends' AND ${t.sourceRoute} = 'property-trend' AND ${t.gatewayPath} = '/v1/property-trend' AND ${t.gatewayProfileVersion} = 'property-trend-gateway-v1' AND ${t.caller} = 'worker' AND ${t.operationProfileVersion} = 'property-trend-v1')
      )`,
    ),
    check(
      'ai_runtime_capability_profiles_provider_valid',
      sql`${t.providerDeploymentProfileVersion} = 'private-beta-global-v1'`,
    ),
    check(
      'ai_runtime_capability_profiles_digests_valid',
      sql`${t.noticeDigest} ~ '^[0-9a-f]{64}$' AND ${t.catalogueDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

export const aiProviderDeploymentCapabilities = pgTable(
  'ai_provider_deployment_capabilities',
  {
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    })
      .notNull()
      .references(() => aiProviderDeploymentProfiles.profileVersion, {
        onDelete: 'restrict',
      }),
    capability: varchar('capability', { length: 40 }).notNull(),
    runtimeProfileVersion: varchar('runtime_profile_version', { length: 100 }).notNull(),
    catalogueDigest: varchar('catalogue_digest', { length: 64 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.providerDeploymentProfileVersion, t.capability],
      name: 'ai_provider_deployment_capabilities_pk',
    }),
    foreignKey({
      columns: [
        t.providerDeploymentProfileVersion,
        t.capability,
        t.runtimeProfileVersion,
      ],
      foreignColumns: [
        aiRuntimeCapabilityProfiles.providerDeploymentProfileVersion,
        aiRuntimeCapabilityProfiles.capability,
        aiRuntimeCapabilityProfiles.runtimeProfileVersion,
      ],
      name: 'ai_provider_deployment_capabilities_runtime_fk',
    }).onDelete('restrict'),
    check(
      'ai_provider_deployment_capabilities_provider_valid',
      sql`${t.providerDeploymentProfileVersion} = 'private-beta-global-v1'`,
    ),
    check(
      'ai_provider_deployment_capabilities_digest_valid',
      sql`${t.catalogueDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

export const aiPropertyProcessingProfiles = pgTable(
  'ai_property_processing_profiles',
  {
    propertyId: uuid('property_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    processingRegion: varchar('processing_region', { length: 20 }).notNull(),
    routingPolicyVersion: integer('routing_policy_version')
      .notNull()
      .references(() => aiRoutingPolicies.version, { onDelete: 'restrict' }),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    })
      .notNull()
      .references(() => aiProviderDeploymentProfiles.profileVersion, {
        onDelete: 'restrict',
      }),
    sourceEpoch: integer('source_epoch').notNull(),
    profileVersion: integer('profile_version').notNull(),
    lifecycleState: varchar('lifecycle_state', { length: 20 }).notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_property_profiles_tenant_fk',
    }).onDelete('cascade'),
    check('ai_property_profiles_country_valid', sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      'ai_property_profiles_timezone_valid',
      sql`length(${t.timezone}) BETWEEN 1 AND 64`,
    ),
    check('ai_property_profiles_region_valid', sql`${t.processingRegion} = 'global'`),
    check(
      'ai_property_profiles_versions_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.profileVersion} >= 1`,
    ),
    check(
      'ai_property_profiles_lifecycle_valid',
      sql`${t.lifecycleState} IN ('active', 'deleting')`,
    ),
    index('ai_property_profiles_org_idx').on(t.organizationId, t.updatedAt.desc()),
  ],
)

export const aiReadBarrierHeads = pgTable(
  'ai_read_barrier_heads',
  {
    scopeKind: varchar('scope_kind', { length: 20 }).notNull(),
    scopeId: varchar('scope_id', { length: 255 }).notNull(),
    domainVersion: varchar('domain_version', { length: 100 }).notNull(),
    generation: integer('generation').notNull(),
    state: varchar('state', { length: 20 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeKind, t.scopeId], name: 'ai_read_barrier_heads_pk' }),
    check(
      'ai_read_barrier_heads_scope_valid',
      sql`${t.scopeKind} IN ('organization', 'property', 'actor') AND length(${t.scopeId}) BETWEEN 1 AND 255`,
    ),
    check(
      'ai_read_barrier_heads_domain_valid',
      sql`${t.domainVersion} = 'ai-read-barrier-v1'`,
    ),
    check('ai_read_barrier_heads_generation_valid', sql`${t.generation} >= 1`),
    check('ai_read_barrier_heads_state_valid', sql`${t.state} IN ('open', 'closing')`),
    check('ai_read_barrier_heads_time_valid', sql`${t.updatedAt} >= ${t.createdAt}`),
  ],
)

export const aiReviewEventCursors = pgTable(
  'ai_review_event_cursors',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    analysisStartSequence: bigint('analysis_start_sequence', {
      mode: 'number',
    }).notNull(),
    consumedSequence: bigint('consumed_sequence', { mode: 'number' }).notNull(),
    terminalAnalysisSequence: bigint('terminal_analysis_sequence', {
      mode: 'number',
    }).notNull(),
    aggregateRevision: bigint('aggregate_revision', { mode: 'number' }).notNull(),
    lastConsumedEventId: uuid('last_consumed_event_id'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.propertyId, t.sourceEpoch, t.reviewAnalysisEpoch],
      name: 'ai_review_event_cursors_pk',
    }),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_review_event_cursors_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_review_event_cursors_sequences_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.reviewAnalysisEpoch} >= 1
        AND ${t.analysisStartSequence} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.consumedSequence} BETWEEN ${t.analysisStartSequence} AND '9007199254740991'::bigint
        AND ${t.terminalAnalysisSequence} BETWEEN ${t.analysisStartSequence} AND ${t.consumedSequence}
        AND ${t.aggregateRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check('ai_review_event_cursors_time_valid', sql`${t.updatedAt} >= ${t.createdAt}`),
    index('ai_review_event_cursors_property_idx').on(t.organizationId, t.propertyId),
  ],
)

export const aiReviewAnalysisOutcomes = pgTable(
  'ai_review_analysis_outcomes',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    eventEnvelopeId: uuid('event_envelope_id').notNull(),
    operationId: uuid('operation_id').references(() => aiOperations.id, {
      onDelete: 'cascade',
    }),
    state: varchar('state', { length: 30 }).notNull(),
    dispositionCode: varchar('disposition_code', { length: 64 }),
    appliedAggregateRevision: bigint('applied_aggregate_revision', {
      mode: 'number',
    }),
    appliedAt: timestamptz('applied_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.sourceEpoch,
        t.reviewAnalysisEpoch,
        t.analysisSequence,
      ],
      name: 'ai_review_analysis_outcomes_pk',
    }),
    foreignKey({
      columns: [t.organizationId, t.propertyId, t.sourceEpoch, t.reviewAnalysisEpoch],
      foreignColumns: [
        aiReviewEventCursors.organizationId,
        aiReviewEventCursors.propertyId,
        aiReviewEventCursors.sourceEpoch,
        aiReviewEventCursors.reviewAnalysisEpoch,
      ],
      name: 'ai_review_analysis_outcomes_cursor_fk',
    }).onDelete('cascade'),
    check(
      'ai_review_analysis_outcomes_sequence_valid',
      sql`${t.analysisSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'ai_review_analysis_outcomes_state_valid',
      sql`(
        (
          ${t.state} = 'pending'
          AND ${t.dispositionCode} IS NULL
          AND ${t.appliedAggregateRevision} IS NULL
          AND ${t.appliedAt} IS NULL
        )
        OR (
          ${t.state} = 'ready'
          AND ${t.operationId} IS NOT NULL
          AND ${t.dispositionCode} IS NULL
          AND (
            (${t.appliedAggregateRevision} IS NULL AND ${t.appliedAt} IS NULL)
            OR (
              ${t.appliedAggregateRevision} BETWEEN 1 AND '9007199254740991'::bigint
              AND ${t.appliedAt} IS NOT NULL
            )
          )
        )
        OR (
          ${t.state} = 'terminal_no_result'
          AND ${t.dispositionCode} IN (
            'source_expired',
            'provider_deleted',
            'policy_disabled',
            'language_not_supported'
          )
          AND (
            (${t.appliedAggregateRevision} IS NULL AND ${t.appliedAt} IS NULL)
            OR (
              ${t.appliedAggregateRevision} BETWEEN 1 AND '9007199254740991'::bigint
              AND ${t.appliedAt} IS NOT NULL
            )
          )
        )
      )`,
    ),
    check(
      'ai_review_analysis_outcomes_time_valid',
      sql`${t.updatedAt} >= ${t.createdAt}`,
    ),
    uniqueIndex('ai_review_analysis_outcomes_event_unique').on(t.eventEnvelopeId),
    index('ai_review_analysis_outcomes_terminal_idx').on(
      t.organizationId,
      t.propertyId,
      t.sourceEpoch,
      t.reviewAnalysisEpoch,
      t.analysisSequence,
      t.state,
    ),
  ],
)

export const aiExecutionControlTransitions = pgTable(
  'ai_execution_control_transitions',
  {
    controlId: uuid('control_id').notNull(),
    generation: integer('generation').notNull(),
    predecessorGeneration: integer('predecessor_generation'),
    scopeKey: varchar('scope_key', { length: 150 }).notNull(),
    scopeKind: varchar('scope_kind', { length: 40 }).notNull(),
    scopeValue: varchar('scope_value', { length: 100 }),
    executionState: varchar('execution_state', { length: 20 }).notNull(),
    admissionState: varchar('admission_state', { length: 20 }).notNull(),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    actorUserId: varchar('actor_user_id', { length: 255 }),
    ticketReference: varchar('ticket_reference', { length: 255 }).notNull(),
    candidateReleaseSha: varchar('candidate_release_sha', { length: 40 }),
    occurredAt: timestamptz('occurred_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.controlId, t.generation],
      name: 'ai_execution_control_transitions_pk',
    }),
    uniqueIndex('ai_execution_control_transitions_scope_generation_unique').on(
      t.scopeKey,
      t.generation,
    ),
    check(
      'ai_execution_control_transitions_generation_valid',
      sql`${t.generation} >= 1 AND ((${t.generation} = 1 AND ${t.predecessorGeneration} IS NULL) OR (${t.generation} > 1 AND ${t.predecessorGeneration} = ${t.generation} - 1))`,
    ),
    check(
      'ai_execution_control_transitions_scope_valid',
      sql`(
        (${t.scopeKind} = 'global' AND ${t.scopeKey} = 'global' AND ${t.scopeValue} IS NULL)
        OR (${t.scopeKind} = 'provider_deployment_profile' AND ${t.scopeValue} ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND ${t.scopeKey} = 'provider:' || ${t.scopeValue})
        OR (${t.scopeKind} = 'capability' AND ${t.scopeValue} IN ('review_analysis', 'reply_drafting', 'property_trends') AND ${t.scopeKey} = 'capability:' || ${t.scopeValue})
      )`,
    ),
    check(
      'ai_execution_control_transitions_state_valid',
      sql`${t.executionState} IN ('enabled', 'killed') AND ${t.admissionState} IN ('accepting', 'draining')`,
    ),
    check(
      'ai_execution_control_transitions_reason_valid',
      sql`${t.reasonCode} ~ '^[a-z][a-z0-9_]{2,63}$' AND length(${t.ticketReference}) BETWEEN 1 AND 255`,
    ),
    check(
      'ai_execution_control_transitions_release_valid',
      sql`${t.candidateReleaseSha} IS NULL OR ${t.candidateReleaseSha} ~ '^[0-9a-f]{40}$'`,
    ),
  ],
)

export const aiExecutionControlHeads = pgTable(
  'ai_execution_control_heads',
  {
    scopeKey: varchar('scope_key', { length: 150 }).primaryKey(),
    scopeKind: varchar('scope_kind', { length: 40 }).notNull(),
    scopeValue: varchar('scope_value', { length: 100 }),
    controlId: uuid('control_id').notNull(),
    generation: integer('generation').notNull(),
    executionState: varchar('execution_state', { length: 20 }).notNull(),
    admissionState: varchar('admission_state', { length: 20 }).notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.controlId, t.generation],
      foreignColumns: [
        aiExecutionControlTransitions.controlId,
        aiExecutionControlTransitions.generation,
      ],
      name: 'ai_execution_control_heads_transition_fk',
    }).onDelete('restrict'),
    uniqueIndex('ai_execution_control_heads_control_unique').on(
      t.controlId,
      t.generation,
    ),
    check('ai_execution_control_heads_generation_valid', sql`${t.generation} >= 1`),
    check(
      'ai_execution_control_heads_scope_valid',
      sql`(
        (${t.scopeKind} = 'global' AND ${t.scopeKey} = 'global' AND ${t.scopeValue} IS NULL)
        OR (${t.scopeKind} = 'provider_deployment_profile' AND ${t.scopeValue} ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND ${t.scopeKey} = 'provider:' || ${t.scopeValue})
        OR (${t.scopeKind} = 'capability' AND ${t.scopeValue} IN ('review_analysis', 'reply_drafting', 'property_trends') AND ${t.scopeKey} = 'capability:' || ${t.scopeValue})
      )`,
    ),
    check(
      'ai_execution_control_heads_state_valid',
      sql`${t.executionState} IN ('enabled', 'killed') AND ${t.admissionState} IN ('accepting', 'draining')`,
    ),
  ],
)

export const aiOperations = pgTable(
  'ai_operations',
  {
    id: uuid('id').primaryKey(),
    idempotencyScope: varchar('idempotency_scope', { length: 255 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    requestFingerprint: varchar('request_fingerprint', { length: 64 }).notNull(),
    sourceDigest: varchar('source_digest', { length: 64 }),
    sourceByteCount: integer('source_byte_count'),
    command: varchar('command', { length: 32 }).notNull(),
    capability: varchar('capability', { length: 40 }),
    organizationId: varchar('organization_id', { length: 255 }),
    propertyId: uuid('property_id'),
    actorUserId: varchar('actor_user_id', { length: 255 }),
    systemPrincipal: varchar('system_principal', { length: 64 }),
    reviewId: uuid('review_id'),
    originEventId: uuid('origin_event_id'),
    subjectHmac: varchar('subject_hmac', { length: 64 }),
    subjectHmacKeyVersion: varchar('subject_hmac_key_version', { length: 100 }),
    sourceEpoch: integer('source_epoch'),
    sourceRevision: bigint('source_revision', { mode: 'number' }),
    reviewedAtEpochMillis: bigint('reviewed_at_epoch_millis', { mode: 'number' }),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }),
    tone: varchar('tone', { length: 20 }),
    baseReplyStateRevision: bigint('base_reply_state_revision', { mode: 'number' }),
    dueLocalDate: date('due_local_date', { mode: 'string' }),
    terminalAnalysisSequence: bigint('terminal_analysis_sequence', { mode: 'number' }),
    aggregateRevision: bigint('aggregate_revision', { mode: 'number' }),
    releaseSha: varchar('release_sha', { length: 40 }),
    canaryAuthorizationId: uuid('canary_authorization_id').references(
      (): AnyPgColumn => aiCanaryAuthorizations.id,
      { onDelete: 'restrict' },
    ),
    canaryAuthorizationGeneration: integer('canary_authorization_generation'),
    canaryProfileVersion: varchar('canary_profile_version', { length: 100 }),
    authorizationLineageId: uuid('authorization_lineage_id'),
    noticeVersion: varchar('notice_version', { length: 100 }),
    noticeDigest: varchar('notice_digest', { length: 64 }),
    evaluatedLanguage: varchar('evaluated_language', { length: 35 }),
    concreteReplyLanguageTag: varchar('concrete_reply_language_tag', { length: 35 }),
    concreteReplyTemplateGroup: varchar('concrete_reply_template_group', { length: 64 }),
    languageCatalogueDigest: varchar('language_catalogue_digest', { length: 64 }),
    replyLanguageVerifierDigest: varchar('reply_language_verifier_digest', {
      length: 64,
    }),
    languageScriptConsistencyDigest: varchar('language_script_consistency_digest', {
      length: 64,
    }),
    zhOrthographyVerifierDigest: varchar('zh_orthography_verifier_digest', {
      length: 64,
    }),
    propertyProfileVersion: integer('property_profile_version'),
    routingPolicyVersion: integer('routing_policy_version'),
    sourcePolicyId: varchar('source_policy_id', { length: 150 }),
    sourceCanonicalizerDigest: varchar('source_canonicalizer_digest', { length: 64 }),
    redactionProfileVersion: varchar('redaction_profile_version', { length: 100 }),
    outputLeakageProfileVersion: varchar('output_leakage_profile_version', {
      length: 100,
    }),
    outputLeakageProfileDigest: varchar('output_leakage_profile_digest', { length: 64 }),
    replyTemplateCatalogueVersion: varchar('reply_template_catalogue_version', {
      length: 100,
    }),
    replyTemplateCatalogueDigest: varchar('reply_template_catalogue_digest', {
      length: 64,
    }),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    })
      .notNull()
      .references(() => aiProviderDeploymentProfiles.profileVersion, {
        onDelete: 'restrict',
      }),
    operationProfileVersion: varchar('operation_profile_version', { length: 100 })
      .notNull()
      .references(() => aiOperationProfiles.profileVersion, { onDelete: 'restrict' }),
    capabilityRuntimeProfileVersion: varchar('capability_runtime_profile_version', {
      length: 100,
    }),
    globalControlId: uuid('global_control_id').notNull(),
    globalControlGeneration: integer('global_control_generation').notNull(),
    providerControlId: uuid('provider_control_id').notNull(),
    providerControlGeneration: integer('provider_control_generation').notNull(),
    capabilityControlId: uuid('capability_control_id'),
    capabilityControlGeneration: integer('capability_control_generation'),
    capabilityFences: jsonb('capability_fences'),
    state: varchar('state', { length: 40 }).notNull(),
    executionAttempt: integer('execution_attempt').notNull(),
    nextAttemptAt: timestamptz('next_attempt_at'),
    failureCode: varchar('failure_code', { length: 64 }),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    deliveredAt: timestamptz('delivered_at'),
    replyAdoptionDisposition: varchar('reply_adoption_disposition', {
      length: 20,
    })
      .notNull()
      .default('none'),
    adoptedReplyRevision: bigint('adopted_reply_revision', { mode: 'number' }),
    adoptedReviewReplyStateRevision: bigint('adopted_review_reply_state_revision', {
      mode: 'number',
    }),
  },
  (t) => [
    uniqueIndex('ai_operations_idempotency_unique').on(
      t.idempotencyScope,
      t.idempotencyKey,
    ),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_operations_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.globalControlId, t.globalControlGeneration],
      foreignColumns: [
        aiExecutionControlTransitions.controlId,
        aiExecutionControlTransitions.generation,
      ],
      name: 'ai_operations_global_control_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.providerControlId, t.providerControlGeneration],
      foreignColumns: [
        aiExecutionControlTransitions.controlId,
        aiExecutionControlTransitions.generation,
      ],
      name: 'ai_operations_provider_control_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.capabilityControlId, t.capabilityControlGeneration],
      foreignColumns: [
        aiExecutionControlTransitions.controlId,
        aiExecutionControlTransitions.generation,
      ],
      name: 'ai_operations_capability_control_fk',
    }).onDelete('restrict'),
    check(
      'ai_operations_fingerprint_valid',
      sql`${t.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'ai_operations_source_provenance_valid',
      sql`(
        (${t.command} = 'synthetic_canary' AND ${t.sourceDigest} IS NULL AND ${t.sourceByteCount} IS NULL)
        OR (${t.command} <> 'synthetic_canary' AND ${t.sourceDigest} ~ '^[0-9a-f]{64}$' AND ${t.sourceByteCount} BETWEEN 1 AND 131072)
      )`,
    ),
    check(
      'ai_operations_state_valid',
      sql`${t.state} IN ('pending', 'executing', 'succeeded_pending_delivery', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'ai_operations_attempt_valid',
      sql`${t.executionAttempt} >= 0 AND ${t.expiresAt} > ${t.createdAt} AND ${t.updatedAt} >= ${t.createdAt} AND (${t.nextAttemptAt} IS NULL OR ${t.nextAttemptAt} >= ${t.updatedAt})`,
    ),
    check(
      'ai_operations_safe_integers',
      sql`COALESCE(${t.sourceRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.reviewedAtEpochMillis}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.analysisSequence}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.baseReplyStateRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.terminalAnalysisSequence}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.aggregateRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.adoptedReplyRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.adoptedReviewReplyStateRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'ai_operations_branch_valid',
      sql`(
        (${t.command} = 'analysis' AND ${t.capability} = 'review_analysis' AND ${t.organizationId} IS NOT NULL AND ${t.propertyId} IS NOT NULL AND ${t.actorUserId} IS NULL AND ${t.systemPrincipal} = 'review_event_consumer' AND ${t.reviewId} IS NOT NULL AND ${t.originEventId} IS NOT NULL AND ${t.subjectHmac} ~ '^[0-9a-f]{64}$' AND ${t.subjectHmacKeyVersion} IS NOT NULL AND ${t.sourceEpoch} >= 0 AND ${t.sourceRevision} >= 1 AND ${t.analysisSequence} >= 1 AND ${t.operationProfileVersion} = 'review-analysis-v1' AND ${t.capabilityRuntimeProfileVersion} = 'review-analysis-runtime-v1')
        OR (${t.command} = 'reply' AND ${t.capability} = 'reply_drafting' AND ${t.organizationId} IS NOT NULL AND ${t.propertyId} IS NOT NULL AND ${t.actorUserId} IS NOT NULL AND ${t.systemPrincipal} IS NULL AND ${t.reviewId} IS NOT NULL AND ${t.sourceEpoch} >= 0 AND ${t.sourceRevision} >= 1 AND ${t.tone} IN ('professional', 'friendly', 'casual') AND ${t.baseReplyStateRevision} >= 0 AND ${t.operationProfileVersion} = 'reply-suggestion-v1' AND ${t.capabilityRuntimeProfileVersion} = 'reply-drafting-runtime-v1')
        OR (${t.command} = 'trend' AND ${t.capability} = 'property_trends' AND ${t.organizationId} IS NOT NULL AND ${t.propertyId} IS NOT NULL AND ${t.actorUserId} IS NULL AND ${t.systemPrincipal} = 'property_trend_coordinator' AND ${t.sourceEpoch} >= 0 AND ${t.dueLocalDate} IS NOT NULL AND ${t.terminalAnalysisSequence} >= 0 AND ${t.aggregateRevision} >= 0 AND ${t.operationProfileVersion} = 'property-trend-v1' AND ${t.capabilityRuntimeProfileVersion} = 'property-trends-runtime-v1')
        OR (${t.command} = 'synthetic_canary' AND ${t.capability} IS NULL AND ${t.organizationId} IS NULL AND ${t.propertyId} IS NULL AND ${t.actorUserId} IS NULL AND ${t.systemPrincipal} = 'release_canary' AND ${t.releaseSha} ~ '^[0-9a-f]{40}$' AND ${t.canaryAuthorizationId} IS NOT NULL AND ${t.canaryAuthorizationGeneration} BETWEEN 1 AND 3 AND ${t.canaryProfileVersion} IS NOT NULL AND ${t.operationProfileVersion} = 'synthetic-canary-v1' AND ${t.capabilityRuntimeProfileVersion} IS NULL)
      )`,
    ),
    check(
      'ai_operations_reply_adoption_valid',
      sql`(
        (
          ${t.command} = 'reply'
          AND ${t.replyAdoptionDisposition} IN ('none', 'adopted', 'invalidated')
          AND (
            (${t.replyAdoptionDisposition} = 'none'
              AND ${t.adoptedReplyRevision} IS NULL
              AND ${t.adoptedReviewReplyStateRevision} IS NULL)
            OR (${t.replyAdoptionDisposition} IN ('adopted', 'invalidated')
              AND ${t.adoptedReplyRevision} >= 1
              AND ${t.adoptedReviewReplyStateRevision} >= 1)
          )
        )
        OR (
          ${t.command} <> 'reply'
          AND ${t.replyAdoptionDisposition} = 'none'
          AND ${t.adoptedReplyRevision} IS NULL
          AND ${t.adoptedReviewReplyStateRevision} IS NULL
        )
      )`,
    ),
    check(
      'ai_operations_control_fence_valid',
      sql`${t.globalControlGeneration} >= 1
        AND ${t.providerControlGeneration} >= 1
        AND (
          (
            ${t.command} = 'synthetic_canary'
            AND ${t.capabilityControlId} IS NULL
            AND ${t.capabilityControlGeneration} IS NULL
            AND jsonb_typeof(${t.capabilityFences}) = 'array'
            AND jsonb_array_length(${t.capabilityFences}) = 3
          )
          OR (
            ${t.command} <> 'synthetic_canary'
            AND ${t.capabilityControlId} IS NOT NULL
            AND ${t.capabilityControlGeneration} >= 1
            AND jsonb_typeof(${t.capabilityFences}) = 'object'
            AND (
              (${t.command} = 'analysis' AND jsonb_array_length(jsonb_path_query_array(${t.capabilityFences}, '$.keyvalue()'::jsonpath)) = 2 AND ${t.capabilityFences}->>'capability' = 'review_analysis' AND (${t.capabilityFences}->>'reviewAnalysisEpoch') ~ '^[1-9][0-9]*$')
              OR (${t.command} = 'reply' AND jsonb_array_length(jsonb_path_query_array(${t.capabilityFences}, '$.keyvalue()'::jsonpath)) = 3 AND ${t.capabilityFences}->>'capability' = 'reply_drafting' AND (${t.capabilityFences}->>'replyDraftingEpoch') ~ '^[1-9][0-9]*$' AND (${t.capabilityFences}->>'baseReplyStateRevision') ~ '^(0|[1-9][0-9]*)$')
              OR (${t.command} = 'trend' AND jsonb_array_length(jsonb_path_query_array(${t.capabilityFences}, '$.keyvalue()'::jsonpath)) = 3 AND ${t.capabilityFences}->>'capability' = 'property_trends' AND (${t.capabilityFences}->>'reviewAnalysisEpoch') ~ '^[1-9][0-9]*$' AND (${t.capabilityFences}->>'propertyTrendsEpoch') ~ '^[1-9][0-9]*$')
            )
          )
        )`,
    ),
    index('ai_operations_due_idx').on(t.state, t.nextAttemptAt),
    index('ai_operations_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.createdAt.desc(),
    ),
    index('ai_operations_expiry_idx').on(t.expiresAt),
  ],
)

export const aiOperationAttempts = pgTable(
  'ai_operation_attempts',
  {
    operationId: uuid('operation_id')
      .notNull()
      .references(() => aiOperations.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    state: varchar('state', { length: 32 }).notNull(),
    modelSnapshot: varchar('model_snapshot', { length: 100 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    failureCode: varchar('failure_code', { length: 64 }),
    startedAt: timestamptz('started_at').notNull(),
    settledAt: timestamptz('settled_at'),
  },
  (t) => [
    primaryKey({ columns: [t.operationId, t.attempt], name: 'ai_operation_attempts_pk' }),
    check('ai_operation_attempts_number_valid', sql`${t.attempt} >= 1`),
    check(
      'ai_operation_attempts_state_valid',
      sql`${t.state} IN ('executing', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'ai_operation_attempts_terminal_valid',
      sql`(
        (${t.state} = 'executing' AND ${t.settledAt} IS NULL AND ${t.failureCode} IS NULL AND ${t.modelSnapshot} IS NULL AND ${t.inputTokens} IS NULL AND ${t.outputTokens} IS NULL)
        OR (${t.state} = 'completed' AND ${t.settledAt} IS NOT NULL AND ${t.failureCode} IS NULL AND ${t.modelSnapshot} IS NOT NULL AND ${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0)
        OR (${t.state} IN ('failed', 'cancelled') AND ${t.settledAt} IS NOT NULL AND ${t.modelSnapshot} IS NULL AND ${t.inputTokens} IS NULL AND ${t.outputTokens} IS NULL)
      ) AND (${t.settledAt} IS NULL OR ${t.settledAt} >= ${t.startedAt})`,
    ),
  ],
)

export const aiProductVolumeConsumptions = pgTable(
  'ai_product_volume_consumptions',
  {
    operationId: uuid('operation_id')
      .primaryKey()
      .references(() => aiOperations.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    capability: varchar('capability', { length: 40 }).notNull(),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    }).notNull(),
    modelSnapshot: varchar('model_snapshot', { length: 100 }).notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    completedAt: timestamptz('completed_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_product_volume_consumptions_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_product_volume_consumptions_valid',
      sql`${t.capability} IN ('review_analysis', 'reply_drafting', 'property_trends') AND ${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.totalTokens} = ${t.inputTokens} + ${t.outputTokens}`,
    ),
    index('ai_product_volume_consumptions_org_time_idx').on(
      t.organizationId,
      t.completedAt.desc(),
    ),
  ],
)

export const aiExecutionPermits = pgTable(
  'ai_execution_permits',
  {
    id: uuid('id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => aiOperations.id, { onDelete: 'cascade' }),
    executionAttempt: integer('execution_attempt').notNull(),
    globalControlId: uuid('global_control_id').notNull(),
    globalControlGeneration: integer('global_control_generation').notNull(),
    providerControlId: uuid('provider_control_id').notNull(),
    providerControlGeneration: integer('provider_control_generation').notNull(),
    capabilityControlId: uuid('capability_control_id'),
    capabilityControlGeneration: integer('capability_control_generation'),
    route: varchar('route', { length: 40 }).notNull(),
    requestBindingKeyId: varchar('request_binding_key_id', { length: 32 }),
    requestBindingHmac: varchar('request_binding_hmac', { length: 43 }),
    grantKid: varchar('grant_kid', { length: 32 }),
    nonce: varchar('nonce', { length: 128 }),
    state: varchar('state', { length: 20 }).notNull().default('issued'),
    admittedAt: timestamptz('admitted_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    concurrencyExpiresAt: timestamptz('concurrency_expires_at'),
    expiresAt: timestamptz('expires_at').notNull(),
    maximumCostMicros: bigint('maximum_cost_micros', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('ai_execution_permits_operation_attempt_unique').on(
      t.operationId,
      t.executionAttempt,
    ),
    foreignKey({
      columns: [t.operationId, t.executionAttempt],
      foreignColumns: [aiOperationAttempts.operationId, aiOperationAttempts.attempt],
      name: 'ai_execution_permits_attempt_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.globalControlId, t.globalControlGeneration],
      foreignColumns: [
        aiExecutionControlTransitions.controlId,
        aiExecutionControlTransitions.generation,
      ],
      name: 'ai_execution_permits_global_control_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.providerControlId, t.providerControlGeneration],
      foreignColumns: [
        aiExecutionControlTransitions.controlId,
        aiExecutionControlTransitions.generation,
      ],
      name: 'ai_execution_permits_provider_control_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.capabilityControlId, t.capabilityControlGeneration],
      foreignColumns: [
        aiExecutionControlTransitions.controlId,
        aiExecutionControlTransitions.generation,
      ],
      name: 'ai_execution_permits_capability_control_fk',
    }).onDelete('restrict'),
    check(
      'ai_execution_permits_valid',
      sql`${t.executionAttempt} >= 1 AND ${t.globalControlGeneration} >= 1 AND ${t.providerControlGeneration} >= 1 AND COALESCE(${t.capabilityControlGeneration}, 1) >= 1 AND ${t.expiresAt} > ${t.admittedAt}`,
    ),
    check(
      'ai_execution_permits_admission_valid',
      sql`${t.route} IN ('review-analysis', 'reply-suggestion', 'property-trend', 'synthetic-canary')
        AND ${t.state} IN ('issued', 'consumed', 'settled', 'released', 'ambiguous')
        AND (
          (${t.state} IN ('issued', 'released') AND ${t.requestBindingKeyId} IS NULL AND ${t.requestBindingHmac} IS NULL AND ${t.grantKid} IS NULL AND ${t.nonce} IS NULL AND ${t.consumedAt} IS NULL AND ${t.concurrencyExpiresAt} IS NULL AND ${t.maximumCostMicros} IS NULL)
          OR (${t.state} IN ('consumed', 'settled', 'released', 'ambiguous') AND ${t.requestBindingKeyId} ~ '^[a-z][a-z0-9_-]{0,31}$' AND ${t.requestBindingHmac} ~ '^[A-Za-z0-9_-]{43}$' AND ${t.grantKid} ~ '^[a-z][a-z0-9_-]{0,31}$' AND length(${t.nonce}) BETWEEN 1 AND 128 AND ${t.consumedAt} IS NOT NULL AND ${t.concurrencyExpiresAt} IS NOT NULL AND ${t.maximumCostMicros} BETWEEN 0 AND '9007199254740991'::bigint)
        )`,
    ),
    index('ai_execution_permits_expiry_idx').on(t.expiresAt),
  ],
)

export const aiExecutionPermitSettlements = pgTable(
  'ai_execution_permit_settlements',
  {
    permitId: uuid('permit_id')
      .primaryKey()
      .references(() => aiExecutionPermits.id, { onDelete: 'cascade' }),
    terminalState: varchar('terminal_state', { length: 20 }).notNull(),
    grantKid: varchar('grant_kid', { length: 32 }).notNull(),
    requestBindingHmac: varchar('request_binding_hmac', { length: 43 }).notNull(),
    nonce: varchar('nonce', { length: 128 }).notNull(),
    disposition: varchar('disposition', { length: 40 }).notNull(),
    reportedDisposition: varchar('reported_disposition', { length: 40 }).notNull(),
    usageKnown: boolean('usage_known').notNull(),
    providerRetryable: boolean('provider_retryable').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    cachedInputTokens: integer('cached_input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    reasoningTokens: integer('reasoning_tokens').notNull(),
    retryAfterSeconds: integer('retry_after_seconds'),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
    settlementState: varchar('settlement_state', { length: 20 }).notNull(),
    settledAt: timestamptz('settled_at').notNull(),
  },
  (t) => [
    check(
      'ai_execution_permit_settlements_state_valid',
      sql`${t.terminalState} IN ('completed', 'failed', 'cancelled')
        AND ${t.settlementState} IN ('settled', 'released', 'ambiguous')
        AND ${t.disposition} IN ('success', 'no_dispatch', 'provider_refused', 'output_invalid', 'output_truncated', 'rate_limited', 'provider_unavailable', 'caller_aborted', 'deadline_exceeded', 'transport_ambiguous', 'source_stale', 'policy_denied')
        AND ${t.reportedDisposition} IN ('success', 'no_dispatch', 'provider_refused', 'output_invalid', 'output_truncated', 'rate_limited', 'provider_unavailable', 'caller_aborted', 'deadline_exceeded', 'transport_ambiguous', 'source_stale', 'policy_denied')`,
    ),
    check(
      'ai_execution_permit_settlements_usage_valid',
      sql`${t.grantKid} ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND ${t.requestBindingHmac} ~ '^[A-Za-z0-9_-]{43}$'
        AND length(${t.nonce}) BETWEEN 1 AND 128
        AND ${t.inputTokens} >= 0 AND ${t.cachedInputTokens} BETWEEN 0 AND ${t.inputTokens}
        AND ${t.outputTokens} >= 0 AND ${t.reasoningTokens} BETWEEN 0 AND ${t.outputTokens}
        AND (${t.usageKnown} OR (${t.inputTokens} = 0 AND ${t.cachedInputTokens} = 0
          AND ${t.outputTokens} = 0 AND ${t.reasoningTokens} = 0))
        AND (${t.disposition} <> 'success' OR ${t.usageKnown})
        AND (${t.disposition} <> 'no_dispatch' OR (NOT ${t.usageKnown}
          AND ${t.costMicros} = 0 AND ${t.settlementState} = 'released'))
        AND (${t.disposition} <> 'transport_ambiguous' OR (NOT ${t.usageKnown}
          AND ${t.settlementState} = 'ambiguous'))
        AND ${t.costMicros} BETWEEN 0 AND '9007199254740991'::bigint
        AND (NOT ${t.providerRetryable}
          OR ${t.reportedDisposition} IN ('rate_limited', 'provider_unavailable'))
        AND (${t.reportedDisposition} <> 'rate_limited' OR ${t.providerRetryable})
        AND (${t.retryAfterSeconds} IS NULL
          OR (${t.providerRetryable} AND ${t.retryAfterSeconds} BETWEEN 1 AND 300))`,
    ),
  ],
)

export const aiAdmissionProductConsumptions = pgTable(
  'ai_admission_product_consumptions',
  {
    operationId: uuid('operation_id')
      .primaryKey()
      .references(() => aiOperations.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    capability: varchar('capability', { length: 40 }).notNull(),
    propertyWindowGeneration: integer('property_window_generation').notNull(),
    accountedAt: timestamptz('accounted_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_admission_product_consumptions_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_admission_product_consumptions_valid',
      sql`${t.capability} IN ('review_analysis', 'reply_drafting') AND ${t.propertyWindowGeneration} >= 1`,
    ),
    index('ai_admission_product_consumptions_reply_hour_idx').on(
      t.propertyId,
      t.capability,
      t.accountedAt,
    ),
  ],
)

export const aiPropertyQuotaWindows = pgTable(
  'ai_property_quota_windows',
  {
    propertyId: uuid('property_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    generation: integer('generation').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    transitionAnchor: timestamptz('transition_anchor'),
    adoptionAt: timestamptz('adoption_at'),
    pendingTimezone: varchar('pending_timezone', { length: 64 }),
    pendingPropertyProfileVersion: integer('pending_property_profile_version'),
    analysisCount: integer('analysis_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    reservedCostMicros: bigint('reserved_cost_micros', { mode: 'number' })
      .notNull()
      .default(0),
    settledCostMicros: bigint('settled_cost_micros', { mode: 'number' })
      .notNull()
      .default(0),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_property_quota_windows_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_quota_windows_valid',
      sql`${t.generation} >= 1 AND ${t.propertyProfileVersion} >= 1
        AND length(${t.timezone}) BETWEEN 1 AND 64
        AND ${t.endsAt} > ${t.startsAt}
        AND ${t.analysisCount} BETWEEN 0 AND 500
        AND ${t.replyCount} BETWEEN 0 AND 100
        AND ${t.reservedCostMicros} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.settledCostMicros} BETWEEN 0 AND '9007199254740991'::bigint
        AND (
          (${t.transitionAnchor} IS NULL AND ${t.adoptionAt} IS NULL
            AND ${t.pendingTimezone} IS NULL
            AND ${t.pendingPropertyProfileVersion} IS NULL)
          OR (${t.transitionAnchor} IS NOT NULL AND ${t.adoptionAt} = ${t.endsAt}
            AND ${t.adoptionAt} >= ${t.transitionAnchor} + interval '24 hours'
            AND length(${t.pendingTimezone}) BETWEEN 1 AND 64
            AND ${t.pendingPropertyProfileVersion} >= 1)
        )`,
    ),
  ],
)

export const aiOrganizationCostWindows = pgTable(
  'ai_organization_cost_windows',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    utcDate: date('utc_date', { mode: 'string' }).notNull(),
    reservedCostMicros: bigint('reserved_cost_micros', { mode: 'number' })
      .notNull()
      .default(0),
    settledCostMicros: bigint('settled_cost_micros', { mode: 'number' })
      .notNull()
      .default(0),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.utcDate],
      name: 'ai_organization_cost_windows_pk',
    }),
    check(
      'ai_organization_cost_windows_valid',
      sql`${t.reservedCostMicros} BETWEEN 0 AND '9007199254740991'::bigint AND ${t.settledCostMicros} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
  ],
)

export const aiAdmissionCostReservations = pgTable(
  'ai_admission_cost_reservations',
  {
    permitId: uuid('permit_id')
      .primaryKey()
      .references(() => aiExecutionPermits.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }),
    propertyId: uuid('property_id'),
    propertyWindowGeneration: integer('property_window_generation'),
    organizationUtcDate: date('organization_utc_date', { mode: 'string' }),
    releaseSha: varchar('release_sha', { length: 40 }),
    maximumCostMicros: bigint('maximum_cost_micros', { mode: 'number' }).notNull(),
    actualCostMicros: bigint('actual_cost_micros', { mode: 'number' }),
    state: varchar('state', { length: 20 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    settledAt: timestamptz('settled_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_admission_cost_reservations_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_admission_cost_reservations_branch_valid',
      sql`(
        (${t.organizationId} IS NOT NULL AND ${t.propertyId} IS NOT NULL AND ${t.propertyWindowGeneration} >= 1 AND ${t.organizationUtcDate} IS NOT NULL AND ${t.releaseSha} IS NULL)
        OR (${t.organizationId} IS NULL AND ${t.propertyId} IS NULL AND ${t.propertyWindowGeneration} IS NULL AND ${t.organizationUtcDate} IS NULL AND ${t.releaseSha} ~ '^[0-9a-f]{40}$')
      )`,
    ),
    check(
      'ai_admission_cost_reservations_state_valid',
      sql`${t.state} IN ('reserved', 'released', 'charged')
        AND ${t.maximumCostMicros} BETWEEN 0 AND '9007199254740991'::bigint
        AND (${t.actualCostMicros} IS NULL OR ${t.actualCostMicros} BETWEEN 0 AND ${t.maximumCostMicros})
        AND ((${t.state} = 'reserved' AND ${t.actualCostMicros} IS NULL AND ${t.settledAt} IS NULL)
          OR (${t.state} <> 'reserved' AND ${t.actualCostMicros} IS NOT NULL AND ${t.settledAt} IS NOT NULL))`,
    ),
    index('ai_admission_cost_reservations_release_idx').on(t.releaseSha, t.state),
  ],
)

export const aiAdmissionRateWindows = pgTable(
  'ai_admission_rate_windows',
  {
    scopeKey: varchar('scope_key', { length: 200 }).primaryKey(),
    windowStartedAt: timestamptz('window_started_at').notNull(),
    consumedCount: integer('consumed_count').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    check(
      'ai_admission_rate_windows_valid',
      sql`length(${t.scopeKey}) BETWEEN 1 AND 200 AND ${t.consumedCount} >= 0`,
    ),
  ],
)

export const aiProviderCircuitStates = pgTable(
  'ai_provider_circuit_states',
  {
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    })
      .primaryKey()
      .references(() => aiProviderDeploymentProfiles.profileVersion, {
        onDelete: 'restrict',
      }),
    state: varchar('state', { length: 20 }).notNull(),
    consecutiveFailures: integer('consecutive_failures').notNull(),
    openedUntil: timestamptz('opened_until'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    check(
      'ai_provider_circuit_states_valid',
      sql`${t.state} IN ('closed', 'open', 'half_open')
        AND ${t.consecutiveFailures} BETWEEN 0 AND 1000000
        AND ((${t.state} = 'closed' AND ${t.openedUntil} IS NULL)
          OR (${t.state} <> 'closed' AND ${t.openedUntil} IS NOT NULL))`,
    ),
  ],
)

export const aiCanaryAuthorizations = pgTable(
  'ai_canary_authorizations',
  {
    id: uuid('id').primaryKey(),
    releaseSha: varchar('release_sha', { length: 40 }).notNull(),
    canaryProfileVersion: varchar('canary_profile_version', { length: 100 }).notNull(),
    authorizationGeneration: integer('authorization_generation').notNull(),
    predecessorAuthorizationId: uuid('predecessor_authorization_id').references(
      (): AnyPgColumn => aiCanaryAuthorizations.id,
      { onDelete: 'restrict' },
    ),
    nonce: varchar('nonce', { length: 64 }).notNull(),
    operatorUserId: varchar('operator_user_id', { length: 255 }).notNull(),
    state: varchar('state', { length: 30 }).notNull(),
    issuedAt: timestamptz('issued_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    settledAt: timestamptz('settled_at'),
  },
  (t) => [
    uniqueIndex('ai_canary_authorizations_generation_unique').on(
      t.releaseSha,
      t.canaryProfileVersion,
      t.authorizationGeneration,
    ),
    uniqueIndex('ai_canary_authorizations_active_unique')
      .on(t.releaseSha, t.canaryProfileVersion)
      .where(sql`${t.state} IN ('issued', 'consumed')`),
    check(
      'ai_canary_authorizations_release_valid',
      sql`${t.releaseSha} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      'ai_canary_authorizations_generation_valid',
      sql`${t.authorizationGeneration} BETWEEN 1 AND 3 AND ((${t.authorizationGeneration} = 1 AND ${t.predecessorAuthorizationId} IS NULL) OR (${t.authorizationGeneration} > 1 AND ${t.predecessorAuthorizationId} IS NOT NULL))`,
    ),
    check('ai_canary_authorizations_nonce_valid', sql`${t.nonce} ~ '^[0-9a-f]{64}$'`),
    check(
      'ai_canary_authorizations_operator_valid',
      sql`${t.operatorUserId} ~ '^[A-Za-z0-9][-A-Za-z0-9._@:/+]{0,254}$'`,
    ),
    check(
      'ai_canary_authorizations_state_valid',
      sql`${t.state} IN ('issued', 'consumed', 'revoked', 'expired', 'released_no_dispatch', 'passed', 'terminal_failed')`,
    ),
    check(
      'ai_canary_authorizations_time_valid',
      sql`${t.expiresAt} > ${t.issuedAt} AND ${t.expiresAt} <= ${t.issuedAt} + interval '5 minutes' AND ((${t.state} IN ('issued', 'consumed') AND ${t.settledAt} IS NULL) OR (${t.state} NOT IN ('issued', 'consumed') AND ${t.settledAt} IS NOT NULL AND ${t.settledAt} >= ${t.issuedAt}))`,
    ),
  ],
)

export const aiCanaryAuthorizationHeads = pgTable(
  'ai_canary_authorization_heads',
  {
    releaseSha: varchar('release_sha', { length: 40 }).notNull(),
    canaryProfileVersion: varchar('canary_profile_version', { length: 100 }).notNull(),
    headId: uuid('head_id').notNull(),
    transitionGeneration: integer('transition_generation').notNull(),
    nextAuthorizationGeneration: integer('next_authorization_generation').notNull(),
    currentAuthorizationId: uuid('current_authorization_id').references(
      () => aiCanaryAuthorizations.id,
      { onDelete: 'restrict' },
    ),
    currentOperationId: uuid('current_operation_id').references(() => aiOperations.id, {
      onDelete: 'restrict',
    }),
    currentPermitId: uuid('current_permit_id').references(() => aiExecutionPermits.id, {
      onDelete: 'restrict',
    }),
    state: varchar('state', { length: 30 }).notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.releaseSha, t.canaryProfileVersion],
      name: 'ai_canary_authorization_heads_pk',
    }),
    uniqueIndex('ai_canary_authorization_heads_id_unique').on(t.headId),
    check(
      'ai_canary_authorization_heads_generation_valid',
      sql`${t.transitionGeneration} >= 1 AND ${t.nextAuthorizationGeneration} BETWEEN 1 AND 4`,
    ),
    check(
      'ai_canary_authorization_heads_release_valid',
      sql`${t.releaseSha} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      'ai_canary_authorization_heads_state_valid',
      sql`(
        (${t.state} = 'eligible' AND ${t.currentAuthorizationId} IS NULL AND ${t.currentOperationId} IS NULL AND ${t.currentPermitId} IS NULL)
        OR (${t.state} = 'issued' AND ${t.currentAuthorizationId} IS NOT NULL AND ${t.currentOperationId} IS NOT NULL AND ${t.currentPermitId} IS NOT NULL)
        OR (${t.state} = 'in_flight' AND ${t.currentAuthorizationId} IS NOT NULL AND ${t.currentOperationId} IS NOT NULL AND ${t.currentPermitId} IS NOT NULL)
        OR (${t.state} IN ('passed', 'terminal_failed') AND ${t.currentAuthorizationId} IS NOT NULL AND ${t.currentOperationId} IS NOT NULL)
      )`,
    ),
  ],
)

export const aiPropertyCalendarAuthorities = pgTable(
  'ai_property_calendar_authorities',
  {
    profileVersion: varchar('profile_version', { length: 100 }).primaryKey(),
    epochMillisFunctionName: varchar('epoch_millis_function_name', {
      length: 100,
    }).notNull(),
    epochMillisFunctionDigest: varchar('epoch_millis_function_digest', {
      length: 64,
    }).notNull(),
    localDateFunctionName: varchar('local_date_function_name', { length: 100 }).notNull(),
    localDateFunctionDigest: varchar('local_date_function_digest', {
      length: 64,
    }).notNull(),
    localMidnightFunctionName: varchar('local_midnight_function_name', {
      length: 100,
    }).notNull(),
    localMidnightFunctionDigest: varchar('local_midnight_function_digest', {
      length: 64,
    }).notNull(),
    imageDigest: varchar('image_digest', { length: 64 }).notNull(),
    vectorDigest: varchar('vector_digest', { length: 64 }).notNull(),
    vectorCount: integer('vector_count').notNull(),
    minimumYear: integer('minimum_year').notNull(),
    maximumYear: integer('maximum_year').notNull(),
    testedPostgresMajorVersions: integer('tested_postgres_major_versions')
      .array()
      .notNull(),
    testVectors: jsonb('test_vectors')
      .$type<
        ReadonlyArray<
          Readonly<{
            reviewedAt: string
            timezone: string
            expectedLocalDate: string
          }>
        >
      >()
      .notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    check(
      'ai_property_calendar_authorities_profile_valid',
      sql`${t.profileVersion} = 'property-calendar-v1'`,
    ),
    check(
      'ai_property_calendar_authorities_function_valid',
      sql`${t.epochMillisFunctionName} = 'ai_epoch_millis_v1' AND ${t.localDateFunctionName} = 'ai_property_local_date_v1' AND ${t.localMidnightFunctionName} = 'ai_property_local_midnight_v1'`,
    ),
    check(
      'ai_property_calendar_authorities_digests_valid',
      sql`${t.epochMillisFunctionDigest} = ${sql.raw(`'${AI_PROPERTY_CALENDAR_PROFILE_V1.epochMillisFunctionDigest}'`)} AND ${t.localDateFunctionDigest} = ${sql.raw(`'${AI_PROPERTY_CALENDAR_PROFILE_V1.localDateFunctionDigest}'`)} AND ${t.localMidnightFunctionDigest} = ${sql.raw(`'${AI_PROPERTY_CALENDAR_PROFILE_V1.localMidnightFunctionDigest}'`)} AND ${t.imageDigest} = ${sql.raw(`'${AI_PROPERTY_CALENDAR_PROFILE_V1.databaseImageDigest}'`)} AND ${t.vectorDigest} = ${sql.raw(`'${AI_PROPERTY_CALENDAR_PROFILE_V1.vectorDigest}'`)}`,
    ),
    check(
      'ai_property_calendar_authorities_range_valid',
      sql`${t.vectorCount} = 10 AND ${t.minimumYear} = 1970 AND ${t.maximumYear} = 2100 AND ${t.testedPostgresMajorVersions} = ARRAY[16,17]::integer[] AND jsonb_typeof(${t.testVectors}) = 'array' AND jsonb_array_length(${t.testVectors}) = ${t.vectorCount}`,
    ),
  ],
)

export const aiReviewAnalyses = pgTable(
  'ai_review_analyses',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => aiOperations.id, { onDelete: 'restrict' }),
    authorizationLineageId: uuid('authorization_lineage_id').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    analysisProfileVersion: varchar('analysis_profile_version', { length: 100 })
      .notNull()
      .references(() => aiOperationProfiles.profileVersion, { onDelete: 'restrict' }),
    status: varchar('status', { length: 20 }).notNull(),
    unavailableReason: varchar('unavailable_reason', { length: 40 }),
    sentiment: varchar('sentiment', { length: 20 }),
    primaryCategory: varchar('primary_category', { length: 40 }),
    attention: varchar('attention', { length: 20 }),
    generatedAt: timestamptz('generated_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.reviewId,
        t.sourceEpoch,
        t.sourceRevision,
        t.analysisSequence,
      ],
      name: 'ai_review_analyses_pk',
    }),
    uniqueIndex('ai_review_analyses_operation_unique').on(t.operationId),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_review_analyses_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.propertyId, t.reviewId],
      foreignColumns: [reviews.organizationId, reviews.propertyId, reviews.id],
      name: 'ai_review_analyses_review_fk',
    }).onDelete('cascade'),
    check(
      'ai_review_analyses_versions_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.sourceRevision} BETWEEN 1 AND '9007199254740991'::bigint AND ${t.analysisSequence} BETWEEN 1 AND '9007199254740991'::bigint AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.propertyProfileVersion} >= 1`,
    ),
    check(
      'ai_review_analyses_result_valid',
      sql`(
        (${t.status} = 'ready' AND ${t.unavailableReason} IS NULL AND ${t.sentiment} IN ('positive', 'neutral', 'negative', 'mixed') AND ${t.primaryCategory} IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other') AND ${t.attention} IN ('urgent', 'high', 'medium', 'low'))
        OR (${t.status} = 'unavailable' AND ${t.unavailableReason} = 'language_not_supported' AND ${t.sentiment} IS NULL AND ${t.primaryCategory} IS NULL AND ${t.attention} IS NULL)
      )`,
    ),
    check('ai_review_analyses_retention_valid', sql`${t.expiresAt} > ${t.generatedAt}`),
    index('ai_review_analyses_current_idx').on(
      t.organizationId,
      t.propertyId,
      t.reviewId,
      t.sourceEpoch,
      t.sourceRevision,
      t.analysisSequence,
    ),
    index('ai_review_analyses_expiry_idx').on(t.expiresAt),
  ],
)

export const aiPropertyAggregateContributions = pgTable(
  'ai_property_aggregate_contributions',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    calendarProfileVersion: varchar('calendar_profile_version', { length: 100 })
      .notNull()
      .references(() => aiPropertyCalendarAuthorities.profileVersion, {
        onDelete: 'restrict',
      }),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    rating: integer('rating').notNull(),
    sentiment: varchar('sentiment', { length: 20 }),
    primaryCategory: varchar('primary_category', { length: 40 }),
    attention: varchar('attention', { length: 20 }),
    appliedAggregateRevision: bigint('applied_aggregate_revision', {
      mode: 'number',
    }).notNull(),
    appliedAt: timestamptz('applied_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.reviewId,
        t.sourceEpoch,
        t.sourceRevision,
        t.analysisSequence,
      ],
      name: 'ai_property_aggregate_contributions_pk',
    }),
    foreignKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.reviewId,
        t.sourceEpoch,
        t.sourceRevision,
        t.analysisSequence,
      ],
      foreignColumns: [
        aiReviewAnalyses.organizationId,
        aiReviewAnalyses.propertyId,
        aiReviewAnalyses.reviewId,
        aiReviewAnalyses.sourceEpoch,
        aiReviewAnalyses.sourceRevision,
        aiReviewAnalyses.analysisSequence,
      ],
      name: 'ai_property_aggregate_contributions_analysis_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_aggregate_contributions_values_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.sourceRevision} BETWEEN 1 AND '9007199254740991'::bigint AND ${t.analysisSequence} BETWEEN 1 AND '9007199254740991'::bigint AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.propertyProfileVersion} >= 1 AND ${t.rating} BETWEEN 1 AND 5 AND ${t.appliedAggregateRevision} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    check(
      'ai_property_aggregate_contributions_result_valid',
      sql`(
        (${t.status} = 'ready' AND ${t.sentiment} IN ('positive', 'neutral', 'negative', 'mixed') AND ${t.primaryCategory} IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other') AND ${t.attention} IN ('urgent', 'high', 'medium', 'low'))
        OR (${t.status} = 'unavailable' AND ${t.sentiment} IS NULL AND ${t.primaryCategory} IS NULL AND ${t.attention} IS NULL)
      )`,
    ),
    index('ai_property_aggregate_contributions_date_idx').on(
      t.organizationId,
      t.propertyId,
      t.localDate,
      t.sourceEpoch,
      t.reviewAnalysisEpoch,
    ),
  ],
)

export const aiPropertyAggregateHeads = pgTable(
  'ai_property_aggregate_heads',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    aggregateRevision: bigint('aggregate_revision', { mode: 'number' }).notNull(),
    terminalAnalysisSequence: bigint('terminal_analysis_sequence', {
      mode: 'number',
    }).notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.sourceEpoch,
        t.reviewAnalysisEpoch,
        t.propertyProfileVersion,
      ],
      name: 'ai_property_aggregate_heads_pk',
    }),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_property_aggregate_heads_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_aggregate_heads_versions_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.propertyProfileVersion} >= 1 AND ${t.aggregateRevision} BETWEEN 0 AND '9007199254740991'::bigint AND ${t.terminalAnalysisSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    index('ai_property_aggregate_heads_current_idx').on(
      t.organizationId,
      t.propertyId,
      t.sourceEpoch,
      t.reviewAnalysisEpoch,
      t.propertyProfileVersion,
    ),
  ],
)

export const aiPropertyDailyAggregates = pgTable(
  'ai_property_daily_aggregates',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    calendarProfileVersion: varchar('calendar_profile_version', { length: 100 })
      .notNull()
      .references(() => aiPropertyCalendarAuthorities.profileVersion, {
        onDelete: 'restrict',
      }),
    aggregateRevision: bigint('aggregate_revision', { mode: 'number' }).notNull(),
    terminalAnalysisSequence: bigint('terminal_analysis_sequence', {
      mode: 'number',
    }).notNull(),
    reviewCount: integer('review_count').notNull(),
    ratingSum: integer('rating_sum').notNull(),
    positiveCount: integer('positive_count').notNull(),
    neutralCount: integer('neutral_count').notNull(),
    negativeCount: integer('negative_count').notNull(),
    mixedCount: integer('mixed_count').notNull(),
    serviceCount: integer('service_count').notNull(),
    staffCount: integer('staff_count').notNull(),
    qualityCount: integer('quality_count').notNull(),
    valueCount: integer('value_count').notNull(),
    cleanlinessCount: integer('cleanliness_count').notNull(),
    waitTimeCount: integer('wait_time_count').notNull(),
    atmosphereCount: integer('atmosphere_count').notNull(),
    locationCount: integer('location_count').notNull(),
    accessibilityCount: integer('accessibility_count').notNull(),
    otherCount: integer('other_count').notNull(),
    urgentCount: integer('urgent_count').notNull(),
    highCount: integer('high_count').notNull(),
    mediumCount: integer('medium_count').notNull(),
    lowCount: integer('low_count').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.localDate,
        t.sourceEpoch,
        t.reviewAnalysisEpoch,
        t.propertyProfileVersion,
      ],
      name: 'ai_property_daily_aggregates_pk',
    }),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_property_daily_aggregates_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_daily_aggregates_versions_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.propertyProfileVersion} >= 1 AND ${t.aggregateRevision} BETWEEN 0 AND '9007199254740991'::bigint AND ${t.terminalAnalysisSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'ai_property_daily_aggregates_counts_nonnegative',
      sql`${t.reviewCount} >= 0 AND ${t.ratingSum} >= 0 AND ${t.positiveCount} >= 0 AND ${t.neutralCount} >= 0 AND ${t.negativeCount} >= 0 AND ${t.mixedCount} >= 0 AND ${t.serviceCount} >= 0 AND ${t.staffCount} >= 0 AND ${t.qualityCount} >= 0 AND ${t.valueCount} >= 0 AND ${t.cleanlinessCount} >= 0 AND ${t.waitTimeCount} >= 0 AND ${t.atmosphereCount} >= 0 AND ${t.locationCount} >= 0 AND ${t.accessibilityCount} >= 0 AND ${t.otherCount} >= 0 AND ${t.urgentCount} >= 0 AND ${t.highCount} >= 0 AND ${t.mediumCount} >= 0 AND ${t.lowCount} >= 0`,
    ),
    check(
      'ai_property_daily_aggregates_count_sums_valid',
      sql`${t.positiveCount} + ${t.neutralCount} + ${t.negativeCount} + ${t.mixedCount} = ${t.reviewCount} AND ${t.serviceCount} + ${t.staffCount} + ${t.qualityCount} + ${t.valueCount} + ${t.cleanlinessCount} + ${t.waitTimeCount} + ${t.atmosphereCount} + ${t.locationCount} + ${t.accessibilityCount} + ${t.otherCount} = ${t.reviewCount} AND ${t.urgentCount} + ${t.highCount} + ${t.mediumCount} + ${t.lowCount} = ${t.reviewCount} AND ${t.ratingSum} <= ${t.reviewCount} * 5`,
    ),
    index('ai_property_daily_aggregates_window_idx').on(
      t.organizationId,
      t.propertyId,
      t.sourceEpoch,
      t.reviewAnalysisEpoch,
      t.localDate,
    ),
  ],
)

export const aiPropertyTrendSchedulerHeads = pgTable(
  'ai_property_trend_scheduler_heads',
  {
    schedulerKey: varchar('scheduler_key', { length: 64 }).primaryKey(),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    cursorOrganizationId: varchar('cursor_organization_id', { length: 255 }),
    cursorPropertyId: uuid('cursor_property_id'),
    leaseOwner: uuid('lease_owner'),
    claimedAt: timestamptz('claimed_at'),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    check(
      'ai_property_trend_scheduler_heads_valid',
      sql`${t.schedulerKey} = 'property-trend-v1' AND ${t.generation} BETWEEN 0 AND '9007199254740991'::bigint
        AND ((${t.cursorOrganizationId} IS NULL AND ${t.cursorPropertyId} IS NULL) OR (${t.cursorOrganizationId} IS NOT NULL AND ${t.cursorPropertyId} IS NOT NULL))
        AND ((${t.leaseOwner} IS NULL AND ${t.claimedAt} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.leaseOwner} IS NOT NULL AND ${t.claimedAt} IS NOT NULL AND ${t.leaseExpiresAt} > ${t.claimedAt}))`,
    ),
  ],
)

export const aiPropertyTrendSchedules = pgTable(
  'ai_property_trend_schedules',
  {
    id: uuid('id').primaryKey(),
    outboxEventId: uuid('outbox_event_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    dueLocalDate: date('due_local_date', { mode: 'string' }).notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    propertyTrendsEpoch: integer('property_trends_epoch').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    terminalAnalysisSequence: bigint('terminal_analysis_sequence', {
      mode: 'number',
    }).notNull(),
    aggregateRevision: bigint('aggregate_revision', { mode: 'number' }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    calendarProfileVersion: varchar('calendar_profile_version', { length: 100 })
      .notNull()
      .references(() => aiPropertyCalendarAuthorities.profileVersion, {
        onDelete: 'restrict',
      }),
    reportProfileVersion: varchar('report_profile_version', { length: 100 })
      .notNull()
      .references(() => aiOperationProfiles.profileVersion, { onDelete: 'restrict' }),
    schedulerGeneration: bigint('scheduler_generation', { mode: 'number' }).notNull(),
    scheduledAt: timestamptz('scheduled_at').notNull(),
  },
  (t) => [
    uniqueIndex('ai_property_trend_schedules_outbox_unique').on(t.outboxEventId),
    uniqueIndex('ai_property_trend_schedules_generation_unique').on(
      t.organizationId,
      t.propertyId,
      t.dueLocalDate,
      t.sourceEpoch,
      t.reviewAnalysisEpoch,
      t.propertyTrendsEpoch,
      t.propertyProfileVersion,
      t.reportProfileVersion,
    ),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_property_trend_schedules_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_trend_schedules_versions_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.propertyTrendsEpoch} >= 1
        AND ${t.propertyProfileVersion} >= 1 AND ${t.terminalAnalysisSequence} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.aggregateRevision} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.schedulerGeneration} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.timezone} ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'`,
    ),
    index('ai_property_trend_schedules_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.dueLocalDate.desc(),
    ),
  ],
)

export const aiPropertyTrendOutcomes = pgTable(
  'ai_property_trend_outcomes',
  {
    scheduleId: uuid('schedule_id')
      .primaryKey()
      .references(() => aiPropertyTrendSchedules.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    disposition: varchar('disposition', { length: 32 }).notNull(),
    operationId: uuid('operation_id').references(() => aiOperations.id, {
      onDelete: 'restrict',
    }),
    selectedSignalIds: jsonb('selected_signal_ids').$type<readonly string[]>(),
    signalKey: varchar('signal_key', { length: 64 }),
    direction: varchar('direction', { length: 20 }),
    confidenceBasisPoints: integer('confidence_basis_points'),
    supportingReviewCount: integer('supporting_review_count'),
    headline: varchar('headline', { length: 80 }),
    sentences: jsonb('sentences').$type<readonly string[]>(),
    summary: text('summary'),
    renderProfileVersion: varchar('render_profile_version', { length: 100 }),
    renderProfileDigest: varchar('render_profile_digest', { length: 64 }),
    providerSelectionRecordedAt: timestamptz('provider_selection_recorded_at'),
    recordedAt: timestamptz('recorded_at').notNull(),
    expiresAt: timestamptz('expires_at'),
  },
  (t) => [
    uniqueIndex('ai_property_trend_outcomes_operation_unique')
      .on(t.operationId)
      .where(sql`${t.operationId} IS NOT NULL`),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_property_trend_outcomes_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_trend_outcomes_valid',
      sql`(
        ${t.disposition} = 'ready'
        AND ${t.operationId} IS NOT NULL
        AND jsonb_typeof(${t.selectedSignalIds}) = 'array'
        AND jsonb_array_length(${t.selectedSignalIds}) BETWEEN 1 AND 4
        AND ${t.signalKey} ~ '^[a-z][a-z0-9_.]{2,63}$'
        AND ${t.direction} IN ('improving', 'stable', 'declining')
        AND ${t.confidenceBasisPoints} BETWEEN 0 AND 10000
        AND ${t.supportingReviewCount} >= 0
        AND ${t.headline} IN ('Review signals improved', 'Review signals need attention', 'Notable review changes')
        AND jsonb_typeof(${t.sentences}) = 'array'
        AND jsonb_array_length(${t.sentences}) BETWEEN 1 AND 4
        AND length(${t.summary}) BETWEEN 1 AND 1000
        AND ${t.renderProfileVersion} = 'trend-render-v1'
        AND ${t.renderProfileDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.providerSelectionRecordedAt} IS NOT NULL
        AND ${t.recordedAt} = ${t.providerSelectionRecordedAt}
        AND ${t.expiresAt} > ${t.recordedAt}
      ) OR (
        ${t.disposition} IN ('insufficient_data', 'no_material_change')
        AND ${t.operationId} IS NULL
        AND ${t.selectedSignalIds} IS NULL
        AND ${t.signalKey} IS NULL
        AND ${t.direction} IS NULL
        AND ${t.confidenceBasisPoints} IS NULL
        AND ${t.supportingReviewCount} IS NULL
        AND ${t.headline} IS NULL
        AND ${t.sentences} IS NULL
        AND ${t.summary} IS NULL
        AND ${t.renderProfileVersion} IS NULL
        AND ${t.renderProfileDigest} IS NULL
        AND ${t.providerSelectionRecordedAt} IS NULL
        AND ${t.expiresAt} IS NULL
      )`,
    ),
    index('ai_property_trend_outcomes_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.recordedAt.desc(),
    ),
    index('ai_property_trend_outcomes_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
)
