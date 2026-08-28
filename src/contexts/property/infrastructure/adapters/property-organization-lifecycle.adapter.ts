// LIF-01 bullets 4 and 5 — the Property context's Organization lifecycle
// contribution (LIF-01-T12/T13/T14).
//
// This is a cross-context adapter implementation, so it may import the
// contributor port it implements and nothing else from Identity (see
// src/contexts/CONTEXT.md "Dependency rules" and the port header). Every
// authority, lock, fingerprint and receipt concern lives in the shared store;
// what a reviewer has to read here is the three phase bodies.
//
// Reading order: PROPERTY_PURGE_PLAN first (what is scrubbed, and what is
// deliberately left to another owner), then the three phases.

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  validateContentFreeEvidenceRef,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import {
  properties,
  propertyResponsibleManagers,
} from '#/shared/db/schema/property.schema'
import { propertyOperationReceipts } from '#/shared/db/schema/property-operation-receipt.schema'
import type { Tx } from '#/shared/outbox/commit'

/**
 * The Property lifecycle state a suspended-by-closure row is parked in.
 *
 * `isPropertyActive` — the request-time gate every cross-context external
 * effect and the public Portal gateway consult — is exactly
 * `lifecycleState === 'active'`, so moving off `active` closes new provider
 * work everywhere at once without touching a single provider identifier,
 * responsible-manager interval or operation receipt.
 */
const CLOSING_LIFECYCLE_STATE = 'suspended'

/**
 * Suspension is only reversible if the restore side can tell OUR rows apart
 * from a Property a tenant suspended for its own reasons. The lineage id is a
 * content-free UUID, so stamping it into the free-text lifecycle reason gives
 * explicit reactivation an exact predicate ("everything this closure
 * suspended") without recording why the tenant is leaving.
 */
export function propertyClosingLifecycleReason(closureLineageId: string): string {
  return `organization_closure:${closureLineageId}`
}

const CLOSING_ACTOR = 'system:organization-lifecycle'

/**
 * Property lifecycle states that still admit new provider work.
 *
 * `active` admits everything. `disconnecting` is a Google-binding teardown in
 * flight, which is provider work that has not settled. Purge readiness must
 * fail closed while either exists: crossing the irreversible boundary with a
 * live provider effect would leave an external side effect nobody can undo.
 */
const ADMITTING_LIFECYCLE_STATES = ['active', 'disconnecting'] as const

/**
 * The explicit, static Property purge plan, innermost dependency first.
 *
 * Deliberately NOT here:
 * - `portals`, `portal_groups` and every Guest table: they are FK children of
 *   `properties` but belong to the Portal and Guest contexts, which supply
 *   their own receipts. Deleting another owner's rows from here would make a
 *   partial purge look complete.
 * - `google_connections`: Organization-level provider authority owned by
 *   Integration. `properties.google_connection_id` is only a reference.
 * - `user`, `member`, Staff participants: identities and people records that
 *   survive an Organization because they may belong to another one.
 *
 * Every entry is a row delete inside a bound `organization_id` scope. No entry
 * is ever a DROP or TRUNCATE: physical schema contraction is a separate,
 * expand/backfill/contract decision and is not a lifecycle phase.
 */
export const PROPERTY_PURGE_PLAN = Object.freeze([
  'property_operation_receipts',
  'property_responsible_managers',
  'properties',
] as const)

export type PropertyLifecycleWorkbench = Readonly<{
  /** Closing: stop new provider work. Returns the number of rows fenced. */
  suspendProviderAdmission(
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<number>
  /** Readiness: how many Properties still admit provider work. READ ONLY. */
  countAdmittingProperties(tx: Tx, organizationId: string): Promise<number>
  /** Presence: does this Organization own any Property-context row at all? */
  countTenantRows(tx: Tx, organizationId: string): Promise<number>
  /** Purge: irreversible, content-free scrub of the plan above. */
  scrubTenantRows(tx: Tx, organizationId: string): Promise<void>
}>

function count(row: Record<string, unknown> | undefined, key: string): number {
  return Number(row?.[key] ?? 0)
}

export const drizzlePropertyLifecycleWorkbench: PropertyLifecycleWorkbench =
  Object.freeze({
    suspendProviderAdmission: async (tx, request) => {
      // Only `active` rows move. A Property the tenant already archived keeps
      // its own state and its own recovery deadline, so cancelling the closure
      // cannot silently un-archive it.
      const fenced = await tx
        .update(properties)
        .set({
          lifecycleState: CLOSING_LIFECYCLE_STATE,
          lifecycleReason: propertyClosingLifecycleReason(request.closureLineageId),
          lifecycleStateChangedAt: request.occurredAt,
          lifecycleInitiatedBy: CLOSING_ACTOR,
          updatedAt: request.occurredAt,
        })
        .where(
          and(
            eq(properties.organizationId, request.organizationId),
            eq(properties.lifecycleState, 'active'),
          ),
        )
        .returning({ id: properties.id })
      return fenced.length
    },

    countAdmittingProperties: async (tx, organizationId) => {
      const admitting = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, organizationId),
            inArray(properties.lifecycleState, [...ADMITTING_LIFECYCLE_STATES]),
          ),
        )
      return admitting.length
    },

    countTenantRows: async (tx, organizationId) => {
      const result = await tx.execute(sql`
        SELECT
          (
            SELECT COUNT(*)::int FROM ${properties}
            WHERE ${properties.organizationId} = ${organizationId}
          )
          + (
            SELECT COUNT(*)::int FROM ${propertyResponsibleManagers}
            WHERE ${propertyResponsibleManagers.organizationId} = ${organizationId}
          )
          + (
            SELECT COUNT(*)::int FROM ${propertyOperationReceipts}
            WHERE ${propertyOperationReceipts.organizationId} = ${organizationId}
          ) AS "rows"
      `)
      return count(result.rows[0], 'rows')
    },

    scrubTenantRows: async (tx, organizationId) => {
      // Receipts first: they hold a RESTRICT reference to the destination
      // Property, so the Property row cannot go while a receipt still names it.
      await tx
        .delete(propertyOperationReceipts)
        .where(eq(propertyOperationReceipts.organizationId, organizationId))
      await tx
        .delete(propertyResponsibleManagers)
        .where(eq(propertyResponsibleManagers.organizationId, organizationId))
      // Portal/Guest rows RESTRICT this delete until their own contexts have
      // purged. That is deliberate: the phase throws, the lifecycle state stays
      // at `purging`, other contexts keep their receipts, and the next pass
      // converges. It must never become a cascade that erases another owner's
      // rows without that owner's receipt.
      await tx.delete(properties).where(eq(properties.organizationId, organizationId))
    },
  })

function evidenceRef(
  phase: 'closing' | 'purge_readiness' | 'purge',
  outcome: 'complete' | 'no_data',
  request: OrganizationLifecycleContributionRequest,
): string {
  // Identifiers, enums and a revision only. No Property name, slug, address,
  // provider identifier or count reaches the receipt.
  return validateContentFreeEvidenceRef(
    `property:${phase}:${outcome}:${request.closureLineageId}:r${request.lifecycleRevision}`,
  )
}

export const PROPERTY_PURGE_READINESS_BLOCKED =
  'property purge readiness blocked: Properties still admit provider work'

export const createPropertyOrganizationLifecycleContributor = (
  db: Database,
  workbench: PropertyLifecycleWorkbench = drizzlePropertyLifecycleWorkbench,
) => {
  /**
   * Closing — STOP EFFECTS, KEEP DATA.
   *
   * Closing opens a recoverable window, so nothing is deleted or scrubbed
   * here. Suspending the Property lifecycle state is the whole stop: it
   * withdraws Properties from new provider work and from public Portal
   * resolution at request time, while the Google binding, review destination,
   * responsible-manager intervals and operation receipts stay exactly as they
   * are so an authorized history survives and reactivation has something to
   * restore.
   */
  const prepareClosing = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    // Idempotent by construction: the second run matches zero `active` rows.
    // The receipt store already replays before reaching here; this keeps the
    // statement itself safe if it is ever reached twice.
    await workbench.suspendProviderAdmission(tx, request)
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    const outcome = owned === 0 ? 'no_data' : 'complete'
    return { outcome, evidenceRef: evidenceRef('closing', outcome, request) }
  }

  /**
   * Purge readiness — READ ONLY.
   *
   * A blocked readiness is a real answer, and the only way to say it through
   * this contract is to fail. Throwing leaves the Organization in `closing`,
   * keeps every other context's receipt, and lets the next pass retry. It must
   * never report ready to keep the machine moving.
   */
  const verifyPurgeReadiness = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const admitting = await workbench.countAdmittingProperties(tx, request.organizationId)
    if (admitting > 0) throw new Error(PROPERTY_PURGE_READINESS_BLOCKED)
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    const outcome = owned === 0 ? 'no_data' : 'complete'
    return { outcome, evidenceRef: evidenceRef('purge_readiness', outcome, request) }
  }

  /**
   * Purge — IRREVERSIBLE, reached only after readiness passed.
   *
   * Idempotent: presence is read first, so a replay over an already-scrubbed
   * Organization deletes nothing and still answers.
   */
  const purge = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    if (owned === 0) {
      return { outcome: 'no_data', evidenceRef: evidenceRef('purge', 'no_data', request) }
    }
    await workbench.scrubTenantRows(tx, request.organizationId)
    return { outcome: 'complete', evidenceRef: evidenceRef('purge', 'complete', request) }
  }

  return createOrganizationLifecycleContributorScaffold({
    db,
    context: 'property',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })
}
