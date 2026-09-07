/**
 * Inbox Handling-Cycle legacy classification contract (IBX-01 cutover).
 *
 * The IBX-01 rollout clause requires every pre-cutover `inbox_items` row to be
 * classified `exact | mappable | ambiguous | orphan` before any reader is cut
 * over, and it forbids one specific shortcut: an approved Private Feedback
 * Handling Outcome or an on-time Response Target result may never be inferred
 * from a generic `closed_at`. A legacy row was closed by code that had no
 * outcome table and no transition log, so its `closed_at` carries no evidence
 * of *why* it closed. Absence of evidence is therefore recorded as evidence of
 * absence of measurement: `ambiguous` / `legacy_unknown` / excluded from
 * performance, never a silent `follow_up_completed` or `on_time`.
 *
 * This module is pure. It reads no database and performs no I/O; the read-only
 * cutover repository supplies already-fetched rows. Keeping it pure is what
 * lets the replay/rebuild parity harness re-run the classification over a dump
 * and compare fingerprints without touching a live cell.
 *
 * The canonical report is deliberately content-free. Cutover evidence is
 * reviewed by operators and attached to a signed runbook, so it carries
 * identifiers, enums and counts only — never guest or manager prose.
 */

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { ResponseTargetEligibility } from '../domain/response-target'
import type {
  HandlingCycleTransitionKind,
  InboxStatus,
  SourceType,
} from '../domain/types'

/** Legacy `property_id` is a varchar key, so a UUID shape is a real question. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

export const INBOX_LEGACY_CLASSIFICATIONS = [
  'exact',
  'mappable',
  'ambiguous',
  'orphan',
] as const

export type InboxLegacyClassification = (typeof INBOX_LEGACY_CLASSIFICATIONS)[number]

export const INBOX_LEGACY_REASON_CODES = [
  'head_matches_cycle_log',
  'single_source_anchor_without_head',
  'multiple_source_anchors_without_head',
  'status_mirror_disagrees_with_head',
  'closed_without_handling_evidence',
  'head_disagrees_with_cycle_log',
  'source_row_missing',
  'legacy_property_key_not_uuid',
  'head_property_scope_mismatch',
  'head_source_scope_mismatch',
] as const

export type InboxLegacyReasonCode = (typeof INBOX_LEGACY_REASON_CODES)[number]

/**
 * Raw `inbox_items` row. Ids stay unbranded strings because a legacy row is
 * exactly what may fail the branded invariants this classifier reports on.
 * `snippet` and `reviewerName` are accepted so the contract can prove they are
 * discarded; they never influence a classification.
 */
export type InboxLegacyItemRow = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  sourceType: SourceType
  sourceId: string
  status: InboxStatus
  closedAt: Date | null
  snippet: string | null
  reviewerName: string | null
}>

/** Raw `inbox_handling_cycle_heads` row, absent on an unmigrated legacy item. */
export type InboxLegacyHeadRow = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string
  sourceType: SourceType
  sourceId: string
  currentCycleNumber: number
  currentSourceRevision: number
  stateRevision: number
  status: InboxStatus
}>

/** Raw `inbox_handling_cycles` row. */
export type InboxLegacyCycleRow = Readonly<{
  inboxItemId: string
  cycleNumber: number
  sourceType: SourceType
  sourceId: string
  sourceRevision: number
}>

/** Raw `inbox_handling_cycle_transitions` row. */
export type InboxLegacyTransitionRow = Readonly<{
  inboxItemId: string
  cycleNumber: number
  stateRevision: number
  kind: HandlingCycleTransitionKind
  transitionReason: string
}>

/** Raw `inbox_feedback_handling_outcomes` row. */
export type InboxLegacyOutcomeRow = Readonly<{
  inboxItemId: string
  cycleNumber: number
  outcomeRevision: number
  outcome: string
  deadlineResult: string
  internalNote: string | null
}>

/** Raw `inbox_notes` row. Manager notes are inert cutover evidence: they prove
 * somebody worked the item, never that an approved outcome was recorded. */
export type InboxLegacyNoteRow = Readonly<{
  inboxItemId: string
  text: string
}>

/**
 * A candidate cycle anchor: the Material Review Revision of the live review, or
 * the Guest Response revision at which private feedback was submitted. Zero
 * anchors means the source row is gone; more than one means the mapping cannot
 * be decided without a human.
 */
export type InboxLegacySourceAnchorRow = Readonly<{
  sourceType: SourceType
  sourceId: string
  revision: number
  comment: string | null
}>

export type InboxLegacyRelationshipInput = Readonly<{
  item: InboxLegacyItemRow
  head: InboxLegacyHeadRow | null
  cycles: readonly InboxLegacyCycleRow[]
  transitions: readonly InboxLegacyTransitionRow[]
  outcomes: readonly InboxLegacyOutcomeRow[]
  notes: readonly InboxLegacyNoteRow[]
  sourceAnchors: readonly InboxLegacySourceAnchorRow[]
  /**
   * `inbox_handling_cycle_response_targets.performance_eligibility` for the head
   * cycle, or null when no snapshot row exists. Null is never upgraded.
   */
  responseTargetEligibility: ResponseTargetEligibility | null
}>

/** Identifiers, one reason code and a conservative eligibility. Nothing else. */
export type InboxLegacyRelationship = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string
  classification: InboxLegacyClassification
  reasonCode: InboxLegacyReasonCode
  cycleNumber: number | null
  sourceRevision: number | null
  stateRevision: number | null
  targetEligibility: ResponseTargetEligibility
  performanceExcluded: boolean
}>

/**
 * The only closure reasons that a legacy Google row can prove on its own. A
 * private-feedback closure must instead be proved by an outcome row, because
 * `private_feedback_handled` without an outcome is precisely the ambiguity the
 * cutover clause is written against.
 */
const OBSERVABLE_CLOSURE_REASONS: readonly string[] = [
  'confirmed_on_google',
  'external_reply_observed',
]

const statusImpliedByTransition = (kind: HandlingCycleTransitionKind): InboxStatus =>
  kind === 'closed' ? 'closed' : 'open'

function latestTransition(
  transitions: readonly InboxLegacyTransitionRow[],
): InboxLegacyTransitionRow | null {
  let latest: InboxLegacyTransitionRow | null = null
  for (const transition of transitions) {
    if (latest === null || transition.stateRevision > latest.stateRevision) {
      latest = transition
    }
  }
  return latest
}

function headMatchesCycleLog(
  head: InboxLegacyHeadRow,
  cycles: readonly InboxLegacyCycleRow[],
  transitions: readonly InboxLegacyTransitionRow[],
): boolean {
  if (!cycles.some((cycle) => cycle.cycleNumber === 1)) return false
  const current = cycles.find((cycle) => cycle.cycleNumber === head.currentCycleNumber)
  if (
    current === undefined ||
    current.sourceRevision !== head.currentSourceRevision ||
    current.sourceType !== head.sourceType ||
    current.sourceId !== head.sourceId
  ) {
    return false
  }
  const latest = latestTransition(transitions)
  return (
    latest !== null &&
    latest.stateRevision === head.stateRevision &&
    latest.cycleNumber === head.currentCycleNumber &&
    statusImpliedByTransition(latest.kind) === head.status
  )
}

function hasHandlingEvidence(
  transitions: readonly InboxLegacyTransitionRow[],
  outcomes: readonly InboxLegacyOutcomeRow[],
): boolean {
  if (outcomes.length > 0) return true
  return transitions.some(
    (transition) =>
      transition.kind === 'closed' &&
      OBSERVABLE_CLOSURE_REASONS.includes(transition.transitionReason),
  )
}

/**
 * A recorded snapshot is trusted only for a row whose head, cycle log and
 * compatibility mirror all agree. Anything else is `legacy_unknown`, so a
 * partially migrated row can never contribute an on-time result to the manager
 * performance read.
 */
function resolveTargetEligibility(
  classification: InboxLegacyClassification,
  recorded: ResponseTargetEligibility | null,
): ResponseTargetEligibility {
  if (classification !== 'exact' || recorded === null) return 'legacy_unknown'
  return recorded
}

export function classifyInboxLegacyRelationship(
  input: InboxLegacyRelationshipInput,
): InboxLegacyRelationship {
  const { item, head } = input
  const cycles = input.cycles.filter((cycle) => cycle.inboxItemId === item.id)
  const transitions = input.transitions.filter(
    (transition) => transition.inboxItemId === item.id,
  )
  const outcomes = input.outcomes.filter((outcome) => outcome.inboxItemId === item.id)
  const anchors = input.sourceAnchors.filter(
    (anchor) =>
      anchor.sourceType === item.sourceType && anchor.sourceId === item.sourceId,
  )

  const decide = (
    classification: InboxLegacyClassification,
    reasonCode: InboxLegacyReasonCode,
    revisions: Readonly<{
      cycleNumber: number | null
      sourceRevision: number | null
      stateRevision: number | null
    }>,
  ): InboxLegacyRelationship => {
    const targetEligibility = resolveTargetEligibility(
      classification,
      input.responseTargetEligibility,
    )
    return {
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      classification,
      reasonCode,
      ...revisions,
      targetEligibility,
      performanceExcluded: targetEligibility !== 'measured',
    }
  }
  const unanchored = { cycleNumber: null, sourceRevision: null, stateRevision: null }

  if (anchors.length === 0) return decide('orphan', 'source_row_missing', unanchored)
  if (!CANONICAL_UUID.test(item.propertyId)) {
    return decide('orphan', 'legacy_property_key_not_uuid', unanchored)
  }

  if (head === null) {
    if (anchors.length > 1) {
      return decide('ambiguous', 'multiple_source_anchors_without_head', unanchored)
    }
    return decide('mappable', 'single_source_anchor_without_head', {
      ...unanchored,
      sourceRevision: anchors[0]!.revision,
    })
  }

  // The head stores `property_id` as a UUID while `inbox_items` keeps the older
  // textual key, so scope equality is the only proof the two rows are the same
  // tenant object.
  if (head.propertyId !== item.propertyId) {
    return decide('orphan', 'head_property_scope_mismatch', unanchored)
  }
  if (
    head.inboxItemId !== item.id ||
    head.organizationId !== item.organizationId ||
    head.sourceType !== item.sourceType ||
    head.sourceId !== item.sourceId
  ) {
    return decide('orphan', 'head_source_scope_mismatch', unanchored)
  }

  const revisions = {
    cycleNumber: head.currentCycleNumber,
    sourceRevision: head.currentSourceRevision,
    stateRevision: head.stateRevision,
  }

  // Drift between the compatibility mirror and the head is reported, never
  // repaired: the cutover is read-only and the mirror stays authoritative for
  // nothing until the writers are cut.
  if (item.status !== head.status) {
    return decide('ambiguous', 'status_mirror_disagrees_with_head', revisions)
  }
  if (
    (item.status === 'closed' || item.closedAt !== null) &&
    !hasHandlingEvidence(transitions, outcomes)
  ) {
    return decide('ambiguous', 'closed_without_handling_evidence', revisions)
  }
  if (!headMatchesCycleLog(head, cycles, transitions)) {
    return decide('ambiguous', 'head_disagrees_with_cycle_log', revisions)
  }
  return decide('exact', 'head_matches_cycle_log', revisions)
}

export const INBOX_HANDLING_CUTOVER_REPORT_VERSION = 'inbox-handling-cutover/v1' as const

export type InboxHandlingCutoverReportPayload = Readonly<{
  version: typeof INBOX_HANDLING_CUTOVER_REPORT_VERSION
  organizationId: string
  generatedAt: string
  totals: Readonly<Record<'total' | InboxLegacyClassification, number>>
  reasonCounts: ReadonlyArray<
    Readonly<{ reasonCode: InboxLegacyReasonCode; count: number }>
  >
  eligibilityCounts: ReadonlyArray<
    Readonly<{ targetEligibility: ResponseTargetEligibility; count: number }>
  >
  performanceExcludedCount: number
  items: ReadonlyArray<
    Readonly<{
      inboxItemId: string
      propertyId: string
      classification: InboxLegacyClassification
      reasonCode: InboxLegacyReasonCode
      cycleNumber: number | null
      sourceRevision: number | null
      stateRevision: number | null
      targetEligibility: ResponseTargetEligibility
      performanceExcluded: boolean
    }>
  >
}>

export type InboxHandlingCutoverReport = Readonly<{
  payload: InboxHandlingCutoverReportPayload
  canonicalJson: string
  sha256: string
}>

export type InboxHandlingCutoverReportInput = Readonly<{
  organizationId: string
  generatedAt: Date
  relationships: readonly InboxLegacyRelationship[]
  /**
   * Injected rather than imported so this module stays free of `node:crypto`.
   * Inbox's public API is reachable from browser code, and a Node builtin
   * anywhere in that graph fails the reachability control (ADR 0017). The
   * operator edge supplies the real digest.
   */
  digestSha256: (canonicalJson: string) => string
}>

/** Byte order, not host locale order, so every runtime produces the same digest. */
const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))

function countBy<Key extends string>(
  values: readonly Key[],
): ReadonlyArray<readonly [Key, number]> {
  const counts = new Map<Key, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(([left], [right]) => compareUtf8(left, right))
}

export function canonicalInboxHandlingCutoverReport(
  input: InboxHandlingCutoverReportInput,
): InboxHandlingCutoverReport {
  if (Number.isNaN(input.generatedAt.getTime())) {
    throw new Error('Inbox cutover report generatedAt must be a valid instant')
  }

  const seen = new Set<string>()
  for (const relationship of input.relationships) {
    if (seen.has(relationship.inboxItemId)) {
      throw new Error(
        `Duplicate Inbox Item in cutover report: ${relationship.inboxItemId}`,
      )
    }
    seen.add(relationship.inboxItemId)
    if (relationship.organizationId !== input.organizationId) {
      throw new Error('Inbox cutover report mixes Organizations')
    }
  }

  const items = [...input.relationships]
    .sort((left, right) => compareUtf8(left.inboxItemId, right.inboxItemId))
    .map((relationship) => ({
      inboxItemId: relationship.inboxItemId,
      propertyId: relationship.propertyId,
      classification: relationship.classification,
      reasonCode: relationship.reasonCode,
      cycleNumber: relationship.cycleNumber,
      sourceRevision: relationship.sourceRevision,
      stateRevision: relationship.stateRevision,
      targetEligibility: relationship.targetEligibility,
      performanceExcluded: relationship.performanceExcluded,
    }))

  const totals = {
    total: items.length,
    exact: items.filter((item) => item.classification === 'exact').length,
    mappable: items.filter((item) => item.classification === 'mappable').length,
    ambiguous: items.filter((item) => item.classification === 'ambiguous').length,
    orphan: items.filter((item) => item.classification === 'orphan').length,
  }

  const payload = {
    version: INBOX_HANDLING_CUTOVER_REPORT_VERSION,
    organizationId: input.organizationId,
    generatedAt: input.generatedAt.toISOString(),
    totals,
    reasonCounts: countBy(items.map((item) => item.reasonCode)).map(
      ([reasonCode, count]) => ({ reasonCode, count }),
    ),
    eligibilityCounts: countBy(items.map((item) => item.targetEligibility)).map(
      ([targetEligibility, count]) => ({ targetEligibility, count }),
    ),
    performanceExcludedCount: items.filter((item) => item.performanceExcluded).length,
    items,
  } satisfies InboxHandlingCutoverReportPayload

  const canonicalJson = canonicalizeRfc8785(payload)
  return {
    payload,
    canonicalJson,
    sha256: input.digestSha256(canonicalJson),
  }
}
