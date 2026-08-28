// Badge's Organization lifecycle contribution (LIF-01-T12/T13/T14).
//
// `badge.use` is `legacy_blocked`: the legacy Badge program is not the accepted
// recognition model and will never be reactivated. `buildBadgeContext`
// constructs no repository, producer, use case, consumer or scheduled job.
// A dark capability withholds future behaviour, not the tenant's own past
// records — so Badge still answers all three phases, and an Organization that
// accumulated Recognition rows gets real work rather than a shrug.

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

type BadgeLifecycleTable = Readonly<{
  table: string
  scope: (organizationId: string) => SQL
}>

const byOrganization =
  (table: string) =>
  (organizationId: string): SQL =>
    sql`${sql.identifier(table)}.organization_id = ${organizationId}`

/**
 * Badge-owned tenant tables in FK-safe DELETE order.
 *
 * A governed award is append-only and a correction is a separate status fact,
 * so the status facts go before the awards they annotate.
 *
 * Deliberately absent:
 *   * `badge_definitions` and `badge_definition_versions` — one global,
 *     migration-seeded, RepKey-authored catalogue with no `organization_id`.
 *     It is product configuration, not tenant content; deleting from it during
 *     one tenant's closure would corrupt every other tenant.
 *   * `recognition_activations`, `recognition_board_snapshots` and the rest of
 *     the board surface — Leaderboard's contributor owns those.
 */
const BADGE_TENANT_TABLES: readonly BadgeLifecycleTable[] = Object.freeze([
  {
    table: 'recognition_award_status_facts',
    scope: byOrganization('recognition_award_status_facts'),
  },
  { table: 'recognition_awards', scope: byOrganization('recognition_awards') },
  { table: 'badge_awards', scope: byOrganization('badge_awards') },
  {
    table: 'organization_badge_enablements',
    scope: byOrganization('organization_badge_enablements'),
  },
] as const)

/**
 * `recognition_awards.source_snapshot_id` references Leaderboard's
 * `recognition_board_snapshots`, so Badge's purge must land before
 * Leaderboard's. The coordinator runs contributors concurrently: Leaderboard's
 * snapshot DELETE either waits on Badge's uncommitted child delete and then
 * succeeds, or it fails, writes no receipt, and converges on the next pass.
 * Neither context deletes the other's rows to avoid the wait.
 */
const PURGE_ORDER_NOTE = 'badge_awards_before_recognition_board_snapshots' as const

/**
 * Append-only guards that block a tenant purge (migration 0025).
 *
 * They exist so product code can never rewrite a Recognition award or its
 * correction. A purge is not product code: it is the reviewed irreversible
 * boundary, and the row must physically go. `ALTER TABLE ... DISABLE TRIGGER`
 * is transactional in PostgreSQL, so the guards are restored by the same
 * commit that carries the receipt — and automatically by a rollback if the
 * phase fails. Deliberately NOT `session_replication_role = 'replica'`, which
 * would also suppress the system triggers implementing foreign keys and
 * silently orphan rows.
 */
const APPEND_ONLY_GUARDS: readonly Readonly<{ table: string; trigger: string }>[] =
  Object.freeze([
    Object.freeze({
      table: 'recognition_award_status_facts',
      trigger: 'recognition_award_status_facts_append_only',
    }),
    Object.freeze({
      table: 'recognition_awards',
      trigger: 'recognition_awards_append_only',
    }),
  ] as const)

/** Evidence references stay content-free: context, phase, outcome and a count. */
const evidenceRef = (
  phase: 'closing' | 'purge_readiness' | 'purge',
  outcome: 'complete' | 'no_data',
  count: number,
): string => `badge:${phase}:${outcome}:${count}`

const readCount = async (tx: Tx, query: SQL): Promise<number> => {
  const result = await tx.execute(query)
  const rows = result.rows as readonly Record<string, unknown>[]
  const value = rows[0]?.count
  const count = typeof value === 'string' ? Number(value) : value
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Badge lifecycle row count is unavailable')
  }
  return count
}

const countRetainedRows = (tx: Tx, organizationId: string): Promise<number> =>
  readCount(
    tx,
    sql`SELECT (${sql.join(
      BADGE_TENANT_TABLES.map(
        ({ table, scope }) =>
          sql`(SELECT count(*) FROM ${sql.identifier(table)} WHERE ${scope(organizationId)})`,
      ),
      sql` + `,
    )})::int AS count`,
  )

/**
 * Badge's Closing preparation: stop effects, keep data.
 *
 * Badge composes nothing, so there is no live surface for Closing to make
 * unavailable; that darkness is held by the capability fate authority and the
 * `legacy-recognition-active-surfaces` pin, and is asserted in this adapter's
 * own tests. This module deliberately does NOT read the build boundary at
 * runtime, because `infrastructure/**` may not reach the composition layer.
 *
 * Nothing is mutated either. `organization_badge_enablements.enabled` is the obvious
 * flip, and it is deliberately NOT flipped: the column carries no reason
 * marker, so a closure could not tell its own suppressions apart from the
 * tenant's genuine opt-outs and a cancelled closure could never restore them.
 * The award and enablement rows are also CNV-01 contraction inventory, and
 * closing must not rewrite the inventory it may later have to export.
 */
export const badgePrepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const retained = await countRetainedRows(tx, request.organizationId)
  return retained === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('closing', 'no_data', 0) }
    : { outcome: 'complete', evidenceRef: evidenceRef('closing', 'complete', retained) }
}

/**
 * Badge's purge readiness. READ ONLY — no INSERT, UPDATE or DELETE is issued.
 * Refusal is expressed by throwing, which leaves the Organization in `closing`.
 */
export const badgeVerifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const pending = await readCount(
    tx,
    sql`SELECT count(*)::int AS count
        FROM outbox_events
        WHERE organization_id = ${request.organizationId}
          AND source_context = 'badge'
          AND published_at IS NULL
          AND recovery_fenced_at IS NULL`,
  )
  if (pending > 0) {
    throw new Error('Badge purge readiness blocked: unpublished_badge_outbox_events')
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
 * Badge's irreversible purge. Rows are deleted; the global definition catalogue
 * and every physical table are untouched.
 */
export const badgePurge = async (
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
    for (const { table, scope } of BADGE_TENANT_TABLES) {
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
export const BADGE_LIFECYCLE_TABLES: readonly string[] = Object.freeze(
  BADGE_TENANT_TABLES.map(({ table }) => table),
)

export { PURGE_ORDER_NOTE as BADGE_PURGE_ORDER_NOTE }

/** The append-only guards the purge lifts, for the contract tests. */
export const BADGE_LIFECYCLE_APPEND_ONLY_GUARDS: readonly string[] = Object.freeze(
  APPEND_ONLY_GUARDS.map(({ trigger }) => trigger),
)

export const createBadgeOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'badge',
    prepareClosing: badgePrepareClosing,
    verifyPurgeReadiness: badgeVerifyPurgeReadiness,
    purge: badgePurge,
  })
