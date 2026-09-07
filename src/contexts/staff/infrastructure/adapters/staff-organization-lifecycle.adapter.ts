// Staff's Organization lifecycle contribution (LIF-01-T12/T13/T14).
//
// Staff owns the people directory: Staff Participants, their optional login
// link, their per-Property participation, their Portal Responsibility, and the
// effective-dated Portal Group membership that gives event-time attribution its
// meaning.
//
// The three phases answer three different questions, and only the third one is
// allowed to remove anything:
//
//   prepareClosing      — stop effects, keep every row. Closing opens a
//                         recoverable window, so nothing here deletes, ends an
//                         effective-dated interval, or archives a person.
//   verifyPurgeReadiness— read only. Report whether Staff can be purged and
//                         refuse (throw) when it cannot.
//   purge               — irreversible, idempotent, content-free scrub of the
//                         Staff-owned tenant rows. Rows are deleted; no table or
//                         foreign identity is touched.
//
// Every phase runs inside the shared receipt store's transaction, so its work
// and its content-free receipt commit together under the live lifecycle
// authority. See src/shared/db/lifecycle/organization-lifecycle-receipt-store.ts.

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

/**
 * One Staff-owned table plus the predicate that binds its rows to the tenant.
 * The list is static and explicit: a Staff table that is not named here is
 * never read and never scrubbed by this contributor.
 */
type StaffLifecycleTable = Readonly<{
  table: string
  scope: (organizationId: string) => SQL
}>

const byOrganization =
  (table: string) =>
  (organizationId: string): SQL =>
    sql`${sql.identifier(table)}.organization_id = ${organizationId}`

/**
 * Staff-owned tenant tables in FK-safe DELETE order.
 *
 * Order matters because every people foreign key is `ON DELETE RESTRICT` — the
 * schema deliberately refuses to cascade a person away. Children first:
 * responsibilities and memberships reference participations, participations and
 * login links reference participants.
 *
 * Deliberately absent:
 *   * `property_access_grants` / `property_access_grant` — the property-access
 *     authority is Identity's (ADR 0039, context acceptance matrix row 1).
 *     Staff never reads or writes an authorization record.
 *   * `user`, `member`, `session` — a Staff Participant may be a human who is
 *     also a member of ANOTHER Organization. Program bullet 5 keeps user
 *     identities that belong elsewhere, so Staff drops its participation rows
 *     and leaves every identity row to Identity.
 */
const STAFF_TENANT_TABLES: readonly StaffLifecycleTable[] = Object.freeze([
  // Effective-dated responsibility for a Portal; references staff_participations.
  { table: 'portal_responsibilities', scope: byOrganization('portal_responsibilities') },
  // Event-time Portal Group membership (ADR 0040). It is people data, not
  // Portal configuration, which is why Staff — not Portal — scrubs the rows.
  // The TABLE itself is a retained compatibility surface and is never dropped.
  {
    table: 'portal_group_memberships',
    scope: byOrganization('portal_group_memberships'),
  },
  { table: 'staff_participations', scope: byOrganization('staff_participations') },
  { table: 'staff_user_links', scope: byOrganization('staff_user_links') },
  { table: 'staff_participants', scope: byOrganization('staff_participants') },
] as const)

/** Evidence references stay content-free: context, phase, outcome and a count. */
const evidenceRef = (
  phase: 'closing' | 'purge_readiness' | 'purge',
  outcome: 'complete' | 'no_data',
  count: number,
): string => `staff:${phase}:${outcome}:${count}`

const readCount = async (tx: Tx, query: SQL): Promise<number> => {
  const result = await tx.execute(query)
  const rows = result.rows as readonly Record<string, unknown>[]
  const value = rows[0]?.count
  const count = typeof value === 'string' ? Number(value) : value
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Staff lifecycle row count is unavailable')
  }
  return count
}

/** Total retained Staff rows for the tenant, in one round trip. */
const countRetainedRows = (tx: Tx, organizationId: string): Promise<number> =>
  readCount(
    tx,
    sql`SELECT (${sql.join(
      STAFF_TENANT_TABLES.map(
        ({ table, scope }) =>
          sql`(SELECT count(*) FROM ${sql.identifier(table)} WHERE ${scope(organizationId)})`,
      ),
      sql` + `,
    )})::int AS count`,
  )

/**
 * Staff's Closing preparation: stop effects, keep data.
 *
 * Staff mutates NOTHING here, and that is the reviewed decision rather than an
 * omission:
 *
 *   * Staff runs no scheduled job, no event consumer and no external provider
 *     effect. Its only writers are the authenticated participation-management
 *     use cases, and those are already admitted upstream by the Identity-owned
 *     property-access grant authority plus the Organization suspension that the
 *     closure request co-commits. Editing people rows would not add a fence.
 *   * Every remaining Staff surface is effective-dated. Writing `effective_to`
 *     on a login link, a responsibility, or a Portal Group membership — or
 *     archiving a Participant — is a product-meaningful, non-reversible people
 *     fact. Closing is recoverable, and a cancelled closure must not leave a
 *     permanent scar in the people history or silently retract the event-time
 *     attribution of Reviews and Inbox work that was already handled.
 *
 * The receipt is therefore Staff's affirmative acknowledgement that it examined
 * its surface and holds the directory intact for the recovery window.
 */
export const staffPrepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const retained = await countRetainedRows(tx, request.organizationId)
  return retained === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('closing', 'no_data', 0) }
    : { outcome: 'complete', evidenceRef: evidenceRef('closing', 'complete', retained) }
}

/**
 * Staff's purge readiness. READ ONLY — it issues no INSERT, UPDATE or DELETE.
 *
 * A blocked readiness is a real answer: the outcome vocabulary is only
 * `complete | no_data`, so refusing is expressed by throwing. The shared store
 * writes no receipt for a thrown phase, the coordinator counts the pass as
 * failed, and the Organization stays in `closing`. Reporting `complete` to keep
 * things moving would let the irreversible boundary run over live work.
 */
export const staffVerifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  // Staff-sourced facts that are still unpublished are work in flight: a
  // consumer has not seen them yet, and purging the aggregate they name would
  // publish a fact about rows that no longer exist. Recovery-fenced rows are
  // excluded because they are deliberately never published and would otherwise
  // block the boundary forever.
  const pending = await readCount(
    tx,
    sql`SELECT count(*)::int AS count
        FROM outbox_events
        WHERE organization_id = ${request.organizationId}
          AND source_context = 'staff'
          AND published_at IS NULL
          AND recovery_fenced_at IS NULL`,
  )
  if (pending > 0) {
    throw new Error('Staff purge readiness blocked: unpublished_staff_outbox_events')
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
 * Staff's irreversible purge. Only reachable after readiness passed.
 *
 * Idempotent in two independent ways: the shared receipt store replays a
 * recorded outcome without re-entering this function at all, and every DELETE
 * is scoped by tenant so a re-entry after a partial failure simply removes what
 * is left. It changes no schema and never touches a `user`, `member`, `session`
 * or grant row — a Staff Participant who is also a member of another
 * Organization keeps their identity there.
 */
export const staffPurge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  let scrubbed = 0
  for (const { table, scope } of STAFF_TENANT_TABLES) {
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
export const STAFF_LIFECYCLE_TABLES: readonly string[] = Object.freeze(
  STAFF_TENANT_TABLES.map(({ table }) => table),
)

/**
 * Staff-owned Organization lifecycle contributor.
 *
 * Composition supplies it alongside the other contexts; nothing here makes the
 * coordinator reachable, and purge stays unreachable until an explicitly
 * reviewed composition binds the whole set.
 */
export const createStaffOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'staff',
    prepareClosing: staffPrepareClosing,
    verifyPurgeReadiness: staffVerifyPurgeReadiness,
    purge: staffPurge,
  })
