import { createHash } from 'node:crypto'

const GUEST_RESPONSE_RECONCILIATION_VERSION =
  'repkey-guest-response-reconciliation-2' as const

export const GUEST_RESPONSE_RECONCILIATION_REASON_CODES = [
  'legacy_rating_matches_canonical',
  'legacy_rating_can_map',
  'legacy_rating_invalid_value_or_source',
  'legacy_rating_portal_missing',
  'legacy_rating_scope_conflict',
  'legacy_rating_canonical_conflict',
  'legacy_feedback_matches_canonical',
  'legacy_feedback_can_map_by_rating_id',
  'legacy_feedback_can_map_by_unique_session',
  'legacy_feedback_without_rating',
  'legacy_feedback_rating_missing',
  'legacy_feedback_rating_scope_conflict',
  'legacy_feedback_session_conflict',
  'legacy_feedback_multiple_rating_candidates',
  'legacy_feedback_invalid_source',
  'legacy_feedback_portal_missing',
  'legacy_feedback_scope_conflict',
  'legacy_experience_snapshot_unknown',
  'legacy_active_session_duplicate',
  'canonical_active_session_duplicate',
  'legacy_inbox_link_exact',
  'legacy_inbox_link_missing',
  'legacy_inbox_link_scope_conflict',
  'legacy_retention_exact',
  'legacy_session_retention_overdue',
  'legacy_network_pseudonym_retained',
  'canonical_experience_snapshot_exact',
  'canonical_experience_snapshot_missing',
  'canonical_publication_snapshot_unknown',
  'canonical_threshold_snapshot_unknown',
  'canonical_threshold_snapshot_conflict',
  'canonical_rating_lineage_exact',
  'canonical_rating_source_missing',
  'canonical_rating_source_conflict',
  'canonical_rating_correction_identity_missing',
  'canonical_rating_retraction_identity_missing',
  'canonical_rating_lineage_target_missing',
  'canonical_rating_lineage_branch_conflict',
  'canonical_feedback_lineage_exact',
  'canonical_feedback_source_missing',
  'canonical_feedback_source_conflict',
  'canonical_feedback_correction_identity_missing',
  'canonical_feedback_retraction_identity_missing',
  'canonical_feedback_lineage_target_missing',
  'canonical_feedback_lineage_branch_conflict',
  'canonical_integrity_history_exact',
  'canonical_integrity_history_missing',
  'canonical_integrity_history_conflict',
  'canonical_withdrawal_state_exact',
  'canonical_withdrawal_state_conflict',
  'canonical_media_state_exact',
  'canonical_media_active_while_beta_blocked',
  'canonical_media_terminal_response_conflict',
  'canonical_contact_state_exact',
  'canonical_contact_active_while_beta_blocked',
  'canonical_contact_retention_overdue',
  'canonical_contact_terminal_response_conflict',
  'canonical_inbox_link_exact',
  'canonical_inbox_link_missing',
  'canonical_inbox_link_duplicate',
  'canonical_inbox_link_scope_conflict',
  'canonical_withdrawn_inbox_open',
  'canonical_retention_exact',
  'canonical_response_retention_overdue',
  'canonical_response_retention_invalid',
  'canonical_session_retention_overdue',
  'canonical_session_retention_invalid',
  'canonical_feedback_retention_overdue',
  'canonical_feedback_retention_invalid',
  'canonical_feedback_content_missing_before_expiry',
  'canonical_fact_evidence_exact',
  'canonical_fact_payload_invalid',
  'canonical_fact_schema_version_unknown',
  'canonical_fact_response_missing',
  'canonical_fact_scope_conflict',
  'canonical_fact_source_aggregate_conflict',
  'canonical_fact_business_time_conflict',
  'canonical_fact_staff_attribution_unknown',
  'canonical_fact_staff_attribution_conflict',
  'canonical_feedback_revision_unknown',
  'canonical_feedback_revision_conflict',
] as const

export type GuestResponseReconciliationReasonCode =
  (typeof GUEST_RESPONSE_RECONCILIATION_REASON_CODES)[number]

export type GuestResponseReconciliationOutcome =
  'exact' | 'mappable' | 'conflict' | 'orphan' | 'unsafe'

export type GuestResponseReconciliationSource =
  'legacy_rating' | 'legacy_feedback' | 'guest_response' | 'durable_fact'

export type GuestResponseReconciliationDimension =
  | 'legacy_relationship'
  | 'active_session_uniqueness'
  | 'experience_snapshot'
  | 'rating_lineage'
  | 'feedback_lineage'
  | 'integrity_history'
  | 'withdrawal_state'
  | 'media_state'
  | 'contact_state'
  | 'inbox_link'
  | 'retention_state'
  | 'fact_evidence'

export type GuestResponseReconciliationRow = Readonly<{
  source: GuestResponseReconciliationSource
  sourceId: string
  dimension: GuestResponseReconciliationDimension
  outcome: GuestResponseReconciliationOutcome
  organizationId: string
  propertyId: string | null
  portalId: string | null
  reasonCode: GuestResponseReconciliationReasonCode
  relatedIds: readonly string[]
}>

export type GuestResponseReconciliationFactKind =
  'rating_submitted' | 'rating_retracted' | 'feedback_submitted' | 'feedback_retracted'

export type GuestResponseReconciliationFactIdentity = Readonly<{
  kind: GuestResponseReconciliationFactKind
  eventId: string
  organizationId: string
  propertyId: string
  portalId: string
  responseId: string
  supersedesSourceEventId: string | null
  star: 1 | 2 | 3 | 4 | 5 | null
  responseRevision: number | null
}>

export type GuestResponseFactEvidenceAssessment = Readonly<{
  kind: GuestResponseReconciliationFactKind
  eventId: string
  organizationId: string
  propertyId: string | null
  portalId: string | null
  responseId: string | null
  payloadValid: boolean
  schemaVersionKnown: boolean
  responseExists: boolean
  scopeExact: boolean
  sourceAggregateExact: boolean
  businessTimeExact: boolean
  staffAttribution: 'exact' | 'unknown' | 'conflict' | 'invalid'
  feedbackRevision: 'exact' | 'unknown' | 'not_applicable' | 'conflict' | 'invalid'
}>

export type GuestResponseStarDistribution = Readonly<{
  one: number
  two: number
  three: number
  four: number
  five: number
  total: number
}>

export type GuestResponseRatingDistributions = Readonly<{
  legacyRatings: GuestResponseStarDistribution
  canonicalRetainedRatings: GuestResponseStarDistribution
  canonicalEffectiveRatings: GuestResponseStarDistribution
  durableRatingFactHeads: GuestResponseStarDistribution
}>

export type GuestResponseReconciliationCounts = Readonly<
  Record<GuestResponseReconciliationOutcome, number> & {
    total: number
    byReason: Readonly<Record<GuestResponseReconciliationReasonCode, number>>
  }
>

export type GuestResponseReconciliationReport = Readonly<{
  schemaVersion: typeof GUEST_RESPONSE_RECONCILIATION_VERSION
  observedAt: string
  scope: Readonly<{
    kind: 'global' | 'organizations'
    organizationIds: readonly string[]
  }>
  checks: Readonly<{
    zeroUnexplainedRows: boolean
    canonicalRatingFactParity: boolean
  }>
  ready: boolean
  counts: GuestResponseReconciliationCounts
  ratingDistributions: GuestResponseRatingDistributions
  rows: readonly GuestResponseReconciliationRow[]
  facts: readonly GuestResponseReconciliationFactIdentity[]
  fingerprintSha256: string
}>

const CONTENT_FREE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

function assertIdentifierOnly(value: string, field: string): void {
  if (!CONTENT_FREE_IDENTIFIER.test(value)) {
    throw new Error(`${field} must be an identifier-only value`)
  }
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function classifyGuestResponseFactEvidence(
  assessment: GuestResponseFactEvidenceAssessment,
): readonly GuestResponseReconciliationRow[] {
  const relatedIds = assessment.responseId === null ? [] : [assessment.responseId]
  const row = (
    outcome: GuestResponseReconciliationOutcome,
    reasonCode: GuestResponseReconciliationReasonCode,
  ): GuestResponseReconciliationRow => ({
    source: 'durable_fact',
    sourceId: assessment.eventId,
    dimension: 'fact_evidence',
    outcome,
    organizationId: assessment.organizationId,
    propertyId: assessment.propertyId,
    portalId: assessment.portalId,
    reasonCode,
    relatedIds,
  })
  const gaps: GuestResponseReconciliationRow[] = []
  if (
    !assessment.payloadValid ||
    assessment.staffAttribution === 'invalid' ||
    assessment.feedbackRevision === 'invalid'
  ) {
    gaps.push(row('unsafe', 'canonical_fact_payload_invalid'))
  }
  if (!assessment.schemaVersionKnown) {
    gaps.push(row('unsafe', 'canonical_fact_schema_version_unknown'))
  }
  if (assessment.payloadValid && !assessment.responseExists) {
    gaps.push(row('orphan', 'canonical_fact_response_missing'))
  }
  if (assessment.responseExists && !assessment.scopeExact) {
    gaps.push(row('conflict', 'canonical_fact_scope_conflict'))
  }
  if (assessment.responseExists && !assessment.sourceAggregateExact) {
    gaps.push(row('conflict', 'canonical_fact_source_aggregate_conflict'))
  }
  if (assessment.responseExists && !assessment.businessTimeExact) {
    gaps.push(row('conflict', 'canonical_fact_business_time_conflict'))
  }
  if (assessment.payloadValid) {
    if (assessment.staffAttribution === 'unknown') {
      gaps.push(row('unsafe', 'canonical_fact_staff_attribution_unknown'))
    } else if (assessment.staffAttribution === 'conflict') {
      gaps.push(row('conflict', 'canonical_fact_staff_attribution_conflict'))
    }
    if (assessment.feedbackRevision === 'unknown') {
      gaps.push(row('unsafe', 'canonical_feedback_revision_unknown'))
    } else if (assessment.feedbackRevision === 'conflict') {
      gaps.push(row('conflict', 'canonical_feedback_revision_conflict'))
    }
  }
  return gaps.length === 0 ? [row('exact', 'canonical_fact_evidence_exact')] : gaps
}

function rowKey(row: GuestResponseReconciliationRow): string {
  return [
    row.organizationId,
    row.source,
    row.sourceId,
    row.dimension,
    row.reasonCode,
  ].join('\u0000')
}

function stableRows(
  rows: readonly GuestResponseReconciliationRow[],
): readonly GuestResponseReconciliationRow[] {
  const normalized = rows
    .map((row) => {
      assertIdentifierOnly(row.organizationId, 'organizationId')
      assertIdentifierOnly(row.sourceId, 'sourceId')
      if (row.propertyId !== null) assertIdentifierOnly(row.propertyId, 'propertyId')
      if (row.portalId !== null) assertIdentifierOnly(row.portalId, 'portalId')
      for (const relatedId of row.relatedIds) {
        assertIdentifierOnly(relatedId, 'relatedId')
      }
      return { ...row, relatedIds: [...new Set(row.relatedIds)].sort() }
    })
    .sort((left, right) => compareKeys(rowKey(left), rowKey(right)))

  const seen = new Set<string>()
  for (const row of normalized) {
    const key = rowKey(row)
    if (seen.has(key)) {
      throw new Error(`duplicate Guest Response reconciliation row: ${key}`)
    }
    seen.add(key)
  }
  return normalized
}

function stableFacts(
  facts: readonly GuestResponseReconciliationFactIdentity[],
): readonly GuestResponseReconciliationFactIdentity[] {
  const normalized = facts
    .map((fact) => {
      assertIdentifierOnly(fact.eventId, 'eventId')
      assertIdentifierOnly(fact.organizationId, 'organizationId')
      assertIdentifierOnly(fact.propertyId, 'propertyId')
      assertIdentifierOnly(fact.portalId, 'portalId')
      assertIdentifierOnly(fact.responseId, 'responseId')
      if (fact.supersedesSourceEventId !== null) {
        assertIdentifierOnly(fact.supersedesSourceEventId, 'supersedesSourceEventId')
      }
      const isRating =
        fact.kind === 'rating_submitted' || fact.kind === 'rating_retracted'
      if ((fact.kind === 'rating_submitted') !== (fact.star !== null)) {
        throw new Error('rating fact star must exist only for rating_submitted')
      }
      if (!isRating && fact.star !== null) {
        throw new Error('feedback facts cannot carry a rating fact star')
      }
      const isFeedback =
        fact.kind === 'feedback_submitted' || fact.kind === 'feedback_retracted'
      if (
        (!isFeedback && fact.responseRevision !== null) ||
        (fact.responseRevision !== null &&
          (!Number.isSafeInteger(fact.responseRevision) || fact.responseRevision <= 0))
      ) {
        throw new Error(
          'feedback fact responseRevision must be null or a positive integer',
        )
      }
      return fact
    })
    .sort((left, right) => compareKeys(left.eventId, right.eventId))

  const seen = new Set<string>()
  for (const fact of normalized) {
    if (seen.has(fact.eventId)) {
      throw new Error(`duplicate Guest Response fact identity: ${fact.eventId}`)
    }
    seen.add(fact.eventId)
  }
  return normalized
}

function checkedDistribution(
  distribution: GuestResponseStarDistribution,
  name: string,
): GuestResponseStarDistribution {
  const stars = [
    distribution.one,
    distribution.two,
    distribution.three,
    distribution.four,
    distribution.five,
  ]
  if (stars.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error(`${name} star distribution counts must be non-negative integers`)
  }
  if (stars.reduce((sum, count) => sum + count, 0) !== distribution.total) {
    throw new Error(`${name} star distribution total is inconsistent`)
  }
  return { ...distribution }
}

function countRows(
  rows: readonly GuestResponseReconciliationRow[],
): GuestResponseReconciliationCounts {
  const outcomes: Record<GuestResponseReconciliationOutcome, number> = {
    exact: 0,
    mappable: 0,
    conflict: 0,
    orphan: 0,
    unsafe: 0,
  }
  const byReason = Object.fromEntries(
    GUEST_RESPONSE_RECONCILIATION_REASON_CODES.map((reasonCode) => [reasonCode, 0]),
  ) as Record<GuestResponseReconciliationReasonCode, number>
  for (const row of rows) {
    outcomes[row.outcome] += 1
    byReason[row.reasonCode] += 1
  }
  return { ...outcomes, total: rows.length, byReason }
}

function distributionsEqual(
  left: GuestResponseStarDistribution,
  right: GuestResponseStarDistribution,
): boolean {
  return (
    left.one === right.one &&
    left.two === right.two &&
    left.three === right.three &&
    left.four === right.four &&
    left.five === right.five &&
    left.total === right.total
  )
}

export function buildGuestResponseReconciliationReport(input: {
  readonly observedAt: Date
  readonly organizationIds?: readonly string[]
  readonly rows: readonly GuestResponseReconciliationRow[]
  readonly facts: readonly GuestResponseReconciliationFactIdentity[]
  readonly ratingDistributions: GuestResponseRatingDistributions
}): GuestResponseReconciliationReport {
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new Error('invalid Guest Response reconciliation observation time')
  }
  const organizationIds = [...new Set(input.organizationIds ?? [])].sort()
  for (const organizationId of organizationIds) {
    assertIdentifierOnly(organizationId, 'scope organizationId')
  }
  const rows = stableRows(input.rows)
  const facts = stableFacts(input.facts)
  const ratingDistributions = {
    legacyRatings: checkedDistribution(
      input.ratingDistributions.legacyRatings,
      'legacyRatings',
    ),
    canonicalRetainedRatings: checkedDistribution(
      input.ratingDistributions.canonicalRetainedRatings,
      'canonicalRetainedRatings',
    ),
    canonicalEffectiveRatings: checkedDistribution(
      input.ratingDistributions.canonicalEffectiveRatings,
      'canonicalEffectiveRatings',
    ),
    durableRatingFactHeads: checkedDistribution(
      input.ratingDistributions.durableRatingFactHeads,
      'durableRatingFactHeads',
    ),
  }
  const counts = countRows(rows)
  const checks = {
    zeroUnexplainedRows: rows.every((row) => row.outcome === 'exact'),
    canonicalRatingFactParity: distributionsEqual(
      ratingDistributions.canonicalEffectiveRatings,
      ratingDistributions.durableRatingFactHeads,
    ),
  }
  const payload = {
    schemaVersion: GUEST_RESPONSE_RECONCILIATION_VERSION,
    observedAt: input.observedAt.toISOString(),
    scope:
      organizationIds.length === 0
        ? ({ kind: 'global', organizationIds } as const)
        : ({ kind: 'organizations', organizationIds } as const),
    checks,
    ready: checks.zeroUnexplainedRows && checks.canonicalRatingFactParity,
    counts,
    ratingDistributions,
    rows,
    facts,
  }
  const fingerprintSha256 = createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex')
  return { ...payload, fingerprintSha256 }
}

export function canonicalGuestResponseReconciliationReport(
  report: GuestResponseReconciliationReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
