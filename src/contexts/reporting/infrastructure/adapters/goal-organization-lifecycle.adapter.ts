// Goal Organization lifecycle contributor (LIF-01-T12/T13/T14).
//
// Cross-context adapter implementation: CONTEXT.md "Dependency rules" lets an
// `infrastructure/adapters/**` file import the foreign `application/ports/**`
// contract it implements, and nothing else from Identity. Authority binding,
// the advisory lock, receipt idempotence and the append-only content-free
// receipt row all come from the shared store — this file only supplies the
// three reviewed phase bodies.
//
// Goal owns an active tenant-cross maintenance schedule that activates
// scheduled programs and appends, reconciles, or closes monthly results.
// Organization closure must stop it starting work through the recoverable
// window: the Closing phase pauses the active programs, maintenance does not
// list or activate any program of an Organization the lifecycle holds, and
// the use cases refuse a manager who would create, start or resume a goal
// there (goal-organization-lifecycle-hold.ts). A month that is already open
// still reconciles and closes, which is how purge readiness comes to find none.

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
 * Static, reviewed purge plan in FK-safe order. Every surviving Goal table is
 * tenant-scoped and deleted only by the irreversible lifecycle phase.
 */
export const GOAL_PURGE_TABLES = Object.freeze([
  // The month target log holds its month, its Program and the version that
  // carried a target forward with ON DELETE RESTRICT, so it goes first.
  'goal_month_target_changes',
  'goal_result_revisions',
  'goal_monthly_results',
  'goal_subject_assignments',
  'goal_program_versions',
  'goal_programs',
  // The Google rating goal is its own family (not a Goal Program): its change
  // log holds the goal with ON DELETE RESTRICT, so the log goes first.
  'property_rating_goal_changes',
  'property_rating_goals',
] as const)

/**
 * The monthly-result validation guard rejects deletion alongside enforcing its
 * status and revision transitions, so irreversible tenant purge disables it
 * transactionally. Program versions and result revisions are append-only
 * through their repository write surfaces and need no database trigger. The
 * month target log has none either, so purge needs no bypass for it.
 *
 * `ALTER TABLE ... DISABLE TRIGGER` is transactional in PostgreSQL, so the
 * guard is restored by the same commit that carries the receipt — and
 * automatically by a rollback if the phase fails. Deliberately NOT
 * `session_replication_role = 'replica'`, which would also suppress the system
 * triggers implementing foreign keys and silently orphan rows.
 *
 * Known cost: the statement takes SHARE ROW EXCLUSIVE on the table, which
 * conflicts with every insert, update and delete of a monthly result, and it
 * is held until this phase's transaction ends. While one Organization is
 * purged, every other Organization's writes to `goal_monthly_results` wait
 * (and fail at the pool's 10 s lock timeout if the purge outlasts it). No
 * other session ever sees the guard off: they are blocked, not unguarded.
 * Removing the lock needs the guard function itself to admit a purge's delete
 * under a transaction-local setting, which is a migration.
 */
const PURGE_GUARDS = Object.freeze([
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

/** Total tenant-scoped rows across the Goal Program and rating goal families. */
async function countTenantRows(tx: Tx, organization: string): Promise<number> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM goal_programs WHERE organization_id = ${organization})
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
      )
      + (
        SELECT count(*) FROM goal_month_target_changes
        WHERE organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM property_rating_goal_changes
        WHERE organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM property_rating_goals
        WHERE organization_id = ${organization}
      ) AS rows
  `)
  return count((result.rows[0] as { rows?: unknown } | undefined)?.rows)
}

/**
 * Closing — STOP EFFECTS, KEEP DATA.
 *
 * A Google rating goal starts no work of its own (no schedule; it is evaluated
 * when Google's numbers arrive or are read), so Closing leaves it as it is and
 * the rating goal commands refuse to set one while the lifecycle holds the
 * Organization.
 *
 * Pauses every ACTIVE Goal Program for the tenant. `maintain()` opens months
 * only for an active program, so this stops new months for the Organization
 * without deleting or scrubbing a single business row. (A month already open
 * still reconciles and closes: purge readiness waits for none to be left.)
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
 * performs no mutation until `maintain()` activates it. A closure request
 * suspends nothing, so activation is what stops: `maintain()` neither lists
 * nor activates a program whose Organization the lifecycle holds (a closure
 * requested or in progress, or cancelled and awaiting reactivation), and the
 * use cases refuse to create, start or resume a goal there
 * (`organization_closing`). Without that, the job would activate a goal set
 * for next month inside the recovery window, and a manager could resume a goal
 * this phase paused or set one for the current month; the readiness check
 * below would refuse the Organization for good.
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
async function purgeResultRevisionChain(tx: Tx, organization: string): Promise<void> {
  for (let pass = 0; pass < MAX_SUPERSESSION_PASSES; pass += 1) {
    const result = await tx.execute(sql`
      DELETE FROM goal_result_revisions AS target
      WHERE target.organization_id = ${organization}
        AND NOT EXISTS (
          SELECT 1 FROM goal_result_revisions AS successor
          WHERE successor.supersedes_revision_id = target.id
        )
    `)
    if ((result.rowCount ?? 0) === 0) return
  }
  throw new Error('goal purge could not drain the result revision supersession chain')
}

/**
 * Purge — IRREVERSIBLE, idempotent, content-free.
 *
 * Every statement is bound to one organization id and the order follows
 * GOAL_PURGE_TABLES, which is the FK topology: every table is removed before
 * the one it references.
 *
 * Metric's code-reviewed catalogue, `properties`, `portals` and
 * `portal_groups` belong to other contexts. This phase releases Goal's
 * references; those contexts remain responsible for their own rows.
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

  for (const guard of PURGE_GUARDS) {
    await tx.execute(
      sql`ALTER TABLE ${sql.identifier(guard.table)} DISABLE TRIGGER ${sql.identifier(guard.trigger)}`,
    )
  }
  // Canonical Goal Program family, children first. No `finally` around these:
  // a statement that fails aborts the transaction, so a re-enable sent after
  // it is refused ("current transaction is aborted") and that refusal would be
  // reported in place of the failure. The rollback restores the guard.
  await tx.execute(
    sql`DELETE FROM goal_month_target_changes WHERE organization_id = ${organization}`,
  )
  await purgeResultRevisionChain(tx, organization)
  await tx.execute(
    sql`DELETE FROM goal_monthly_results WHERE organization_id = ${organization}`,
  )
  await tx.execute(
    sql`DELETE FROM goal_subject_assignments WHERE organization_id = ${organization}`,
  )
  await tx.execute(
    sql`DELETE FROM goal_program_versions WHERE organization_id = ${organization}`,
  )
  await tx.execute(sql`DELETE FROM goal_programs WHERE organization_id = ${organization}`)
  // The Google rating goal family, its change log first.
  await tx.execute(
    sql`DELETE FROM property_rating_goal_changes WHERE organization_id = ${organization}`,
  )
  await tx.execute(
    sql`DELETE FROM property_rating_goals WHERE organization_id = ${organization}`,
  )
  for (const guard of PURGE_GUARDS) {
    await tx.execute(
      sql`ALTER TABLE ${sql.identifier(guard.table)} ENABLE TRIGGER ${sql.identifier(guard.trigger)}`,
    )
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
