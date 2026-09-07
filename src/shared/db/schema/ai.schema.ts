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
import { properties } from './property.schema'
import { materialReviewRevisions, reviews } from './review.schema'
import { merchantAiConsentEvidence } from './merchant-ai-authorization.schema'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const aiPropertyProcessingProfiles = pgTable(
  'ai_property_processing_profiles',
  {
    propertyId: uuid('property_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    processingRegion: varchar('processing_region', { length: 20 }).notNull(),
    routingPolicyVersion: integer('routing_policy_version').notNull(),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    }).notNull(),
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
    sourceDigest: varchar('source_digest', { length: 64 }).notNull(),
    sourceByteCount: integer('source_byte_count').notNull(),
    command: varchar('command', { length: 32 }).notNull(),
    capability: varchar('capability', { length: 40 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
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
    authorizationLineageId: uuid('authorization_lineage_id'),
    noticeVersion: varchar('notice_version', { length: 100 }),
    noticeDigest: varchar('notice_digest', { length: 64 }),
    evaluatedLanguage: varchar('evaluated_language', { length: 35 }),
    concreteReplyLanguageTag: varchar('concrete_reply_language_tag', { length: 35 }),
    concreteReplyTemplateGroup: varchar('concrete_reply_template_group', { length: 64 }),
    languageCatalogueDigest: varchar('language_catalogue_digest', { length: 64 }),
    replyLanguageVerifierDigest: varchar('reply_language_verifier_digest', { length: 64 }),
    languageScriptConsistencyDigest: varchar('language_script_consistency_digest', { length: 64 }),
    zhOrthographyVerifierDigest: varchar('zh_orthography_verifier_digest', { length: 64 }),
    propertyProfileVersion: integer('property_profile_version'),
    replyBrandProfileVersion: integer('reply_brand_profile_version'),
    replyBrandDisplayNameDigest: varchar('reply_brand_display_name_digest', { length: 64 }),
    routingPolicyVersion: integer('routing_policy_version'),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    }).notNull(),
    operationProfileVersion: varchar('operation_profile_version', {
      length: 100,
    }).notNull(),
    capabilityRuntimeProfileVersion: varchar('capability_runtime_profile_version', {
      length: 100,
    }),
    sourcePolicyId: varchar('source_policy_id', { length: 150 }),
    sourceCanonicalizerDigest: varchar('source_canonicalizer_digest', { length: 64 }),
    redactionProfileVersion: varchar('redaction_profile_version', { length: 100 }),
    outputLeakageProfileVersion: varchar('output_leakage_profile_version', { length: 100 }),
    outputLeakageProfileDigest: varchar('output_leakage_profile_digest', { length: 64 }),
    replyTemplateCatalogueVersion: varchar('reply_template_catalogue_version', { length: 100 }),
    replyTemplateCatalogueDigest: varchar('reply_template_catalogue_digest', { length: 64 }),
    globalControlId: uuid('global_control_id').notNull(),
    globalControlGeneration: integer('global_control_generation').notNull(),
    providerControlId: uuid('provider_control_id').notNull(),
    providerControlGeneration: integer('provider_control_generation').notNull(),
    capabilityControlId: uuid('capability_control_id').notNull(),
    capabilityControlGeneration: integer('capability_control_generation').notNull(),
    capabilityFences: jsonb('capability_fences').notNull(),
    routeKey: varchar('route_key', { length: 64 }),
    executionPermitId: uuid('execution_permit_id'),
    admissionNonce: varchar('admission_nonce', { length: 64 }),
    requestBindingKeyId: varchar('request_binding_key_id', { length: 64 }),
    requestBindingHmac: varchar('request_binding_hmac', { length: 43 }),
    grantKid: varchar('grant_kid', { length: 32 }),
    costWindowId: uuid('cost_window_id'),
    reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull().default(0),
    actualMicros: bigint('actual_micros', { mode: 'number' }),
    budgetReservedAt: timestamptz('budget_reserved_at'),
    budgetSettledAt: timestamptz('budget_settled_at'),
    state: varchar('state', { length: 40 }).notNull(),
    executionAttempt: integer('execution_attempt').notNull(),
    nextAttemptAt: timestamptz('next_attempt_at'),
    failureCode: varchar('failure_code', { length: 64 }),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    deliveredAt: timestamptz('delivered_at'),
    replyAdoptionDisposition: varchar('reply_adoption_disposition', { length: 20 })
      .notNull()
      .default('none'),
    adoptedReplyRevision: bigint('adopted_reply_revision', { mode: 'number' }),
    adoptedReviewReplyStateRevision: bigint('adopted_review_reply_state_revision', {
      mode: 'number',
    }),
  },
  (t) => [
    uniqueIndex('ai_operations_idempotency_unique').on(t.idempotencyScope, t.idempotencyKey),
    uniqueIndex('ai_operations_execution_permit_unique')
      .on(t.executionPermitId)
      .where(sql`${t.executionPermitId} IS NOT NULL`),
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
    check('ai_operations_fingerprint_valid', sql`${t.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      'ai_operations_source_provenance_valid',
      sql`${t.sourceDigest} ~ '^[0-9a-f]{64}$' AND ${t.sourceByteCount} BETWEEN 1 AND 131072`,
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
      'ai_operations_budget_valid',
      sql`${t.reservedMicros} BETWEEN 0 AND '9007199254740991'::bigint
        AND (${t.actualMicros} IS NULL OR ${t.actualMicros} BETWEEN 0 AND ${t.reservedMicros})
        AND ((${t.costWindowId} IS NULL AND ${t.reservedMicros} = 0 AND ${t.budgetReservedAt} IS NULL)
          OR (${t.costWindowId} IS NOT NULL AND ${t.reservedMicros} > 0 AND ${t.budgetReservedAt} IS NOT NULL))
        AND ((${t.budgetSettledAt} IS NULL AND ${t.actualMicros} IS NULL)
          OR (${t.budgetSettledAt} IS NOT NULL AND ${t.actualMicros} IS NOT NULL AND ${t.budgetSettledAt} >= ${t.budgetReservedAt}))`,
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
        (${t.command} = 'analysis' AND ${t.capability} = 'review_analysis' AND ${t.actorUserId} IS NULL AND ${t.systemPrincipal} = 'review_event_consumer' AND ${t.reviewId} IS NOT NULL AND ${t.originEventId} IS NOT NULL AND ${t.subjectHmac} ~ '^[0-9a-f]{64}$' AND ${t.subjectHmacKeyVersion} IS NOT NULL AND ${t.sourceEpoch} >= 0 AND ${t.sourceRevision} >= 1 AND ${t.analysisSequence} >= 1)
        OR (${t.command} = 'reply' AND ${t.capability} = 'reply_drafting' AND ${t.actorUserId} IS NOT NULL AND ${t.systemPrincipal} IS NULL AND ${t.reviewId} IS NOT NULL AND ${t.sourceEpoch} >= 0 AND ${t.sourceRevision} >= 1 AND ${t.tone} IN ('professional', 'friendly', 'casual') AND ${t.baseReplyStateRevision} >= 0)
        OR (${t.command} = 'trend' AND ${t.capability} = 'property_trends' AND ${t.actorUserId} IS NULL AND ${t.systemPrincipal} = 'property_trend_coordinator' AND ${t.sourceEpoch} >= 0 AND ${t.dueLocalDate} IS NOT NULL AND ${t.terminalAnalysisSequence} >= 0 AND ${t.aggregateRevision} >= 0)
      )`,
    ),
    check(
      'ai_operations_reply_brand_binding_valid',
      sql`((${t.command} = 'reply' AND ((${t.replyBrandProfileVersion} IS NULL AND ${t.replyBrandDisplayNameDigest} IS NULL) OR (${t.replyBrandProfileVersion} >= 1 AND ${t.replyBrandDisplayNameDigest} ~ '^[0-9a-f]{64}$')))
        OR (${t.command} <> 'reply' AND ${t.replyBrandProfileVersion} IS NULL AND ${t.replyBrandDisplayNameDigest} IS NULL))`,
    ),
    check(
      'ai_operations_reply_adoption_valid',
      sql`((${t.command} = 'reply' AND ${t.replyAdoptionDisposition} IN ('none', 'adopted', 'invalidated')
          AND ((${t.replyAdoptionDisposition} = 'none' AND ${t.adoptedReplyRevision} IS NULL AND ${t.adoptedReviewReplyStateRevision} IS NULL)
            OR (${t.replyAdoptionDisposition} = 'adopted' AND ${t.adoptedReplyRevision} >= 1 AND ${t.adoptedReviewReplyStateRevision} >= 1)
            OR (${t.replyAdoptionDisposition} = 'invalidated' AND ((${t.adoptedReplyRevision} IS NULL AND ${t.adoptedReviewReplyStateRevision} IS NULL) OR (${t.adoptedReplyRevision} >= 1 AND ${t.adoptedReviewReplyStateRevision} >= 1)))))
        OR (${t.command} <> 'reply' AND ${t.replyAdoptionDisposition} = 'none' AND ${t.adoptedReplyRevision} IS NULL AND ${t.adoptedReviewReplyStateRevision} IS NULL))`,
    ),
    check(
      'ai_operations_control_fence_valid',
      sql`${t.globalControlGeneration} >= 1 AND ${t.providerControlGeneration} >= 1
        AND ${t.capabilityControlGeneration} >= 1 AND jsonb_typeof(${t.capabilityFences}) = 'object'`,
    ),
    index('ai_operations_due_idx').on(t.state, t.nextAttemptAt),
    index('ai_operations_property_idx').on(t.organizationId, t.propertyId, t.createdAt.desc()),
    index('ai_operations_expiry_idx').on(t.expiresAt),
    index('ai_operations_stale_reservation_idx')
      .on(t.budgetReservedAt)
      .where(sql`${t.budgetSettledAt} IS NULL AND ${t.reservedMicros} > 0`),
  ],
)

export const aiOrganizationCostWindows = pgTable(
  'ai_organization_cost_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    windowStart: timestamptz('window_start').notNull(),
    reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull().default(0),
    settledMicros: bigint('settled_micros', { mode: 'number' }).notNull().default(0),
    capMicros: bigint('cap_micros', { mode: 'number' }).notNull().default(50_000_000),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ai_organization_cost_windows_month_unique').on(
      t.organizationId,
      t.windowStart,
    ),
    check(
      'ai_organization_cost_windows_valid',
      sql`${t.reservedMicros} BETWEEN 0 AND ${t.capMicros}
        AND ${t.settledMicros} BETWEEN 0 AND ${t.capMicros}
        AND ${t.reservedMicros} + ${t.settledMicros} <= ${t.capMicros}
        AND ${t.capMicros} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.windowStart} = date_trunc('month', ${t.windowStart})`,
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
    analysisProfileVersion: varchar('analysis_profile_version', { length: 100 }).notNull(),
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
    foreignKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.reviewId,
        t.sourceEpoch,
        t.sourceRevision,
      ],
      foreignColumns: [
        materialReviewRevisions.organizationId,
        materialReviewRevisions.propertyId,
        materialReviewRevisions.reviewId,
        materialReviewRevisions.sourceEpoch,
        materialReviewRevisions.revision,
      ],
      name: 'ai_review_analyses_material_review_revision_fk',
    })
      .onDelete('restrict')
      .onUpdate('no action'),
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
    calendarProfileVersion: varchar('calendar_profile_version', {
      length: 100,
    }).notNull(),
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
    calendarProfileVersion: varchar('calendar_profile_version', {
      length: 100,
    }).notNull(),
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
    calendarProfileVersion: varchar('calendar_profile_version', {
      length: 100,
    }).notNull(),
    reportProfileVersion: varchar('report_profile_version', {
      length: 100,
    }).notNull(),
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
      t.terminalAnalysisSequence,
      t.aggregateRevision,
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
    definitionVersion: varchar('definition_version', { length: 100 }),
    definitionDigest: varchar('definition_digest', { length: 64 }),
    evidence: jsonb('evidence').$type<Readonly<Record<string, unknown>>>(),
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
        AND (${t.operationId} IS NOT NULL OR ${t.providerSelectionRecordedAt} IS NULL)
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
        AND (
          (${t.definitionVersion} IS NULL AND ${t.definitionDigest} IS NULL AND ${t.evidence} IS NULL)
          OR (${t.definitionVersion} = 'property-trend-definition-v1'
            AND ${t.definitionDigest} ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof(${t.evidence}) = 'object')
        )
        AND (
          (${t.operationId} IS NOT NULL
            AND ${t.providerSelectionRecordedAt} IS NOT NULL
            AND ${t.recordedAt} = ${t.providerSelectionRecordedAt})
          OR (${t.operationId} IS NULL AND ${t.providerSelectionRecordedAt} IS NULL)
        )
        AND ${t.expiresAt} > ${t.recordedAt}
      ) OR (
        ${t.disposition} IN ('updating', 'insufficient_data', 'no_material_change')
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
        AND (
          (${t.definitionVersion} IS NULL AND ${t.definitionDigest} IS NULL AND ${t.evidence} IS NULL AND ${t.expiresAt} IS NULL)
          OR (${t.definitionVersion} = 'property-trend-definition-v1'
            AND ${t.definitionDigest} ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof(${t.evidence}) = 'object'
            AND ${t.expiresAt} > ${t.recordedAt})
        )
        AND ${t.providerSelectionRecordedAt} IS NULL
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

/**
 * Enrollment head retained because the live sweep exposes first-enablement
 * readiness. Snapshot membership and replay machinery live in process now.
 */
export const aiReviewAnalysisEnrollments = pgTable(
  'ai_review_analysis_enrollments',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    authorizationLineageId: uuid('authorization_lineage_id').notNull(),
    authorizationStateVersion: integer('authorization_state_version').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    analysisStartSequence: bigint('analysis_start_sequence', {
      mode: 'number',
    }).notNull(),
    providerDeploymentProfileVersion: varchar('provider_deployment_profile_version', {
      length: 100,
    }).notNull(),
    triggerEventEnvelopeId: uuid('trigger_event_envelope_id').notNull(),
    state: varchar('state', { length: 32 }).notNull(),
    snapshotRevisionCount: bigint('snapshot_revision_count', {
      mode: 'number',
    }).notNull(),
    snapshotRevisionSetDigest: varchar('snapshot_revision_set_digest', {
      length: 64,
    }).notNull(),
    snapshotCapturedAt: timestamptz('snapshot_captured_at').notNull(),
    safetyCeiling: integer('safety_ceiling').default(10_000).notNull(),
    assistedApprovalRequired: boolean('assisted_approval_required')
      .default(false)
      .notNull(),
    assistedApprovedAt: timestamptz('assisted_approved_at'),
    assistedApprovedBy: varchar('assisted_approved_by', { length: 255 }),
    assistedApprovalEvidenceDigest: varchar('assisted_approval_evidence_digest', {
      length: 64,
    }),
    assistedApprovalCorrelationId: uuid('assisted_approval_correlation_id'),
    enrolledRevisionCount: bigint('enrolled_revision_count', { mode: 'number' })
      .default(0)
      .notNull(),
    caughtUpEligibleRevisionCount: bigint('caught_up_eligible_revision_count', {
      mode: 'number',
    }),
    caughtUpAnalysisSequence: bigint('caught_up_analysis_sequence', {
      mode: 'number',
    }),
    caughtUpRevisionSetDigest: varchar('caught_up_revision_set_digest', {
      length: 64,
    }),
    caughtUpAt: timestamptz('caught_up_at'),
    terminalReason: varchar('terminal_reason', { length: 64 }),
    terminalAt: timestamptz('terminal_at'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_review_analysis_enrollments_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [
        t.authorizationLineageId,
        t.authorizationStateVersion,
        t.organizationId,
        t.propertyId,
      ],
      foreignColumns: [
        merchantAiConsentEvidence.authorizationLineageId,
        merchantAiConsentEvidence.stateVersion,
        merchantAiConsentEvidence.organizationId,
        merchantAiConsentEvidence.propertyId,
      ],
      name: 'ai_review_analysis_enrollments_authorization_fk',
    }).onDelete('restrict'),
    uniqueIndex('ai_review_analysis_enrollments_scope_unique').on(
      t.id,
      t.organizationId,
      t.propertyId,
    ),
    uniqueIndex('ai_review_analysis_enrollments_fence_unique').on(
      t.organizationId,
      t.propertyId,
      t.authorizationLineageId,
      t.authorizationStateVersion,
      t.sourceEpoch,
      t.reviewAnalysisEpoch,
      t.analysisStartSequence,
    ),
    uniqueIndex('ai_review_analysis_enrollments_trigger_unique').on(
      t.triggerEventEnvelopeId,
    ),
    uniqueIndex('ai_review_analysis_enrollments_one_active')
      .on(t.organizationId, t.propertyId)
      .where(sql`${t.state} IN ('awaiting_assisted_approval', 'queued', 'running')`),
    index('ai_review_analysis_enrollments_actionable_idx')
      .on(t.createdAt, t.id)
      .where(sql`${t.state} IN ('queued', 'running')`),
    index('ai_review_analysis_enrollments_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.createdAt.desc(),
    ),
    check(
      'ai_review_analysis_enrollments_state_valid',
      sql`${t.state} IN ('awaiting_assisted_approval', 'queued', 'running', 'caught_up', 'superseded', 'stalled')`,
    ),
    check(
      'ai_review_analysis_enrollments_fence_safe',
      sql`${t.authorizationStateVersion} BETWEEN 1 AND 2147483647
        AND ${t.sourceEpoch} BETWEEN 0 AND 2147483647
        AND ${t.reviewAnalysisEpoch} BETWEEN 1 AND 2147483647
        AND ${t.analysisStartSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'ai_review_analysis_enrollments_snapshot_valid',
      sql`${t.snapshotRevisionCount} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.snapshotRevisionSetDigest} ~ '^[0-9a-f]{64}$'
        AND (
          (${t.snapshotRevisionCount} = 0 AND ${t.snapshotRevisionSetDigest} = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
          OR (${t.snapshotRevisionCount} > 0 AND ${t.snapshotRevisionSetDigest} <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        )
        AND ${t.enrolledRevisionCount} BETWEEN 0 AND ${t.snapshotRevisionCount}`,
    ),
    check(
      'ai_review_analysis_enrollments_assisted_approval_valid',
      sql`${t.safetyCeiling} = 10000
        AND ${t.assistedApprovalRequired} = (${t.snapshotRevisionCount} > ${t.safetyCeiling})
        AND (
          (${t.assistedApprovedAt} IS NULL
            AND ${t.assistedApprovedBy} IS NULL
            AND ${t.assistedApprovalEvidenceDigest} IS NULL
            AND ${t.assistedApprovalCorrelationId} IS NULL)
          OR (${t.assistedApprovalRequired}
            AND ${t.assistedApprovedAt} IS NOT NULL
            AND length(${t.assistedApprovedBy}) BETWEEN 1 AND 255
            AND btrim(${t.assistedApprovedBy}) = ${t.assistedApprovedBy}
            AND ${t.assistedApprovalEvidenceDigest} ~ '^[0-9a-f]{64}$'
            AND ${t.assistedApprovalCorrelationId} IS NOT NULL)
        )
        AND (
          (${t.state} = 'awaiting_assisted_approval'
            AND ${t.assistedApprovalRequired}
            AND ${t.assistedApprovedAt} IS NULL)
          OR (${t.state} IN ('queued', 'running', 'caught_up')
            AND (NOT ${t.assistedApprovalRequired} OR ${t.assistedApprovedAt} IS NOT NULL))
          OR ${t.state} IN ('superseded', 'stalled')
        )`,
    ),
    check(
      'ai_review_analysis_enrollments_terminal_valid',
      sql`(
        ${t.state} IN ('awaiting_assisted_approval', 'queued', 'running')
        AND ${t.caughtUpEligibleRevisionCount} IS NULL
        AND ${t.caughtUpAnalysisSequence} IS NULL
        AND ${t.caughtUpRevisionSetDigest} IS NULL
        AND ${t.caughtUpAt} IS NULL
        AND ${t.terminalReason} IS NULL
        AND ${t.terminalAt} IS NULL
      ) OR (
        ${t.state} = 'caught_up'
        AND ${t.caughtUpEligibleRevisionCount} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.caughtUpAnalysisSequence} BETWEEN ${t.analysisStartSequence} AND '9007199254740991'::bigint
        AND ${t.caughtUpRevisionSetDigest} ~ '^[0-9a-f]{64}$'
        AND (
          (${t.caughtUpEligibleRevisionCount} = 0 AND ${t.caughtUpRevisionSetDigest} = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
          OR (${t.caughtUpEligibleRevisionCount} > 0 AND ${t.caughtUpRevisionSetDigest} <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        )
        AND ${t.caughtUpAt} IS NOT NULL
        AND ${t.terminalReason} = 'eligible_revision_set_caught_up'
        AND ${t.terminalAt} = ${t.caughtUpAt}
      ) OR (
        ${t.state} IN ('superseded', 'stalled')
        AND ${t.caughtUpEligibleRevisionCount} IS NULL
        AND ${t.caughtUpAnalysisSequence} IS NULL
        AND ${t.caughtUpRevisionSetDigest} IS NULL
        AND ${t.caughtUpAt} IS NULL
        AND ${t.terminalReason} ~ '^[a-z][a-z0-9_]{2,63}$'
        AND ${t.terminalAt} IS NOT NULL
      )`,
    ),
    check(
      'ai_review_analysis_enrollments_time_valid',
      sql`${t.snapshotCapturedAt} >= ${t.createdAt}
        AND ${t.updatedAt} >= ${t.createdAt}
        AND (${t.caughtUpAt} IS NULL OR ${t.caughtUpAt} >= ${t.snapshotCapturedAt})
        AND (${t.assistedApprovedAt} IS NULL OR ${t.assistedApprovedAt} >= ${t.snapshotCapturedAt})
        AND (${t.terminalAt} IS NULL OR ${t.terminalAt} >= ${t.snapshotCapturedAt})`,
    ),
  ],
)

