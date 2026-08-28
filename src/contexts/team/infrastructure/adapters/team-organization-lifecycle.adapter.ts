// Team's Organization lifecycle contribution (LIF-01-T12/T13/T14).
//
// `team.use` is DISABLED: Team is quarantined historical data and Portal Groups
// are not Teams. `buildTeamContext` therefore constructs no repository, command,
// job, consumer or network surface. A dark capability is a reason to have no
// live effect — it is NOT a reason to stay silent. An omitted contributor would
// make a partial purge look complete, so Team answers all three phases.
//
// Team still holds real tenant rows (`teams`, `team_memberships`,
// `team_portal_group_scopes`), so its answers are `complete` when those rows
// exist and the affirmative `no_data` when they do not.

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

type TeamLifecycleTable = Readonly<{
  table: string
  scope: (organizationId: string) => SQL
}>

const byOrganization =
  (table: string) =>
  (organizationId: string): SQL =>
    sql`${sql.identifier(table)}.organization_id = ${organizationId}`

/**
 * Team-owned tenant tables in FK-safe DELETE order.
 *
 * `team_memberships` and `team_portal_group_scopes` both reference `teams` with
 * `ON DELETE RESTRICT`, so the children go first.
 *
 * Deliberately absent: `staff_participations`, which `team_memberships`
 * references. Staff owns the people record and scrubs it from its own
 * contributor; Team only releases its side of the link.
 */
const TEAM_TENANT_TABLES: readonly TeamLifecycleTable[] = Object.freeze([
  { table: 'team_memberships', scope: byOrganization('team_memberships') },
  {
    table: 'team_portal_group_scopes',
    scope: byOrganization('team_portal_group_scopes'),
  },
  { table: 'teams', scope: byOrganization('teams') },
] as const)

/** Evidence references stay content-free: context, phase, outcome and a count. */
const evidenceRef = (
  phase: 'closing' | 'purge_readiness' | 'purge',
  outcome: 'complete' | 'no_data',
  count: number,
): string => `team:${phase}:${outcome}:${count}`

const readCount = async (tx: Tx, query: SQL): Promise<number> => {
  const result = await tx.execute(query)
  const rows = result.rows as readonly Record<string, unknown>[]
  const value = rows[0]?.count
  const count = typeof value === 'string' ? Number(value) : value
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Team lifecycle row count is unavailable')
  }
  return count
}

const countRetainedRows = (tx: Tx, organizationId: string): Promise<number> =>
  readCount(
    tx,
    sql`SELECT (${sql.join(
      TEAM_TENANT_TABLES.map(
        ({ table, scope }) =>
          sql`(SELECT count(*) FROM ${sql.identifier(table)} WHERE ${scope(organizationId)})`,
      ),
      sql` + `,
    )})::int AS count`,
  )

/**
 * Team's Closing preparation: stop effects, keep data.
 *
 * Team has no scheduled work, no consumer and no provider effect to cancel:
 * `buildTeamContext` composes nothing, so there is no live surface for Closing
 * to make unavailable. That darkness is held by the architecture pins
 * (`legacy-recognition-active-surfaces`, the runtime-contraction pin and the
 * inert build boundary) and is asserted in this adapter's own tests — this
 * module deliberately does NOT read the build boundary at runtime, because
 * `infrastructure/**` may not reach the composition layer.
 *
 * It also mutates nothing: the retained rows are CNV-01 reconciliation input,
 * closure is recoverable, and ending an effective-dated membership interval
 * would be an unrecoverable edit to history inside a window whose whole point
 * is that it can be cancelled.
 */
export const teamPrepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const retained = await countRetainedRows(tx, request.organizationId)
  return retained === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('closing', 'no_data', 0) }
    : { outcome: 'complete', evidenceRef: evidenceRef('closing', 'complete', retained) }
}

/**
 * Team's purge readiness. READ ONLY — no INSERT, UPDATE or DELETE is issued.
 * Refusal is expressed by throwing, which leaves the Organization in `closing`.
 */
export const teamVerifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  // Team emits nothing while dark, so an unpublished `team.*` fact means a
  // writer exists that this quarantine does not know about. Recovery-fenced
  // rows are excluded: they are deliberately never published.
  const pending = await readCount(
    tx,
    sql`SELECT count(*)::int AS count
        FROM outbox_events
        WHERE organization_id = ${request.organizationId}
          AND source_context = 'team'
          AND published_at IS NULL
          AND recovery_fenced_at IS NULL`,
  )
  if (pending > 0) {
    throw new Error('Team purge readiness blocked: unpublished_team_outbox_events')
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
 * Team's irreversible purge. Rows are deleted; the physical tables — which are
 * blocked from any DROP until CNV-01 contraction completes — are untouched.
 */
export const teamPurge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  let scrubbed = 0
  for (const { table, scope } of TEAM_TENANT_TABLES) {
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
  return scrubbed === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('purge', 'no_data', 0) }
    : { outcome: 'complete', evidenceRef: evidenceRef('purge', 'complete', scrubbed) }
}

/** The static, reviewable table plan. Exported for the contract tests. */
export const TEAM_LIFECYCLE_TABLES: readonly string[] = Object.freeze(
  TEAM_TENANT_TABLES.map(({ table }) => table),
)

export const createTeamOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'team',
    prepareClosing: teamPrepareClosing,
    verifyPurgeReadiness: teamVerifyPurgeReadiness,
    purge: teamPurge,
  })
