// Dashboard Organization lifecycle contributor (LIF-01-T12/T13/T14).
//
// Cross-context adapter implementation: CONTEXT.md "Dependency rules" lets an
// `infrastructure/adapters/**` file import the foreign `application/ports/**`
// contract it implements, and nothing else from Identity. Authority binding,
// the advisory lock, receipt idempotence and the content-free receipt row all
// come from the shared store — this file only supplies the three reviewed
// phase bodies.
//
// Dashboard is a read-oriented aggregation surface. Its CONTEXT.md records no
// domain event, no event handler, no job and no schedule; its ONE durable
// write is `setup_checklist_milestones`, a content-free, insert-only,
// monotonic onboarding milestone written by an authenticated read path. That
// single fact drives every decision below.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

const CONTEXT = 'dashboard' as const

/**
 * Content-free evidence: context, phase, a fixed reason enum and a row count.
 * No milestone step, timestamp or tenant name ever reaches a receipt.
 */
function evidenceRef(
  phase: 'closing' | 'purge_readiness' | 'purge',
  reason: string,
  rows: number,
): string {
  return `${CONTEXT}:${phase}:v1:${reason}:${rows}`
}

/** `no_data` is affirmative evidence, so a context with nothing still answers. */
function outcomeFor(rows: number): OrganizationLifecyclePhaseOutcome['outcome'] {
  return rows > 0 ? 'complete' : 'no_data'
}

async function countMilestones(tx: Tx, organization: string): Promise<number> {
  const result = await tx.execute(sql`
    SELECT count(*) AS rows
    FROM setup_checklist_milestones
    WHERE organization_id = ${organization}
  `)
  const value = (result.rows[0] as { rows?: unknown } | undefined)?.rows
  return Number((value as string | number | null | undefined) ?? 0)
}

/**
 * Closing — STOP EFFECTS, KEEP DATA.
 *
 * Dashboard owns no background work, no schedule, no consumer and no external
 * provider effect, so there is nothing for it to cancel or fence. Its only
 * write is an insert-on-read from an authenticated product surface, and that
 * surface is already unavailable once the closure request commits Identity's
 * Organization suspension. This phase therefore deletes nothing, scrubs
 * nothing and changes no column: it records the affirmative fact that the
 * Dashboard read surface has no unfenced effect for this Organization.
 */
const prepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const rows = await countMilestones(tx, request.organizationId)
  return {
    outcome: outcomeFor(rows),
    evidenceRef: evidenceRef('closing', 'read_surface_no_effects', rows),
  }
}

/**
 * Purge readiness — READ ONLY.
 *
 * Dashboard can never block the irreversible boundary. `setup_checklist_milestones`
 * is content-free (organization id, a canonical step enum and a first-completion
 * timestamp), has no dependent row, no in-flight job and no external effect that
 * could still be mid-flight, so there is no condition that would make its purge
 * unsafe. Reporting ready here is a real answer, not a convenience.
 */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const rows = await countMilestones(tx, request.organizationId)
  return {
    outcome: outcomeFor(rows),
    evidenceRef: evidenceRef('purge_readiness', 'no_blocking_dependency', rows),
  }
}

/**
 * Purge — IRREVERSIBLE, idempotent, content-free.
 *
 * The milestone rows are Dashboard-owned tenant rows keyed by organization id,
 * so they go with the tenant. Nothing else is touched: the current-health facts
 * the checklist derives belong to their owning contexts and are purged by those
 * contributors, and the table itself is never dropped.
 */
const purge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const rows = await countMilestones(tx, request.organizationId)
  if (rows === 0) {
    return {
      outcome: 'no_data',
      evidenceRef: evidenceRef('purge', 'nothing_to_scrub', 0),
    }
  }
  await tx.execute(sql`
    DELETE FROM setup_checklist_milestones
    WHERE organization_id = ${request.organizationId}
  `)
  return {
    outcome: 'complete',
    evidenceRef: evidenceRef('purge', 'milestones_deleted', rows),
  }
}

/**
 * The scaffold returns a structurally complete `OrganizationLifecycleContributor`.
 * Deliberately NOT part of `DashboardContextApi.publicApi`: only Identity's
 * lifecycle coordinator consumes it, and wiring it must not add a key to any
 * tenant-reachable surface.
 */
export const createDashboardOrganizationLifecycleAdapter = (
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
export const DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES = Object.freeze({
  prepareClosing,
  verifyPurgeReadiness,
  purge,
})

/** Table this context deletes from at purge — asserted by the integration test. */
export const DASHBOARD_PURGE_TABLES = Object.freeze([
  'setup_checklist_milestones',
] as const)
