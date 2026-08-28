/**
 * LIF-01 program bullet 12 — read-only inventories for the legacy custom-role,
 * multi-organization and legacy-Guest data that must be reconciled or archived
 * before migration.
 *
 * Billing is already covered by `ops:manage-dormant-billing-data` and the Team
 * tables by `ops:report-legacy-people-team`; these three had no report at all,
 * which meant the bullet-12 preconditions were being asserted rather than
 * observed.
 *
 * Every query below is a COUNT over a static predicate. There is no delete, no
 * update and no write path in this module, because the rows that make a
 * conflict fixable — the second membership, the unmapped role definition, the
 * legacy Guest row with no canonical counterpart — are exactly the rows a
 * cleanup would remove. Read first; decide later.
 *
 * The legacy Guest report deliberately does NOT claim the mirror tables as a
 * contraction inventory. `ops:report-compatibility-read-surfaces` owns that.
 * This one asks a different question: how much of the legacy population can
 * still be reconciled to the canonical Guest Response model, and how much has
 * already lost the pseudonym that would let anyone correlate it.
 */

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { BUILT_IN_ROLE_SCOPE } from '#/shared/auth/resolve-permissions'
import {
  buildReconciliationReport,
  type ReconciliationFinding,
  type ReconciliationReport,
} from './reconciliation-report'

/**
 * Persisted role values that are NOT custom. Derived from the permission
 * authority rather than restated, so a new built-in cannot make this report
 * quietly classify real members as custom-role holders.
 */
export const BUILT_IN_ROLE_NAMES: ReadonlyArray<string> = Object.freeze(
  Object.keys(BUILT_IN_ROLE_SCOPE).sort(),
)

export const CUSTOM_ROLE_REPORT_SUBJECT = 'legacy.custom_roles' as const
export const MULTI_ORG_REPORT_SUBJECT = 'legacy.multi_organization' as const
export const GUEST_COMPATIBILITY_REPORT_SUBJECT = 'legacy.guest_compatibility' as const

const REPORT_VERSION = 1

async function count(db: Database, statement: SQL): Promise<number> {
  const result = await db.execute(statement)
  return Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0)
}

const builtInRoleList = (): SQL =>
  sql.join(
    BUILT_IN_ROLE_NAMES.map((role) => sql`${role}`),
    sql`, `,
  )

// ── Custom roles (spec §3.1.3) ──────────────────────────────────────

/**
 * Runtime custom roles are off for beta and existing custom-role records must
 * be audited and mapped to built-ins. Dormant schema may remain — so this
 * report distinguishes a dormant DEFINITION (harmless, archivable) from a
 * member or a pending invitation actually HOLDING a custom role, which is a
 * real authorization question the migration cannot answer on its own.
 */
export async function readLegacyCustomRoleInventory(
  db: Database,
  asOf: Date,
): Promise<ReconciliationReport> {
  const builtIns = builtInRoleList()

  const findings: ReconciliationFinding[] = [
    {
      id: 'members_holding_custom_role',
      severity: 'blocks_migration',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM "member" WHERE role NOT IN (${builtIns})`,
      ),
      meaning:
        'A member row grants a role that is not a beta built-in. Its effective permissions come from a custom definition that beta does not evaluate at runtime.',
      remediation:
        'Map each holder to AccountAdmin or PropertyManager with a recorded decision before migration. Do not delete the member row — the custom role name is the only evidence of what access was intended.',
    },
    {
      id: 'pending_invitations_on_custom_role',
      severity: 'blocks_migration',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM invitation WHERE status = 'pending' AND role IS NOT NULL AND role NOT IN (${builtIns})`,
      ),
      meaning:
        'A still-pending invitation would create a member on a custom role the moment it is accepted, re-introducing the conflict after the audit.',
      remediation:
        'Re-issue the invitation on a built-in role, or expire it, before migration. Accepting it afterwards silently reopens the finding above.',
    },
    {
      id: 'custom_role_definitions_without_policy',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM "organizationRole" r
            WHERE r.role NOT IN (${builtIns})
              AND NOT EXISTS (
                SELECT 1 FROM organization_role_policy p
                WHERE p.organization_id = r."organizationId" AND p.role = r.role
              )`,
      ),
      meaning:
        'A custom role definition has no app-owned data-scope row, so its effective scope is undefined rather than merely unused. A mapping decision cannot be justified from the definition alone.',
      remediation:
        'Record the intended data scope alongside the mapping decision. The definition is dormant schema and may remain.',
    },
    {
      id: 'orphan_role_policies',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM organization_role_policy p
            WHERE p.role NOT IN (${builtIns})
              AND NOT EXISTS (
                SELECT 1 FROM "organizationRole" r
                WHERE r."organizationId" = p.organization_id AND r.role = p.role
              )`,
      ),
      meaning:
        'A data-scope row survives a role definition that no longer exists. It grants nothing, but it is evidence of a role that was once live.',
      remediation:
        'Archive with the audit, do not delete: an orphan policy row is often the only remaining record of a deleted custom role.',
    },
    {
      id: 'custom_role_definitions',
      severity: 'informational',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM "organizationRole" WHERE role NOT IN (${builtIns})`,
      ),
      meaning:
        'Total dormant custom role definitions. Definitions alone are not a beta violation — spec §3.1.3 allows the dormant schema to remain.',
      remediation:
        'No action required by itself. Retain as the audit trail for every mapping decision above.',
    },
  ]

  return buildReconciliationReport({
    subject: CUSTOM_ROLE_REPORT_SUBJECT,
    version: REPORT_VERSION,
    asOf,
    findings,
  })
}

// ── Multi-organization membership (spec §3.1.4) ─────────────────────

/**
 * A beta user has one active Organization Membership TOTAL. Multi-Organization
 * records are retained and audited, and a new conflicting invitation pauses for
 * support. The binding table makes a second simultaneous active binding
 * unrepresentable, so the conflicts worth reporting are the ones that live
 * OUTSIDE it: legacy `member` rows the binding never captured, and bindings
 * that disagree with the memberships they are supposed to summarize.
 */
export async function readLegacyMultiOrganizationInventory(
  db: Database,
  asOf: Date,
): Promise<ReconciliationReport> {
  const findings: ReconciliationFinding[] = [
    {
      id: 'users_with_multiple_memberships',
      severity: 'blocks_migration',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM (
              SELECT "userId" FROM "member" GROUP BY "userId" HAVING count(DISTINCT "organizationId") > 1
            ) AS multi`,
      ),
      meaning:
        'A user holds membership in more than one Organization, which beta does not support. Which membership is the active one is a support decision, not a migration default.',
      remediation:
        'Resolve each user to one active Organization with a recorded reason and release the others through the binding state machine. Retain the released membership rows as the audit trail.',
    },
    {
      id: 'binding_disagrees_with_membership',
      severity: 'blocks_migration',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM user_organization_bindings b
            WHERE b.state = 'active'
              AND b.organization_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM "member" m
                WHERE m."userId" = b.user_id AND m."organizationId" = b.organization_id
              )`,
      ),
      meaning:
        'An active binding names an Organization the user is not actually a member of. The binding is the tenant-resolution authority, so this resolves a session into an Organization the membership table does not back.',
      remediation:
        'Reconcile the binding against the member rows before migration. Do not delete either side — the disagreement itself is the evidence of what went wrong.',
    },
    {
      id: 'members_without_binding',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM (
              SELECT DISTINCT m."userId" FROM "member" m
              WHERE NOT EXISTS (
                SELECT 1 FROM user_organization_bindings b WHERE b.user_id = m."userId"
              )
            ) AS unbound`,
      ),
      meaning:
        'A user has membership rows but no binding row at all, so the one-active-membership invariant has never been asserted for them.',
      remediation:
        'Backfill a binding with source `backfill` after confirming which membership is active. Never infer it from row order.',
    },
    {
      id: 'bindings_awaiting_support_resolution',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM user_organization_bindings WHERE state = 'support_resolution'`,
      ),
      meaning:
        'A conflicting invitation already paused for support, exactly as §3.1.4 requires. These are known, open cases rather than undiscovered ones.',
      remediation:
        'Close each case through support before migration so the migration does not inherit an ambiguous active Organization.',
    },
    {
      id: 'pending_invitations_to_bound_users',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM invitation i
            JOIN "user" u ON lower(u.email) = lower(i.email)
            JOIN user_organization_bindings b ON b.user_id = u.id
            WHERE i.status = 'pending'
              AND b.state = 'active'
              AND b.organization_id IS NOT NULL
              AND b.organization_id <> i."organizationId"`,
      ),
      meaning:
        'A pending invitation would give an already-bound user a second Organization the moment it is accepted, recreating the conflict after migration.',
      remediation:
        'Pause or expire these invitations before migration. §3.1.4 requires them to route to support rather than to auto-accept.',
    },
    {
      id: 'released_bindings',
      severity: 'informational',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM user_organization_bindings WHERE state = 'released'`,
      ),
      meaning:
        'Bindings already resolved and released. Retained deliberately as the audit trail for a past multi-Organization decision.',
      remediation:
        'No action. Do not prune: the released row plus its resolution reason is the record of why a user lost an Organization.',
    },
  ]

  return buildReconciliationReport({
    subject: MULTI_ORG_REPORT_SUBJECT,
    version: REPORT_VERSION,
    asOf,
    findings,
  })
}

// ── Legacy Guest compatibility rows ─────────────────────────────────

/**
 * The pre-beta `ratings` / `feedback` / `scan_events` tables are
 * `compatibility_read` mirrors superseded by the canonical Guest Response
 * model. Bullet 12 wants them reconciled or archived before migration.
 *
 * The finding that matters is correlation loss: the retention sweep redacts
 * `session_id` at 24 hours, and `session_id` + `portal_id` is the only handle
 * that could ever tie a legacy row to a canonical Guest Response. Once it is
 * null the row can be counted and archived but never reconciled. That number is
 * the deadline on the whole exercise, so it is reported first-class rather than
 * discovered during the migration.
 */
export async function readLegacyGuestCompatibilityInventory(
  db: Database,
  asOf: Date,
): Promise<ReconciliationReport> {
  const findings: ReconciliationFinding[] = [
    {
      id: 'legacy_ratings',
      severity: 'informational',
      count: await count(db, sql`SELECT count(*)::int AS count FROM ratings`),
      meaning:
        'Total pre-beta rating rows still held in the compatibility mirror. Read-only; the mirror stays until one verified release plus a restore proof.',
      remediation:
        'No deletion. This count is the denominator for the correlation findings below.',
    },
    {
      id: 'legacy_feedback',
      severity: 'informational',
      count: await count(db, sql`SELECT count(*)::int AS count FROM feedback`),
      meaning: 'Total pre-beta feedback rows, including guest-authored comment text.',
      remediation:
        'No deletion. Guest text here is subject to the same private-feedback class as the canonical model; see the retention registry.',
    },
    {
      id: 'legacy_scan_events',
      severity: 'informational',
      count: await count(db, sql`SELECT count(*)::int AS count FROM scan_events`),
      meaning: 'Total pre-beta scan events in the compatibility mirror.',
      remediation: 'No deletion.',
    },
    {
      id: 'ratings_without_correlatable_session',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM ratings WHERE session_id IS NULL`,
      ),
      meaning:
        'The session pseudonym has already been redacted, so this row can never be tied to a canonical Guest Response. It can be counted and archived; it cannot be reconciled.',
      remediation:
        'Accept as unreconcilable and record it in the migration coverage note. Do not attempt to re-derive the pseudonym — that would be re-identification.',
    },
    {
      id: 'feedback_without_correlatable_session',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM feedback WHERE session_id IS NULL`,
      ),
      meaning:
        'Guest-authored legacy text whose session pseudonym is gone. The text survives; the link to a canonical response does not.',
      remediation:
        'Decide archive-or-expire for this population explicitly. It is the strongest argument for settling the legacy-compatibility retention question with counsel.',
    },
    {
      id: 'ratings_without_canonical_response',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM ratings r
            WHERE r.session_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM guest_response_session_bindings b
                WHERE b.portal_id = r.portal_id AND b.session_id::text = r.session_id
              )`,
      ),
      meaning:
        'A still-correlatable legacy rating with no canonical Guest Response for the same portal and session. Either it predates the canonical model or it was never migrated.',
      remediation:
        'Reconcile while the pseudonym still exists. The session binding expires 24 hours after submission, so this number can only shrink into the unreconcilable bucket.',
    },
    {
      id: 'orphan_feedback_without_rating',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT count(*)::int AS count FROM feedback WHERE rating_id IS NULL`,
      ),
      meaning:
        'Legacy feedback with no owning rating. The beta contract puts the private rating first, so this row has no valid canonical shape.',
      remediation:
        'Classify each as a migration exception with a recorded reason rather than forcing it into a canonical response.',
    },
    {
      id: 'legacy_rows_with_live_abuse_pseudonym',
      severity: 'needs_review',
      count: await count(
        db,
        sql`SELECT
              (SELECT count(*) FROM ratings WHERE ip_hash IS NOT NULL)
            + (SELECT count(*) FROM feedback WHERE ip_hash IS NOT NULL)
            + (SELECT count(*) FROM scan_events WHERE ip_hash IS NOT NULL) AS count`,
      ),
      meaning:
        'Mirror rows still carrying an abuse pseudonym. The scheduled sweep redacts these at seven days without deleting the row, so the contraction inventory count is unaffected.',
      remediation:
        'None beyond letting the sweep run. A non-zero count that never falls means the redaction rules stopped running.',
    },
    {
      id: 'canonical_guest_responses',
      severity: 'informational',
      count: await count(db, sql`SELECT count(*)::int AS count FROM guest_responses`),
      meaning:
        'Canonical Guest Responses. Reported alongside the mirror counts so the migration coverage claim can be checked rather than trusted.',
      remediation: 'No action.',
    },
  ]

  return buildReconciliationReport({
    subject: GUEST_COMPATIBILITY_REPORT_SUBJECT,
    version: REPORT_VERSION,
    asOf,
    findings,
  })
}
