// Goal Organization lifecycle contributor (LIF-01-T12/T13/T14).
//
// Cross-context adapter implementation: CONTEXT.md "Dependency rules" lets an
// `infrastructure/adapters/**` file import the foreign `application/ports/**`
// contract it implements, and nothing else from Identity. Authority binding,
// the advisory lock, receipt idempotence and the append-only content-free
// receipt row all come from the shared store — this file only supplies the
// three reviewed phase bodies.
//
// Goal is the one context of this trio with a real effect of its own. Its
// executable authority inventory (`application/goal-authority-inventory.ts`)
// lists `goal-program.maintain-schedule` as an ACTIVE schedule: a recurring,
// tenant-cross pass that activates scheduled programs, appends monthly
// results and reconciles/closes due results. Those are tenant mutations that
// must not keep running through the recoverable window.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

const CONTEXT = 'goal' as const

/**
 * Static, reviewed purge plan in FK-safe order. Rows are DELETED; no table is
 * ever dropped and the retained pre-beta `goals`/`goal_progress` mirror is
 * emptied for this tenant, never removed.
 */
export const GOAL_PURGE_TABLES = Object.freeze([
  'goal_result_revisions',
  'goal_monthly_results',
  'goal_subject_assignments',
  'goal_program_versions',
  'goal_programs',
  'goal_refresh_receipts',
  'goal_evaluations',
  'goal_timezone_event_receipts',
  'goal_periods',
  'goal_definition_versions',
  'goal_definitions',
  'goal_progress',
  'goals',
] as const)

/**
 * Append-only guards that block a tenant purge (migrations 0024 and 0087).
 *
 * They exist so product code can never rewrite Goal history. A purge is not
 * product code: it is the reviewed irreversible boundary, and the row must
 * physically go. `ALTER TABLE ... DISABLE TRIGGER` is transactional in
 * PostgreSQL, so these are restored by the same commit that carries the
 * receipt — and automatically by a rollback if the phase fails. Deliberately
 * NOT `session_replication_role = 'replica'`, which would also suppress the
 * system triggers implementing foreign keys and silently orphan rows.
 */
const APPEND_ONLY_GUARDS = Object.freeze([
  Object.freeze({
    table: 'goal_definition_versions',
    trigger: 'goal_definition_versions_immutable',
  }),
  Object.freeze({ table: 'goal_evaluations', trigger: 'goal_evaluations_immutable' }),
  Object.freeze({
    table: 'goal_program_versions',
    trigger: 'goal_program_versions_append_only',
  }),
  Object.freeze({
    table: 'goal_result_revisions',
    trigger: 'goal_result_revisions_append_only',
  }),
  Object.freeze({ table: 'goal_monthly_results', trigger: 'goal_monthly_results_guard' }),
] as const)

/** Supersession chains are short; the guard turns a cycle into a loud failure. */
const MAX_SUPERSESSION_PASSES = 64

function evidenceRef(
  phase: 'closing' | 'purge_readiness' | 'purge',
  reason: string,
  counts: Readonly<Record<string, number>>,
): string {
  const parts = Object.keys(counts)
    .sort()
    .map((key) => `${key}:${counts[key]}`)
  return [CONTEXT, phase, 'v1', reason, ...parts].join(':')
}

function outcomeFor(rows: number): OrganizationLifecyclePhaseOutcome['outcome'] {
  return rows > 0 ? 'complete' : 'no_data'
}

function count(value: unknown): number {
  return Number((value as string | number | null | undefined) ?? 0)
}

/** Total tenant-scoped Goal rows across both the canonical and retained families. */
async function countTenantRows(tx: Tx, organization: string): Promise<number> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM goals WHERE organization_id = ${organization})
      + (SELECT count(*) FROM goal_progress WHERE organization_id = ${organization})
      + (SELECT count(*) FROM goal_definitions WHERE organization_id = ${organization})
      + (
        SELECT count(*) FROM goal_definition_versions
        WHERE organization_id = ${organization}
      )
      + (SELECT count(*) FROM goal_periods WHERE organization_id = ${organization})
      + (SELECT count(*) FROM goal_evaluations WHERE organization_id = ${organization})
      + (
        SELECT count(*) FROM goal_timezone_event_receipts
        WHERE organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM goal_refresh_receipts
        WHERE organization_id = ${organization}
      )
      + (SELECT count(*) FROM goal_programs WHERE organization_id = ${organization})
      + (
        SELECT count(*) FROM goal_program_versions
        WHERE organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM goal_subject_assignments
        WHERE organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM goal_monthly_results
        WHERE organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM goal_result_revisions
        WHERE organization_id = ${organization}
      ) AS rows
  `)
  return count((result.rows[0] as { rows?: unknown } | undefined)?.rows)
}

/**
 * Closing — STOP EFFECTS, KEEP DATA.
 *
 * Pauses every ACTIVE Goal Program for the tenant. `maintain()` skips a
 * program that is not active, so this stops result creation, reconciliation
 * and closure for the Organization without deleting or scrubbing a single
 * business row.
 *
 * Idempotent: the predicate only matches rows still in `active`, so a replay
 * (or the shared store's receipt replay) mutates nothing.
 *
 * Reversible: `paused -> active` is a declared Goal Program edge accepted by
 * the `goal_programs_transition_guard` trigger, so cancelling closure can
 * restore the tenant. Per LIF-01 bullet 4 reactivation stays deliberate —
 * this phase never schedules a silent resume.
 *
 * `status_reason` is the per-transition field every status change overwrites;
 * recording the closure fence there is what makes this pause identifiable and
 * reversible by an operator. `scheduled` programs are deliberately untouched:
 * the trigger declares no `scheduled -> paused` edge, and a scheduled program
 * performs no mutation until `maintain()` activates it — which first
 * re-authorizes the tenant against the CURRENT Organization policy that the
 * closure request already suspended.
 */
const prepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const organization = request.organizationId
  const rows = await countTenantRows(tx, organization)
  const paused = await tx.execute(sql`
    UPDATE goal_programs
    SET status = 'paused',
        status_reason = 'organization_closure_fence',
        updated_at = ${request.occurredAt}
    WHERE organization_id = ${organization}
      AND status = 'active'
  `)
  return {
    outcome: outcomeFor(rows),
    evidenceRef: evidenceRef('closing', 'programs_fenced', {
      paused: paused.rowCount ?? 0,
      rows,
    }),
  }
}

/**
 * Purge readiness — READ ONLY, and a real blocker.
 *
 * Two conditions mean Goal still has live work that the irreversible boundary
 * would tear in half:
 *
 *   1. an `active` Goal Program — the Closing fence is missing or was undone,
 *      so the maintenance schedule can still append and close results;
 *   2. a `reconciling` monthly result — an evaluation is mid-flight and would
 *      either resume against deleted rows or leave a half-closed month.
 *
 * A blocker THROWS: the coordinator leaves the lifecycle state where it is,
 * no receipt is written (the phase shares this transaction), and the next pass
 * re-verifies. This phase mutates nothing.
 */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const organization = request.organizationId
  const rows = await countTenantRows(tx, organization)
  const blockers = await tx.execute(sql`
    SELECT
      (
        SELECT count(*) FROM goal_programs
        WHERE organization_id = ${organization} AND status = 'active'
      ) AS active_programs,
      (
        SELECT count(*) FROM goal_monthly_results
        WHERE organization_id = ${organization} AND status = 'reconciling'
      ) AS reconciling_results
  `)
  const row = blockers.rows[0] as
    { active_programs?: unknown; reconciling_results?: unknown } | undefined
  const activePrograms = count(row?.active_programs)
  const reconcilingResults = count(row?.reconciling_results)
  if (activePrograms > 0 || reconcilingResults > 0) {
    throw new Error(
      `goal purge readiness blocked: ${activePrograms} active program(s), ${reconcilingResults} reconciling result(s)`,
    )
  }
  return {
    outcome: outcomeFor(rows),
    evidenceRef: evidenceRef('purge_readiness', 'no_live_goal_work', { rows }),
  }
}

/**
 * Deletes a self-superseding family tip-first.
 *
 * `supersedes_*_id` columns are ON DELETE RESTRICT, which PostgreSQL checks
 * per row rather than at end of statement, so one flat DELETE over a lineage
 * fails. Repeatedly removing the rows nothing else supersedes drains it
 * deterministically. The identifiers come only from this file's static plan.
 */
async function purgeSupersessionChain(
  tx: Tx,
  table: 'goal_result_revisions' | 'goal_evaluations',
  supersedesColumn: 'supersedes_revision_id' | 'supersedes_evaluation_id',
  organization: string,
): Promise<void> {
  const relation = sql.identifier(table)
  const column = sql.identifier(supersedesColumn)
  for (let pass = 0; pass < MAX_SUPERSESSION_PASSES; pass += 1) {
    const result = await tx.execute(sql`
      DELETE FROM ${relation} AS target
      WHERE target.organization_id = ${organization}
        AND NOT EXISTS (
          SELECT 1 FROM ${relation} AS successor
          WHERE successor.${column} = target.id
        )
    `)
    if ((result.rowCount ?? 0) === 0) return
  }
  throw new Error(`goal purge could not drain the ${table} supersession chain`)
}

/**
 * Purge — IRREVERSIBLE, idempotent, content-free.
 *
 * Every statement is bound to one organization id and the order follows
 * GOAL_PURGE_TABLES, which is the FK topology: every table is removed before
 * the one it references. Nothing is dropped and no compatibility mirror is
 * removed — the retained pre-beta `goals`/`goal_progress` family is emptied
 * for this tenant only.
 *
 * `metric_definition_versions`, `properties`, `portals` and `portal_groups`
 * are referenced by Goal rows but belong to other contexts; releasing those
 * references is exactly what this phase does, and those contexts purge their
 * own rows.
 */
const purge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const organization = request.organizationId
  const rows = await countTenantRows(tx, organization)
  if (rows === 0) {
    return {
      outcome: 'no_data',
      evidenceRef: evidenceRef('purge', 'nothing_to_scrub', { rows: 0 }),
    }
  }

  for (const guard of APPEND_ONLY_GUARDS) {
    await tx.execute(
      sql`ALTER TABLE ${sql.identifier(guard.table)} DISABLE TRIGGER ${sql.identifier(guard.trigger)}`,
    )
  }
  try {
    // Canonical Goal Program family, children first.
    await purgeSupersessionChain(
      tx,
      'goal_result_revisions',
      'supersedes_revision_id',
      organization,
    )
    await tx.execute(
      sql`DELETE FROM goal_monthly_results WHERE organization_id = ${organization}`,
    )
    await tx.execute(
      sql`DELETE FROM goal_subject_assignments WHERE organization_id = ${organization}`,
    )
    await tx.execute(
      sql`DELETE FROM goal_program_versions WHERE organization_id = ${organization}`,
    )
    await tx.execute(
      sql`DELETE FROM goal_programs WHERE organization_id = ${organization}`,
    )

    // Retained governed-goal family. Refresh receipts reference both periods
    // and evaluations, so they go before either.
    await tx.execute(
      sql`DELETE FROM goal_refresh_receipts WHERE organization_id = ${organization}`,
    )
    await purgeSupersessionChain(
      tx,
      'goal_evaluations',
      'supersedes_evaluation_id',
      organization,
    )
    await tx.execute(
      sql`DELETE FROM goal_timezone_event_receipts WHERE organization_id = ${organization}`,
    )
    await tx.execute(
      sql`DELETE FROM goal_periods WHERE organization_id = ${organization}`,
    )
    await tx.execute(
      sql`DELETE FROM goal_definition_versions WHERE organization_id = ${organization}`,
    )
    await tx.execute(
      sql`DELETE FROM goal_definitions WHERE organization_id = ${organization}`,
    )

    // Retained pre-beta family. `goal_progress` cascades from `goals`, but the
    // explicit tenant-bound delete keeps the plan checkable row by row.
    await tx.execute(
      sql`DELETE FROM goal_progress WHERE organization_id = ${organization}`,
    )
    await tx.execute(sql`DELETE FROM goals WHERE organization_id = ${organization}`)
  } finally {
    for (const guard of APPEND_ONLY_GUARDS) {
      await tx.execute(
        sql`ALTER TABLE ${sql.identifier(guard.table)} ENABLE TRIGGER ${sql.identifier(guard.trigger)}`,
      )
    }
  }

  return {
    outcome: 'complete',
    evidenceRef: evidenceRef('purge', 'tenant_rows_deleted', { rows }),
  }
}

/**
 * The scaffold returns a structurally complete `OrganizationLifecycleContributor`.
 * Deliberately NOT part of `GoalContextApi.publicApi`: only Identity's
 * lifecycle coordinator consumes it, and wiring it must not add a key to any
 * tenant-reachable surface.
 */
export const createGoalOrganizationLifecycleAdapter = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: CONTEXT,
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })

/** Exported for the unit test so each phase body can be exercised alone. */
export const GOAL_ORGANIZATION_LIFECYCLE_PHASES = Object.freeze({
  prepareClosing,
  verifyPurgeReadiness,
  purge,
})
