// Inbox's Organization Export contribution (LIF-01 work bullet 6).
//
// This is a cross-context adapter implementation: it implements Identity's
// `organization-export-contributor.port`, which src/contexts/CONTEXT.md
// "Dependency rules" names as the one foreign module an adapter may import.
// Nothing else from Identity is reachable from here.
//
// Inbox exports the MANAGER'S OWN WORK RECORD: which items exist, how their
// numbered Handling Cycles opened and closed, who was assigned, who escalated,
// which private-feedback outcome was recorded, which Response Target policy
// applied, and the manager's own internal notes. Two disclosure classes are
// used deliberately — `manager_authored` for free text a manager typed, and
// `tenant_visible` for the content-free workflow record around it — because
// CLASSIFICATIONS_BY_CONTEXT permits Inbox exactly those two and a reviewer
// must be able to tell the two apart without reading the rows.

import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import type {
  OrganizationExportContribution,
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type ExcludedRecordClass = Readonly<{ recordClass: string; reasonCode: string }>

type Snapshot = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * The same bounded read-only snapshot the Identity contributor takes. A queued
 * export whose `asOf` has aged out fails closed rather than silently shipping a
 * newer state under an older as-of stamp.
 */
const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const INBOX_EXPORT_VERSION = 'inbox-organization-export/v1' as const
const SNAPSHOT_BOUND = 'repeatable_read_within_15m_of_request' as const

/**
 * Every record class Inbox holds but must not hand to the archive, with the
 * reason a reviewer needs. The list is exported inside the payload so the
 * omission is visible in the bundle itself, not only in this file.
 */
const EXCLUDED_RECORD_CLASSES: readonly ExcludedRecordClass[] = Object.freeze([
  {
    // Per-user "when did I last open Inbox" watermark. It is personal read
    // state, it is never tenant-visible workflow evidence, and the navigation
    // badge derived from it is explicitly not proof that a command committed.
    recordClass: 'inbox_personal_last_view_state',
    reasonCode: 'personal_read_state',
  },
  {
    // Scheduled reminder slots are control-plane scheduling rows in the same
    // family as queues/outbox/receipts, which LIF-01 bullet 7 excludes.
    recordClass: 'inbox_response_target_reminder_schedule',
    reasonCode: 'content_free_control_plane',
  },
  {
    // `inbox_items` still carries legacy denormalized copies of the source
    // (rating/snippet/reviewer name). Google review content is provider
    // controlled and bullet 7 excludes it outright; guest private-feedback text
    // belongs to the Guest contributor, which owns its consent and its 90-day
    // retention deadline. Re-exporting either copy from Inbox would leak
    // provider content and would outlive the guest retention rule.
    recordClass: 'inbox_denormalized_source_content_copies',
    reasonCode: 'source_content_owned_by_originating_context',
  },
  {
    // Command/state revisions are fences, not tenant facts; the ones that
    // identify an append-only history row are kept, the rest are not.
    recordClass: 'inbox_transient_projection_fences',
    reasonCode: 'content_free_control_plane',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Inbox export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Inbox export field has an unsupported value: ${field}`)
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

async function readRows(snapshot: Snapshot, query: SQL): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvSummary(type: string, record: ExportRecord): readonly ExportScalar[] {
  const id = record.id ?? record.inbox_item_id ?? record.organization_id ?? ''
  const label = record.status ?? record.kind ?? record.outcome ?? record.reason ?? ''
  const state =
    record.opened_reason ??
    record.transition_reason ??
    record.target_kind ??
    record.result ??
    'recorded'
  const occurredAt =
    record.occurred_at ??
    record.transitioned_at ??
    record.opened_at ??
    record.recorded_at ??
    record.created_at ??
    ''
  return [
    type,
    id,
    record.property_id ?? '',
    record.cycle_number ?? record.handling_cycle_number ?? '',
    record.actor_user_id ?? record.author_user_id ?? record.recorded_by ?? '',
    label,
    state,
    occurredAt,
    canonicalizeRfc8785(record),
  ]
}

const CSV_HEADER = [
  'record_type',
  'record_id',
  'property_id',
  'cycle_number',
  'actor_user_id',
  'label',
  'state',
  'occurred_at',
  'record_json',
].join(',')

type Collection = readonly [string, readonly ExportRecord[]]

/**
 * The CSV is the human view of exactly the records its JSON sibling carries;
 * `record_json` keeps the row lossless so the two files can never disagree.
 */
function csvEntry(
  path: string,
  classification: OrganizationExportEntry['classification'],
  collections: readonly Collection[],
): OrganizationExportEntry {
  const lines = [
    CSV_HEADER,
    ...collections.flatMap(([type, records]) =>
      records.map((record) => csvSummary(type, record).map(csvField).join(',')),
    ),
  ]
  return {
    path,
    mediaType: 'text/csv',
    classification,
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(
  path: string,
  classification: OrganizationExportEntry['classification'],
  payload: unknown,
): OrganizationExportEntry {
  return {
    path,
    mediaType: 'application/json',
    classification,
    bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8'),
  }
}

type InboxExportTables = Readonly<{
  items: readonly ExportRecord[]
  cycleHeads: readonly ExportRecord[]
  cycles: readonly ExportRecord[]
  transitions: readonly ExportRecord[]
  responseTargets: readonly ExportRecord[]
  assignments: readonly ExportRecord[]
  escalations: readonly ExportRecord[]
  outcomes: readonly ExportRecord[]
  organizationPolicies: readonly ExportRecord[]
  propertyOverrides: readonly ExportRecord[]
  notes: readonly ExportRecord[]
  manualReopenExplanations: readonly ExportRecord[]
  outcomeInternalNotes: readonly ExportRecord[]
}>

/**
 * `COLLATE "C"` is not decoration: `organization_id`, `property_id` and the
 * user ids are `varchar`, and the database's default collation is a host/locale
 * artefact. Byte order is the archive's canonical order, so it is pinned here.
 */
async function readTables(
  snapshot: Snapshot,
  organizationId: string,
): Promise<InboxExportTables> {
  const items = await readRows(
    snapshot,
    sql`SELECT
          id,
          property_id,
          source_type,
          source_id,
          status,
          is_escalated,
          to_char(escalated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS escalated_at,
          escalated_by,
          to_char(escalation_resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS escalation_resolved_at,
          escalation_resolved_by,
          to_char(source_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_date,
          platform,
          assigned_to,
          to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at,
          to_char(first_reply_submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_reply_submitted_at,
          to_char(first_reply_published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_reply_published_at,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM inbox_items
        WHERE organization_id = ${organizationId}
        ORDER BY id`,
  )
  const cycleHeads = await readRows(
    snapshot,
    sql`SELECT
          heads.inbox_item_id,
          heads.property_id,
          heads.source_type,
          heads.current_cycle_number,
          heads.current_source_revision,
          heads.status,
          to_char(heads.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          to_char(heads.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM inbox_handling_cycle_heads AS heads
        WHERE heads.organization_id = ${organizationId}
        ORDER BY heads.inbox_item_id`,
  )
  const cycles = await readRows(
    snapshot,
    sql`SELECT
          inbox_item_id,
          cycle_number,
          property_id,
          source_type,
          source_revision,
          opened_reason,
          manual_reopen_reason,
          supersedes_cycle_number,
          opened_by,
          to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS opened_at
        FROM inbox_handling_cycles
        WHERE organization_id = ${organizationId}
        ORDER BY inbox_item_id, cycle_number`,
  )
  const transitions = await readRows(
    snapshot,
    sql`SELECT
          inbox_item_id,
          state_revision,
          cycle_number,
          property_id,
          source_type,
          kind,
          transition_reason,
          actor_type,
          actor_user_id,
          to_char(transitioned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS transitioned_at
        FROM inbox_handling_cycle_transitions
        WHERE organization_id = ${organizationId}
        ORDER BY inbox_item_id, state_revision`,
  )
  const responseTargets = await readRows(
    snapshot,
    sql`SELECT
          inbox_item_id,
          cycle_number,
          property_id,
          target_kind,
          performance_eligibility,
          duration_minutes,
          policy_source,
          policy_version,
          to_char(start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start_at,
          to_char(due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS due_at,
          to_char(completion_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completion_at,
          result,
          stop_reason
        FROM inbox_handling_cycle_response_targets
        WHERE organization_id = ${organizationId}
        ORDER BY inbox_item_id, cycle_number`,
  )
  const assignments = await readRows(
    snapshot,
    sql`SELECT
          inbox_item_id,
          resulting_command_revision,
          property_id,
          handling_cycle_number,
          previous_assignee,
          next_assignee,
          reason,
          actor_user_id,
          bulk_id,
          to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
        FROM inbox_assignment_history
        WHERE organization_id = ${organizationId}
        ORDER BY inbox_item_id, resulting_command_revision`,
  )
  const escalations = await readRows(
    snapshot,
    sql`SELECT
          inbox_item_id,
          resulting_command_revision,
          property_id,
          handling_cycle_number,
          kind,
          actor_user_id,
          to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
        FROM inbox_escalation_history
        WHERE organization_id = ${organizationId}
        ORDER BY inbox_item_id, resulting_command_revision`,
  )
  const outcomes = await readRows(
    snapshot,
    sql`SELECT
          id,
          inbox_item_id,
          cycle_number,
          outcome_revision,
          property_id,
          outcome,
          recorded_by,
          to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
          to_char(completion_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completion_at,
          deadline_result,
          supersedes_outcome_id
        FROM inbox_feedback_handling_outcomes
        WHERE organization_id = ${organizationId}
        ORDER BY inbox_item_id, cycle_number, outcome_revision`,
  )
  const organizationPolicies = await readRows(
    snapshot,
    sql`SELECT
          target_kind,
          duration_minutes,
          policy_version,
          updated_by,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM inbox_response_target_organization_policies
        WHERE organization_id = ${organizationId}
        ORDER BY target_kind COLLATE "C"`,
  )
  const propertyOverrides = await readRows(
    snapshot,
    sql`SELECT
          property_id,
          enabled,
          duration_minutes,
          policy_version,
          updated_by,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM inbox_private_feedback_target_property_overrides
        WHERE organization_id = ${organizationId}
        ORDER BY property_id`,
  )
  const notes = await readRows(
    snapshot,
    sql`SELECT
          id,
          inbox_item_id,
          author_user_id,
          text,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM inbox_notes
        WHERE organization_id = ${organizationId}
        ORDER BY id`,
  )
  // Manager free text carved out of the two content-free files it lives in, so
  // that `inbox/handling-cycles.*` and `inbox/handling-outcomes.*` can stay
  // `tenant_visible` and every manager-authored character sits behind the
  // narrower `manager_authored` class.
  const manualReopenExplanations = await readRows(
    snapshot,
    sql`SELECT
          inbox_item_id,
          cycle_number,
          manual_reopen_reason,
          manual_reopen_explanation,
          opened_by,
          to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS opened_at
        FROM inbox_handling_cycles
        WHERE organization_id = ${organizationId}
          AND manual_reopen_explanation IS NOT NULL
        ORDER BY inbox_item_id, cycle_number`,
  )
  const outcomeInternalNotes = await readRows(
    snapshot,
    sql`SELECT
          id,
          inbox_item_id,
          cycle_number,
          outcome_revision,
          internal_note,
          recorded_by,
          to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at
        FROM inbox_feedback_handling_outcomes
        WHERE organization_id = ${organizationId}
          AND internal_note IS NOT NULL
        ORDER BY inbox_item_id, cycle_number, outcome_revision`,
  )

  return {
    items,
    cycleHeads,
    cycles,
    transitions,
    responseTargets,
    assignments,
    escalations,
    outcomes,
    organizationPolicies,
    propertyOverrides,
    notes,
    manualReopenExplanations,
    outcomeInternalNotes,
  }
}

async function assertBoundedSnapshot(snapshot: Snapshot, asOf: Date): Promise<void> {
  const rows = await readRows(
    snapshot,
    sql`SELECT transaction_timestamp() AS snapshot_at`,
  )
  const snapshotAt = rows[0]?.snapshot_at
  if (typeof snapshotAt !== 'string') {
    throw new Error('Inbox export snapshot clock is unavailable')
  }
  const snapshotTime = new Date(snapshotAt).getTime()
  const requestTime = asOf.getTime()
  if (
    Number.isNaN(requestTime) ||
    snapshotTime < requestTime ||
    snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
  ) {
    throw new Error('Inbox export snapshot window is unavailable')
  }
}

function header(asOf: Date) {
  return {
    version: INBOX_EXPORT_VERSION,
    requestedAsOf: asOf.toISOString(),
    snapshotBound: SNAPSHOT_BOUND,
    excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
  }
}

function buildEntries(
  tables: InboxExportTables,
  asOf: Date,
): readonly OrganizationExportEntry[] {
  const base = header(asOf)
  const files: readonly Readonly<{
    name: string
    classification: OrganizationExportEntry['classification']
    collections: readonly Collection[]
    payload: Record<string, unknown>
  }>[] = [
    {
      name: 'items',
      classification: 'tenant_visible',
      collections: [
        ['inbox_item', tables.items],
        ['handling_cycle_head', tables.cycleHeads],
      ],
      payload: { items: tables.items, cycleHeads: tables.cycleHeads },
    },
    {
      name: 'handling-cycles',
      classification: 'tenant_visible',
      collections: [
        ['handling_cycle', tables.cycles],
        ['handling_cycle_transition', tables.transitions],
        ['handling_cycle_response_target', tables.responseTargets],
      ],
      payload: {
        cycles: tables.cycles,
        transitions: tables.transitions,
        responseTargets: tables.responseTargets,
      },
    },
    {
      name: 'assignment-history',
      classification: 'tenant_visible',
      collections: [['assignment', tables.assignments]],
      payload: { assignments: tables.assignments },
    },
    {
      name: 'escalation-history',
      classification: 'tenant_visible',
      collections: [['escalation', tables.escalations]],
      payload: { escalations: tables.escalations },
    },
    {
      name: 'handling-outcomes',
      classification: 'tenant_visible',
      collections: [['handling_outcome', tables.outcomes]],
      payload: { outcomes: tables.outcomes },
    },
    {
      name: 'response-target-policies',
      classification: 'tenant_visible',
      collections: [
        ['response_target_organization_policy', tables.organizationPolicies],
        ['private_feedback_target_property_override', tables.propertyOverrides],
      ],
      payload: {
        organizationPolicies: tables.organizationPolicies,
        propertyOverrides: tables.propertyOverrides,
      },
    },
    {
      name: 'notes',
      classification: 'manager_authored',
      collections: [['inbox_note', tables.notes]],
      payload: { notes: tables.notes },
    },
    {
      name: 'handling-notes',
      classification: 'manager_authored',
      collections: [
        ['manual_reopen_explanation', tables.manualReopenExplanations],
        ['handling_outcome_internal_note', tables.outcomeInternalNotes],
      ],
      payload: {
        manualReopenExplanations: tables.manualReopenExplanations,
        outcomeInternalNotes: tables.outcomeInternalNotes,
      },
    },
  ]

  // Sorted by UTF-8 byte order, never by host locale. The bundle builder sorts
  // again across all contexts; emitting sorted here means this contributor's
  // own output is self-evidently order-stable in isolation too.
  return files
    .flatMap(({ name, classification, collections, payload }) => [
      csvEntry(`inbox/${name}.csv`, classification, collections),
      jsonEntry(`inbox/${name}.json`, classification, { ...base, ...payload }),
    ])
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')),
    )
}

/**
 * Concrete Inbox-owned Organization Export contribution.
 *
 * Reads: `inbox_items`, `inbox_handling_cycle_heads`, `inbox_handling_cycles`,
 * `inbox_handling_cycle_transitions`, `inbox_handling_cycle_response_targets`,
 * `inbox_assignment_history`, `inbox_escalation_history`,
 * `inbox_feedback_handling_outcomes`,
 * `inbox_response_target_organization_policies`,
 * `inbox_private_feedback_target_property_overrides`, `inbox_notes`.
 *
 * Never reads `inbox_user_views` or `inbox_response_target_reminders`, and
 * never selects the denormalized source-content columns on `inbox_items`.
 * Emptiness is answered affirmatively with `no_data`; an empty CSV is never
 * fabricated for an Organization that has no Inbox work.
 */
export const createInboxOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'inbox' as const,
    async contribute({ organizationId, asOf }): Promise<OrganizationExportContribution> {
      const tables = await db.transaction(
        async (snapshot) => {
          await assertBoundedSnapshot(snapshot, asOf)
          return readTables(snapshot, organizationId)
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
      const isEmpty = Object.values(tables).every((rows) => rows.length === 0)
      if (isEmpty) {
        return {
          context: 'inbox' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'inbox' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildEntries(tables, asOf),
      }
    },
  })
