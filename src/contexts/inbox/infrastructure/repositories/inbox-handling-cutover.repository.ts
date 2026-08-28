/**
 * Read-only Inbox Handling-Cycle cutover/parity repository (IBX-01-T2).
 *
 * The IBX-01 rollout clause requires the legacy `inbox_items` estate to be
 * verified against the Handling Cycle tables — "counts/status/source links;
 * dual-read parity" — BEFORE any reader is cut over and long before any
 * contraction. That verification runs against live production data, so the
 * one rule this module enforces above all others is that it can never change
 * anything it looks at:
 *
 *   - every query runs inside ONE `REPEATABLE READ`, `READ ONLY` transaction,
 *     so the whole report describes a single database snapshot and PostgreSQL
 *     itself — not code review — rejects a stray write;
 *   - the transaction's own read-only/isolation settings and whether a write
 *     transaction id was ever assigned are read back and returned, so the
 *     evidence artifact proves the posture it was produced under;
 *   - `observedAt` is mandatory and bounds every table by `created_at`, so a
 *     rerun at the same instant over unchanged history is byte-comparable and
 *     an operator can diff two runs instead of trusting one.
 *
 * The scan is deliberately content-free. It never selects `inbox_items.snippet`
 * or `reviewer_name`, `inbox_notes.text`, `guest_response_private_feedback.body`,
 * `material_review_revisions.normalized_text`, or an outcome's `internal_note`:
 * cutover evidence is reviewed by operators against a signed runbook, and it
 * carries identifiers, enums and counts only.
 *
 * Classification itself lives in the pure application module
 * (`inbox-handling-cutover.ts`) so the same decision can be replayed over a
 * dump without a live cell. This file only fetches rows and reconciles the
 * three parity questions the runbook asks: head coverage, compatibility-mirror
 * drift, and Response Target lineage.
 */

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  classifyInboxLegacyRelationship,
  type InboxLegacyClassification,
  type InboxLegacyCycleRow,
  type InboxLegacyHeadRow,
  type InboxLegacyItemRow,
  type InboxLegacyOutcomeRow,
  type InboxLegacyRelationship,
  type InboxLegacySourceAnchorRow,
  type InboxLegacyTransitionRow,
} from '../../application/inbox-handling-cutover'
import type { ResponseTargetEligibility } from '../../domain/response-target'
import type {
  HandlingCycleTransitionKind,
  InboxStatus,
  SourceType,
} from '../../domain/types'

/**
 * How a legacy private-feedback item's handling result may be counted. This is
 * a separate axis from the structural classification: a row can be structurally
 * `exact` and still carry no measurable result. `withdrawn` and `unrecorded`
 * are terminal exclusions — the cutover never upgrades them, because a manager
 * outcome that was never recorded cannot be reconstructed from `closed_at`.
 */
export const INBOX_CUTOVER_OUTCOME_ELIGIBILITIES = [
  'handled_on_time',
  'handled_late',
  'handled_not_measured',
  'withdrawn',
  'unrecorded',
  'not_applicable',
] as const

export type InboxCutoverOutcomeEligibility =
  (typeof INBOX_CUTOVER_OUTCOME_ELIGIBILITIES)[number]

/**
 * Lineage of a Response Target snapshot relative to the current head cycle. A
 * snapshot on an older cycle is `superseded` — normal, expected history for a
 * corrected guest submission — and must never be reported as a discrepancy.
 */
export const INBOX_CUTOVER_TARGET_STATES = ['current', 'superseded', 'headless'] as const

export type InboxCutoverTargetState = (typeof INBOX_CUTOVER_TARGET_STATES)[number]

export type InboxCutoverTransactionPosture = Readonly<{
  readOnly: boolean
  isolationLevel: string
  writeTransactionAssigned: boolean
}>

export type InboxCutoverStatusMismatch = Readonly<{
  inboxItemId: string
  itemStatus: InboxStatus
  headStatus: InboxStatus
}>

export type InboxCutoverParity = Readonly<{
  inboxItemCount: number
  handlingCycleHeadCount: number
  orphanCount: number
  headlessItemCount: number
  statusMismatches: readonly InboxCutoverStatusMismatch[]
}>

export type InboxCutoverOutcomeRow = Readonly<{
  inboxItemId: string
  cycleNumber: number | null
  outcomeEligibility: InboxCutoverOutcomeEligibility
}>

export type InboxCutoverOutcomeTallies = Readonly<
  Record<
    | 'handledOnTime'
    | 'handledLate'
    | 'handledNotMeasured'
    | 'withdrawn'
    | 'unrecorded'
    | 'notApplicable',
    number
  >
>

export type InboxCutoverResponseTargetRow = Readonly<{
  inboxItemId: string
  cycleNumber: number
  headCycleNumber: number | null
  targetKind: string
  performanceEligibility: ResponseTargetEligibility
  result: string | null
  state: InboxCutoverTargetState
}>

export type InboxHandlingCutoverScan = Readonly<{
  organizationId: string
  observedAt: Date
  transaction: InboxCutoverTransactionPosture
  totals: Readonly<Record<'total' | InboxLegacyClassification, number>>
  relationships: readonly InboxLegacyRelationship[]
  parity: InboxCutoverParity
  outcomes: readonly InboxCutoverOutcomeRow[]
  outcomeTallies: InboxCutoverOutcomeTallies
  responseTargets: readonly InboxCutoverResponseTargetRow[]
}>

export type InboxHandlingCutoverScanInput = Readonly<{
  organizationId: string
  observedAt: Date
}>

type QueryExecutor = Pick<Database, 'execute'>

/** `bigint` arrives from `pg` as a string; every Handling Cycle counter is
 * fenced to 2^53-1 at the database, so a checked coercion is exact. */
function checkedNumber(value: unknown, column: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`inbox cutover column ${column} is not numeric`)
  }
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`inbox cutover column ${column} is not a safe integer`)
  }
  return parsed
}

function checkedString(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`inbox cutover column ${column} is not text`)
  }
  return value
}

function checkedNullableString(value: unknown, column: string): string | null {
  if (value === null || value === undefined) return null
  return checkedString(value, column)
}

const SOURCE_TYPES = new Set<SourceType>(['review', 'feedback'])
const INBOX_STATUSES = new Set<InboxStatus>(['open', 'closed'])
const TRANSITION_KINDS = new Set<HandlingCycleTransitionKind>([
  'opened',
  'closed',
  'reopened',
])
const TARGET_ELIGIBILITIES = new Set<ResponseTargetEligibility>([
  'measured',
  'legacy_unknown',
  'historical_onboarding',
])

function checkedSourceType(value: unknown): SourceType {
  const text = checkedString(value, 'source_type')
  if (!SOURCE_TYPES.has(text as SourceType)) {
    throw new Error(`unknown Inbox source type: ${text}`)
  }
  return text as SourceType
}

function checkedStatus(value: unknown): InboxStatus {
  const text = checkedString(value, 'status')
  if (!INBOX_STATUSES.has(text as InboxStatus)) {
    throw new Error(`unknown Inbox status: ${text}`)
  }
  return text as InboxStatus
}

function checkedTransitionKind(value: unknown): HandlingCycleTransitionKind {
  const text = checkedString(value, 'kind')
  if (!TRANSITION_KINDS.has(text as HandlingCycleTransitionKind)) {
    throw new Error(`unknown Handling Cycle transition kind: ${text}`)
  }
  return text as HandlingCycleTransitionKind
}

function checkedTargetEligibility(value: unknown): ResponseTargetEligibility {
  const text = checkedString(value, 'performance_eligibility')
  if (!TARGET_ELIGIBILITIES.has(text as ResponseTargetEligibility)) {
    throw new Error(`unknown Response Target eligibility: ${text}`)
  }
  return text as ResponseTargetEligibility
}

type Row = Readonly<Record<string, unknown>>

const rowsOf = (result: { rows: unknown }): readonly Row[] =>
  result.rows as readonly Row[]

async function readTransactionPosture(
  tx: QueryExecutor,
): Promise<InboxCutoverTransactionPosture> {
  const result = await tx.execute(sql`
    SELECT current_setting('transaction_read_only') AS read_only,
           current_setting('transaction_isolation') AS isolation_level,
           (pg_current_xact_id_if_assigned() IS NOT NULL) AS write_assigned
  `)
  const row = rowsOf(result)[0]
  if (!row) throw new Error('inbox cutover could not read its transaction posture')
  return {
    readOnly: checkedString(row.read_only, 'transaction_read_only') === 'on',
    isolationLevel: checkedString(row.isolation_level, 'transaction_isolation'),
    writeTransactionAssigned: row.write_assigned === true,
  }
}

async function readItems(
  tx: QueryExecutor,
  organizationId: string,
  observedAt: Date,
): Promise<readonly InboxLegacyItemRow[]> {
  // `snippet` and `reviewer_name` are deliberately projected as NULL: the
  // cutover proves relationships, and guest prose is not evidence of one.
  const result = await tx.execute(sql`
    SELECT id::text AS id,
           organization_id AS organization_id,
           property_id AS property_id,
           source_type AS source_type,
           source_id::text AS source_id,
           status AS status,
           closed_at AS closed_at
    FROM inbox_items
    WHERE organization_id = ${organizationId}
      AND created_at <= ${observedAt}
    ORDER BY id
  `)
  return rowsOf(result).map((row) => ({
    id: checkedString(row.id, 'inbox_items.id'),
    organizationId: checkedString(row.organization_id, 'inbox_items.organization_id'),
    propertyId: checkedString(row.property_id, 'inbox_items.property_id'),
    sourceType: checkedSourceType(row.source_type),
    sourceId: checkedString(row.source_id, 'inbox_items.source_id'),
    status: checkedStatus(row.status),
    closedAt: row.closed_at instanceof Date ? row.closed_at : null,
    snippet: null,
    reviewerName: null,
  }))
}

async function readHeads(
  tx: QueryExecutor,
  organizationId: string,
  observedAt: Date,
): Promise<readonly InboxLegacyHeadRow[]> {
  const result = await tx.execute(sql`
    SELECT inbox_item_id::text AS inbox_item_id,
           organization_id AS organization_id,
           property_id::text AS property_id,
           source_type AS source_type,
           source_id::text AS source_id,
           current_cycle_number AS current_cycle_number,
           current_source_revision AS current_source_revision,
           state_revision AS state_revision,
           status AS status
    FROM inbox_handling_cycle_heads
    WHERE organization_id = ${organizationId}
      AND created_at <= ${observedAt}
    ORDER BY inbox_item_id
  `)
  return rowsOf(result).map((row) => ({
    inboxItemId: checkedString(row.inbox_item_id, 'heads.inbox_item_id'),
    organizationId: checkedString(row.organization_id, 'heads.organization_id'),
    propertyId: checkedString(row.property_id, 'heads.property_id'),
    sourceType: checkedSourceType(row.source_type),
    sourceId: checkedString(row.source_id, 'heads.source_id'),
    currentCycleNumber: checkedNumber(row.current_cycle_number, 'heads.cycle_number'),
    currentSourceRevision: checkedNumber(
      row.current_source_revision,
      'heads.source_revision',
    ),
    stateRevision: checkedNumber(row.state_revision, 'heads.state_revision'),
    status: checkedStatus(row.status),
  }))
}

async function readCycles(
  tx: QueryExecutor,
  organizationId: string,
  observedAt: Date,
): Promise<readonly InboxLegacyCycleRow[]> {
  const result = await tx.execute(sql`
    SELECT inbox_item_id::text AS inbox_item_id,
           cycle_number AS cycle_number,
           source_type AS source_type,
           source_id::text AS source_id,
           source_revision AS source_revision
    FROM inbox_handling_cycles
    WHERE organization_id = ${organizationId}
      AND created_at <= ${observedAt}
    ORDER BY inbox_item_id, cycle_number
  `)
  return rowsOf(result).map((row) => ({
    inboxItemId: checkedString(row.inbox_item_id, 'cycles.inbox_item_id'),
    cycleNumber: checkedNumber(row.cycle_number, 'cycles.cycle_number'),
    sourceType: checkedSourceType(row.source_type),
    sourceId: checkedString(row.source_id, 'cycles.source_id'),
    sourceRevision: checkedNumber(row.source_revision, 'cycles.source_revision'),
  }))
}

async function readTransitions(
  tx: QueryExecutor,
  organizationId: string,
  observedAt: Date,
): Promise<readonly InboxLegacyTransitionRow[]> {
  const result = await tx.execute(sql`
    SELECT inbox_item_id::text AS inbox_item_id,
           cycle_number AS cycle_number,
           state_revision AS state_revision,
           kind AS kind,
           transition_reason AS transition_reason
    FROM inbox_handling_cycle_transitions
    WHERE organization_id = ${organizationId}
      AND created_at <= ${observedAt}
    ORDER BY inbox_item_id, state_revision
  `)
  return rowsOf(result).map((row) => ({
    inboxItemId: checkedString(row.inbox_item_id, 'transitions.inbox_item_id'),
    cycleNumber: checkedNumber(row.cycle_number, 'transitions.cycle_number'),
    stateRevision: checkedNumber(row.state_revision, 'transitions.state_revision'),
    kind: checkedTransitionKind(row.kind),
    transitionReason: checkedString(row.transition_reason, 'transitions.reason'),
  }))
}

async function readOutcomes(
  tx: QueryExecutor,
  organizationId: string,
  observedAt: Date,
): Promise<readonly InboxLegacyOutcomeRow[]> {
  // `internal_note` is never selected — the manager's private note stays in
  // Inbox and has no bearing on whether an outcome exists.
  const result = await tx.execute(sql`
    SELECT inbox_item_id::text AS inbox_item_id,
           cycle_number AS cycle_number,
           outcome_revision AS outcome_revision,
           outcome AS outcome,
           deadline_result AS deadline_result
    FROM inbox_feedback_handling_outcomes
    WHERE organization_id = ${organizationId}
      AND created_at <= ${observedAt}
    ORDER BY inbox_item_id, cycle_number, outcome_revision
  `)
  return rowsOf(result).map((row) => ({
    inboxItemId: checkedString(row.inbox_item_id, 'outcomes.inbox_item_id'),
    cycleNumber: checkedNumber(row.cycle_number, 'outcomes.cycle_number'),
    outcomeRevision: checkedNumber(row.outcome_revision, 'outcomes.outcome_revision'),
    outcome: checkedString(row.outcome, 'outcomes.outcome'),
    deadlineResult: checkedString(row.deadline_result, 'outcomes.deadline_result'),
    internalNote: null,
  }))
}

/**
 * Candidate cycle anchors for the items in scope. A Review anchors on its
 * Material Review Revision and a private-feedback item on the Guest Response
 * revision at which feedback was submitted; both are joined back to the live
 * source row so a deleted source yields ZERO anchors and the item is reported
 * as an orphan rather than silently mapped.
 */
async function readSourceAnchors(
  tx: QueryExecutor,
  organizationId: string,
  observedAt: Date,
): Promise<readonly InboxLegacySourceAnchorRow[]> {
  const result = await tx.execute(sql`
    SELECT 'review'::text AS source_type,
           revisions.review_id::text AS source_id,
           revisions.revision AS revision
    FROM material_review_revisions AS revisions
    JOIN reviews AS review
      ON review.id = revisions.review_id
     AND review.organization_id = revisions.organization_id
    WHERE revisions.organization_id = ${organizationId}
      AND revisions.created_at <= ${observedAt}
      AND EXISTS (
        SELECT 1 FROM inbox_items AS item
        WHERE item.organization_id = revisions.organization_id
          AND item.source_type = 'review'
          AND item.source_id = revisions.review_id
          AND item.created_at <= ${observedAt}
      )

    UNION ALL

    SELECT 'feedback'::text AS source_type,
           response.id::text AS source_id,
           response.feedback_submission_revision AS revision
    FROM guest_responses AS response
    WHERE response.organization_id = ${organizationId}
      AND response.created_at <= ${observedAt}
      AND response.deleted_at IS NULL
      AND response.feedback_submitted_at IS NOT NULL
      AND response.feedback_submission_revision IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM inbox_items AS item
        WHERE item.organization_id = response.organization_id
          AND item.source_type = 'feedback'
          AND item.source_id = response.id
          AND item.created_at <= ${observedAt}
      )

    ORDER BY 1, 2, 3
  `)
  return rowsOf(result).map((row) => ({
    sourceType: checkedSourceType(row.source_type),
    sourceId: checkedString(row.source_id, 'anchor.source_id'),
    revision: checkedNumber(row.revision, 'anchor.revision'),
    comment: null,
  }))
}

type RawTargetRow = Readonly<{
  inboxItemId: string
  cycleNumber: number
  headCycleNumber: number | null
  targetKind: string
  performanceEligibility: ResponseTargetEligibility
  result: string | null
}>

async function readResponseTargets(
  tx: QueryExecutor,
  organizationId: string,
  observedAt: Date,
): Promise<readonly RawTargetRow[]> {
  const result = await tx.execute(sql`
    SELECT target.inbox_item_id::text AS inbox_item_id,
           target.cycle_number AS cycle_number,
           head.current_cycle_number AS head_cycle_number,
           target.target_kind AS target_kind,
           target.performance_eligibility AS performance_eligibility,
           target.result AS result
    FROM inbox_handling_cycle_response_targets AS target
    LEFT JOIN inbox_handling_cycle_heads AS head
      ON head.inbox_item_id = target.inbox_item_id
     AND head.created_at <= ${observedAt}
    WHERE target.organization_id = ${organizationId}
      AND target.created_at <= ${observedAt}
      AND EXISTS (
        SELECT 1 FROM inbox_items AS item
        WHERE item.id = target.inbox_item_id
          AND item.organization_id = target.organization_id
          AND item.created_at <= ${observedAt}
      )
    ORDER BY target.inbox_item_id, target.cycle_number
  `)
  return rowsOf(result).map((row) => ({
    inboxItemId: checkedString(row.inbox_item_id, 'targets.inbox_item_id'),
    cycleNumber: checkedNumber(row.cycle_number, 'targets.cycle_number'),
    headCycleNumber:
      row.head_cycle_number === null || row.head_cycle_number === undefined
        ? null
        : checkedNumber(row.head_cycle_number, 'targets.head_cycle_number'),
    targetKind: checkedString(row.target_kind, 'targets.target_kind'),
    performanceEligibility: checkedTargetEligibility(row.performance_eligibility),
    result: checkedNullableString(row.result, 'targets.result'),
  }))
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = grouped.get(key(row))
    if (bucket) bucket.push(row)
    else grouped.set(key(row), [row])
  }
  return grouped
}

function targetState(row: RawTargetRow): InboxCutoverTargetState {
  if (row.headCycleNumber === null) return 'headless'
  return row.headCycleNumber === row.cycleNumber ? 'current' : 'superseded'
}

/**
 * The measurable-result axis. A withdrawn guest submission is decided by the
 * transition log — the only place that records WHY a cycle closed — and it
 * wins over every later inference: a manager cannot have handled feedback the
 * guest took back, so the row is excluded from the on-time/late tallies rather
 * than counted as `not_measured` alongside genuinely unmeasured work.
 */
function resolveOutcomeEligibility(
  item: InboxLegacyItemRow,
  cycleNumber: number | null,
  transitions: readonly InboxLegacyTransitionRow[],
  outcomes: readonly InboxLegacyOutcomeRow[],
): InboxCutoverOutcomeEligibility {
  if (item.sourceType !== 'feedback') return 'not_applicable'
  if (cycleNumber === null) return 'unrecorded'
  const withdrawn = transitions.some(
    (transition) =>
      transition.cycleNumber === cycleNumber &&
      transition.kind === 'closed' &&
      transition.transitionReason === 'guest_withdrawn',
  )
  if (withdrawn) return 'withdrawn'

  let latest: InboxLegacyOutcomeRow | null = null
  for (const outcome of outcomes) {
    if (outcome.cycleNumber !== cycleNumber) continue
    if (latest === null || outcome.outcomeRevision > latest.outcomeRevision) {
      latest = outcome
    }
  }
  if (latest === null) return 'unrecorded'
  if (latest.deadlineResult === 'on_time') return 'handled_on_time'
  if (latest.deadlineResult === 'late') return 'handled_late'
  return 'handled_not_measured'
}

const EMPTY_TALLIES: InboxCutoverOutcomeTallies = {
  handledOnTime: 0,
  handledLate: 0,
  handledNotMeasured: 0,
  withdrawn: 0,
  unrecorded: 0,
  notApplicable: 0,
}

const TALLY_KEYS: Readonly<
  Record<InboxCutoverOutcomeEligibility, keyof InboxCutoverOutcomeTallies>
> = {
  handled_on_time: 'handledOnTime',
  handled_late: 'handledLate',
  handled_not_measured: 'handledNotMeasured',
  withdrawn: 'withdrawn',
  unrecorded: 'unrecorded',
  not_applicable: 'notApplicable',
}

function tally(rows: readonly InboxCutoverOutcomeRow[]): InboxCutoverOutcomeTallies {
  return rows.reduce<InboxCutoverOutcomeTallies>((totals, row) => {
    const key = TALLY_KEYS[row.outcomeEligibility]
    return { ...totals, [key]: totals[key] + 1 }
  }, EMPTY_TALLIES)
}

/**
 * Open one snapshot-consistent read-only transaction and produce the whole
 * cutover/parity scan from it. There is deliberately no apply path, no
 * repair, and no write of any kind in this module.
 */
export async function readInboxHandlingCutoverScan(
  db: Database,
  input: InboxHandlingCutoverScanInput,
): Promise<InboxHandlingCutoverScan> {
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new Error('inbox cutover scan requires a valid --observed-at instant')
  }
  const { organizationId, observedAt } = input

  return db.transaction(
    async (tx) => {
      const transaction = await readTransactionPosture(tx)
      const items = await readItems(tx, organizationId, observedAt)
      const heads = await readHeads(tx, organizationId, observedAt)
      const cycles = await readCycles(tx, organizationId, observedAt)
      const transitions = await readTransitions(tx, organizationId, observedAt)
      const outcomes = await readOutcomes(tx, organizationId, observedAt)
      const anchors = await readSourceAnchors(tx, organizationId, observedAt)
      const targets = await readResponseTargets(tx, organizationId, observedAt)

      const headByItem = new Map(heads.map((head) => [head.inboxItemId, head]))
      const cyclesByItem = groupBy(cycles, (cycle) => cycle.inboxItemId)
      const transitionsByItem = groupBy(
        transitions,
        (transition) => transition.inboxItemId,
      )
      const outcomesByItem = groupBy(outcomes, (outcome) => outcome.inboxItemId)
      const anchorsBySource = groupBy(
        anchors,
        (anchor) => `${anchor.sourceType}:${anchor.sourceId}`,
      )
      const targetsByItem = groupBy(targets, (target) => target.inboxItemId)

      const relationships: InboxLegacyRelationship[] = []
      const outcomeRows: InboxCutoverOutcomeRow[] = []
      const statusMismatches: InboxCutoverStatusMismatch[] = []

      for (const item of items) {
        const head = headByItem.get(item.id) ?? null
        const itemCycles = cyclesByItem.get(item.id) ?? []
        const itemTransitions = transitionsByItem.get(item.id) ?? []
        const itemOutcomes = outcomesByItem.get(item.id) ?? []
        const itemTargets = targetsByItem.get(item.id) ?? []
        const headCycleNumber =
          head?.currentCycleNumber ??
          itemCycles.reduce<number | null>(
            (highest, cycle) =>
              highest === null || cycle.cycleNumber > highest
                ? cycle.cycleNumber
                : highest,
            null,
          )
        const headTarget =
          headCycleNumber === null
            ? undefined
            : itemTargets.find((target) => target.cycleNumber === headCycleNumber)

        relationships.push(
          classifyInboxLegacyRelationship({
            item,
            head,
            cycles: itemCycles,
            transitions: itemTransitions,
            outcomes: itemOutcomes,
            notes: [],
            sourceAnchors:
              anchorsBySource.get(`${item.sourceType}:${item.sourceId}`) ?? [],
            responseTargetEligibility: headTarget?.performanceEligibility ?? null,
          }),
        )
        outcomeRows.push({
          inboxItemId: item.id,
          cycleNumber: headCycleNumber,
          outcomeEligibility: resolveOutcomeEligibility(
            item,
            headCycleNumber,
            itemTransitions,
            itemOutcomes,
          ),
        })
        if (head !== null && head.status !== item.status) {
          statusMismatches.push({
            inboxItemId: item.id,
            itemStatus: item.status,
            headStatus: head.status,
          })
        }
      }

      const countOf = (classification: InboxLegacyClassification): number =>
        relationships.filter(
          (relationship) => relationship.classification === classification,
        ).length

      return {
        organizationId,
        observedAt,
        transaction,
        totals: {
          total: relationships.length,
          exact: countOf('exact'),
          mappable: countOf('mappable'),
          ambiguous: countOf('ambiguous'),
          orphan: countOf('orphan'),
        },
        relationships,
        parity: {
          inboxItemCount: items.length,
          handlingCycleHeadCount: heads.length,
          orphanCount: countOf('orphan'),
          headlessItemCount: items.filter((item) => !headByItem.has(item.id)).length,
          statusMismatches,
        },
        outcomes: outcomeRows,
        outcomeTallies: tally(outcomeRows),
        responseTargets: targets.map((target) => ({
          ...target,
          state: targetState(target),
        })),
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}
