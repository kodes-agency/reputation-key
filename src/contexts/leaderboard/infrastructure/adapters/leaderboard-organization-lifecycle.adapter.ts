// Leaderboard/Recognition's Organization lifecycle contribution
// (LIF-01-T12/T13/T14).
//
// `leaderboard.use` is `legacy_blocked`: competitive ranking is rejected beta
// behaviour. `buildLeaderboardContext` constructs no repository, use case,
// consumer, job or schedule. The context is nevertheless the owner of the
// governed Recognition board surface plus the legacy leaderboard snapshot
// tables, so it answers all three phases with real work whenever those retained
// rows exist and the affirmative `no_data` when they do not.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
// Cross-context adapter implementing a foreign port — src/contexts/CONTEXT.md
// "Dependency rules" permits infrastructure/adapters/** to reach application/ports/**.
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

type LeaderboardLifecycleTable = Readonly<{
  table: string
  scope: (organizationId: string) => SQL
}>

const byOrganization =
  (table: string) =>
  (organizationId: string): SQL =>
    sql`${sql.identifier(table)}.organization_id = ${organizationId}`

/**
 * `leaderboard_snapshots` predates tenant-scoped columns and carries no
 * `organization_id`. Its rows are bound to the tenant two independent ways, and
 * either one is sufficient:
 *   * the snapshot belongs to one of the Organization's Properties, or
 *   * one of the Organization's `leaderboard_entries` points at it.
 * Both clauses are needed because the entries are deleted by this same purge
 * (the FK cascades) and because Property's own purge may have already removed
 * the Property row. Neither clause can reach another tenant: a Property belongs
 * to exactly one Organization.
 */
const legacySnapshotScope = (organizationId: string): SQL =>
  sql`(
        ${sql.identifier('leaderboard_snapshots')}.property_id IN (
          SELECT id FROM properties WHERE organization_id = ${organizationId}
        )
        OR ${sql.identifier('leaderboard_snapshots')}.id IN (
          SELECT snapshot_id FROM leaderboard_entries
          WHERE organization_id = ${organizationId}
        )
      )`

/**
 * Leaderboard-owned tenant tables in FK-safe DELETE order.
 *
 * `leaderboard_snapshots` goes first because `leaderboard_entries` cascades
 * from it; the entries row stays in the plan as an explicit mop-up so a
 * snapshot that was already cascade-removed by Property's purge cannot leave
 * orphaned tenant rows behind. The governed board is then unwound child-first:
 * entries reference snapshots, snapshots reference activations, and activation
 * groups reference activations.
 *
 * Deliberately absent:
 *   * `recognition_awards` / `recognition_award_status_facts` — Badge owns the
 *     award record; see PURGE_ORDER_NOTE.
 *   * `metric_definitions` / `metric_definition_versions` and `portal_groups` —
 *     foreign, and in the metric catalogue's case not tenant content at all.
 */
const LEADERBOARD_TENANT_TABLES: readonly LeaderboardLifecycleTable[] = Object.freeze([
  { table: 'leaderboard_snapshots', scope: legacySnapshotScope },
  { table: 'leaderboard_entries', scope: byOrganization('leaderboard_entries') },
  {
    table: 'recognition_reconciliation_events',
    scope: byOrganization('recognition_reconciliation_events'),
  },
  {
    table: 'recognition_board_entries',
    scope: byOrganization('recognition_board_entries'),
  },
  {
    table: 'recognition_board_snapshots',
    scope: byOrganization('recognition_board_snapshots'),
  },
  {
    table: 'recognition_activation_groups',
    scope: byOrganization('recognition_activation_groups'),
  },
  { table: 'recognition_activations', scope: byOrganization('recognition_activations') },
] as const)

/**
 * Badge's `recognition_awards.source_snapshot_id` references
 * `recognition_board_snapshots`, so Badge's purge must land before this one.
 * The coordinator runs contributors concurrently: this DELETE either waits on
 * Badge's uncommitted child delete and then succeeds, or it fails, writes no
 * receipt, and converges on the next pass once Badge's receipt is durable.
 */
const PURGE_ORDER_NOTE = 'badge_awards_before_recognition_board_snapshots' as const

/**
 * Append-only guards that block a tenant purge (migration 0025).
 *
 * They exist so product code can never rewrite a governed board fact. A purge
 * is not product code: it is the reviewed irreversible boundary, and the row
 * must physically go. `ALTER TABLE ... DISABLE TRIGGER` is transactional in
 * PostgreSQL, so the guards are restored by the same commit that carries the
 * receipt — and automatically by a rollback if the phase fails. Deliberately
 * NOT `session_replication_role = 'replica'`, which would also suppress the
 * system triggers implementing foreign keys and silently orphan rows.
 */
const APPEND_ONLY_GUARDS: readonly Readonly<{ table: string; trigger: string }>[] =
  Object.freeze([
    Object.freeze({
      table: 'recognition_board_entries',
      trigger: 'recognition_board_entries_append_only',
    }),
    Object.freeze({
      table: 'recognition_board_snapshots',
      trigger: 'recognition_board_snapshots_append_only',
    }),
    Object.freeze({
      table: 'recognition_reconciliation_events',
      trigger: 'recognition_reconciliation_events_append_only',
    }),
  ] as const)

/** Evidence references stay content-free: context, phase, outcome and a count. */
const evidenceRef = (
  phase: 'closing' | 'purge_readiness' | 'purge',
  outcome: 'complete' | 'no_data',
  count: number,
): string => `leaderboard:${phase}:${outcome}:${count}`

const readCount = async (tx: Tx, query: SQL): Promise<number> => {
  const result = await tx.execute(query)
  const rows = result.rows as readonly Record<string, unknown>[]
  const value = rows[0]?.count
  const count = typeof value === 'string' ? Number(value) : value
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Leaderboard lifecycle row count is unavailable')
  }
  return count
}

const countRetainedRows = (tx: Tx, organizationId: string): Promise<number> =>
  readCount(
    tx,
    sql`SELECT (${sql.join(
      LEADERBOARD_TENANT_TABLES.map(
        ({ table, scope }) =>
          sql`(SELECT count(*) FROM ${sql.identifier(table)} WHERE ${scope(organizationId)})`,
      ),
      sql` + `,
    )})::int AS count`,
  )

/**
 * Leaderboard's Closing preparation: stop effects, keep data.
 *
 * Leaderboard composes nothing, so there is no live surface for Closing to make
 * unavailable; that darkness is held by the capability fate authority and the
 * `legacy-recognition-active-surfaces` pin, and is asserted in this adapter's
 * own tests. This module deliberately does NOT read the build boundary at
 * runtime, because `infrastructure/**` may not reach the composition layer.
 *
 * Nothing is mutated either. Deactivating `recognition_activations` — the Property
 * opt-in that gates whether any badge or board work is visible or scheduled —
 * is the tempting flip and is deliberately NOT performed: nothing schedules
 * Recognition work while the capability is `legacy_blocked`, so the flip would
 * buy no fence, and it would rewrite the exact activation inventory CNV-01
 * contraction has to reconcile and export. Closing is recoverable; it must not
 * leave a deactivation the tenant never asked for.
 */
export const leaderboardPrepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const retained = await countRetainedRows(tx, request.organizationId)
  return retained === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('closing', 'no_data', 0) }
    : { outcome: 'complete', evidenceRef: evidenceRef('closing', 'complete', retained) }
}

/**
 * Leaderboard's purge readiness. READ ONLY — no INSERT, UPDATE or DELETE is
 * issued. Refusal is expressed by throwing, leaving the Organization `closing`.
 */
export const leaderboardVerifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  // Recognition facts are emitted under the `recognition.` prefix and the
  // legacy boards under `leaderboard.`; the outbox derives `source_context`
  // from the first segment, so both are this context's work in flight.
  const pending = await readCount(
    tx,
    sql`SELECT count(*)::int AS count
        FROM outbox_events
        WHERE organization_id = ${request.organizationId}
          AND source_context IN ('leaderboard', 'recognition')
          AND published_at IS NULL
          AND recovery_fenced_at IS NULL`,
  )
  if (pending > 0) {
    throw new Error(
      'Leaderboard purge readiness blocked: unpublished_recognition_outbox_events',
    )
  }

  const retained = await countRetainedRows(tx, request.organizationId)
  return retained === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('purge_readiness', 'no_data', 0) }
    : {
        outcome: 'complete',
        evidenceRef: evidenceRef('purge_readiness', 'complete', retained),
      }
}

/**
 * Leaderboard's irreversible purge. Rows are deleted; every physical table —
 * including the legacy leaderboard mirrors that are blocked from any DROP until
 * CNV-01 contraction completes — survives untouched.
 *
 * The receipt count is the number of rows this plan's own DELETE statements
 * removed. `leaderboard_entries` cascades from `leaderboard_snapshots`, so a
 * cascaded entry is counted by the snapshot statement that removed it and the
 * explicit entries mop-up then reports zero. The count is therefore a lower
 * bound on physical rows removed, never an overstatement.
 */
export const leaderboardPurge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  let scrubbed = 0
  for (const guard of APPEND_ONLY_GUARDS) {
    await tx.execute(
      sql`ALTER TABLE ${sql.identifier(guard.table)} DISABLE TRIGGER ${sql.identifier(guard.trigger)}`,
    )
  }
  try {
    for (const { table, scope } of LEADERBOARD_TENANT_TABLES) {
      scrubbed += await readCount(
        tx,
        sql`WITH deleted AS (
              DELETE FROM ${sql.identifier(table)}
              WHERE ${scope(request.organizationId)}
              RETURNING 1
            )
            SELECT count(*)::int AS count FROM deleted`,
      )
    }
  } finally {
    for (const guard of APPEND_ONLY_GUARDS) {
      await tx.execute(
        sql`ALTER TABLE ${sql.identifier(guard.table)} ENABLE TRIGGER ${sql.identifier(guard.trigger)}`,
      )
    }
  }
  return scrubbed === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('purge', 'no_data', 0) }
    : { outcome: 'complete', evidenceRef: evidenceRef('purge', 'complete', scrubbed) }
}

/** The static, reviewable table plan. Exported for the contract tests. */
export const LEADERBOARD_LIFECYCLE_TABLES: readonly string[] = Object.freeze(
  LEADERBOARD_TENANT_TABLES.map(({ table }) => table),
)

export { PURGE_ORDER_NOTE as LEADERBOARD_PURGE_ORDER_NOTE }

/** The append-only guards the purge lifts, for the contract tests. */
export const LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS: readonly string[] = Object.freeze(
  APPEND_ONLY_GUARDS.map(({ trigger }) => trigger),
)

export const createLeaderboardOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'leaderboard',
    prepareClosing: leaderboardPrepareClosing,
    verifyPurgeReadiness: leaderboardVerifyPurgeReadiness,
    purge: leaderboardPurge,
  })
