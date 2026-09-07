// LIF-01-T12/T13/T14 — AI's Organization lifecycle contribution.
//
//   closing          stop AI work this context schedules, keep every row
//   purge_readiness  read only: is any AI execution or erasure outstanding?
//   purge            irreversible erasure of retained AI derivatives
//
// The authority, advisory lock, fingerprint and receipt semantics live once in
// `createOrganizationLifecycleContributorScaffold`; only the three phase
// bodies are local to this file.
//
// ONE BOUNDARY IS WORTH STATING UP FRONT, because it explains what closing
// here does NOT do. Every AI read and every AI admission is gated on
// `merchant_ai_enablement.state = 'enabled'` (see `ai-read-gate.ts`). That head
// row is protected at the schema level: `guard_merchant_ai_enablement_v1`
// refuses any INSERT/UPDATE that is not running inside
// `apply_merchant_ai_transition_v1`, an Identity-owned SECURITY DEFINER
// authority that in turn demands a live `member` row with owner/admin AI
// authority over the Property. A closing Organization has no such actor, and
// re-implementing that authority here would be a governance regression — so
// AI does not retire the merchant authorization. Identity's contributor owns
// that transition. What AI owns, and does here, is its own scheduled work; and
// what AI refuses, at `verifyPurgeReadiness`, is to cross the irreversible
// boundary while that authorization is still enabled.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
// Cross-context adapter contract: src/contexts/CONTEXT.md "Dependency rules"
// lets a foreign infrastructure/adapters/** module import the Identity port it
// implements, and nothing else from Identity.
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

/** Terminal reason recorded on work this phase supersedes. */
const CLOSING_TERMINAL_REASON = 'organization_closing'

/**
 * Content-free readiness refusal — see the Integration sibling for the full
 * reasoning. `purge_readiness` has no "blocked" receipt outcome by design, so a
 * refusal is a throw: no receipt is written, the lifecycle state stays at
 * `closing`, and the next scheduled pass re-asks.
 */
export class AiPurgeReadinessBlockedError extends Error {
  readonly blockers: readonly Readonly<{ code: string; count: number }>[]

  constructor(blockers: readonly Readonly<{ code: string; count: number }>[]) {
    super(
      `ai purge readiness blocked: ${blockers
        .map((blocker) => `${blocker.code}=${blocker.count}`)
        .join(',')}`,
    )
    this.name = 'AiPurgeReadinessBlockedError'
    this.blockers = Object.freeze([...blockers])
  }
}

type CountRow = Readonly<Record<string, unknown>>

function readCount(row: CountRow | undefined, field: string): number {
  const value = row?.[field]
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value)
  throw new Error(`AI lifecycle count is unavailable: ${field}`)
}

function evidenceRef(
  phase: 'closing' | 'readiness' | 'purge',
  request: OrganizationLifecycleContributionRequest,
  counts: readonly number[],
): string {
  return [
    'ai',
    phase,
    request.closureLineageId,
    `r${request.lifecycleRevision}`,
    ...counts.map((count) => `n${count}`),
  ].join(':')
}

/**
 * Whether AI holds anything at all for this Organization.
 *
 * `merchant_ai_consent_evidence` is included deliberately: it is the retained,
 * append-only consent history that survives purge, so an Organization that once
 * authorized AI keeps reporting `complete` on a replayed purge instead of
 * degrading to `no_data`.
 */
async function aiFootprint(tx: Tx, organizationId: string): Promise<number> {
  const result = await tx.execute(sql`
    SELECT (
      (SELECT count(*)::int FROM merchant_ai_consent_evidence
        WHERE organization_id = ${organizationId})
      + (SELECT count(*)::int FROM ai_property_processing_profiles
        WHERE organization_id = ${organizationId})
      + (SELECT count(*)::int FROM ai_review_analyses
        WHERE organization_id = ${organizationId})
      + (SELECT count(*)::int FROM ai_operations
        WHERE organization_id = ${organizationId})
    ) AS footprint
  `)
  return readCount(result.rows[0] as CountRow | undefined, 'footprint')
}

/**
 * Phase 1 — stop AI work, delete nothing.
 *
 * Both statements supersede a work AUTHORITY rather than the work product:
 * nothing analysed, aggregated or drafted is touched, and a reactivated
 * Organization re-enrols under a fresh generation exactly as it would after any
 * other supersession. Both are idempotent by their `state IN (...)` predicate,
 * so a second pass supersedes nothing and reports zero.
 *
 * `terminal_at` is clamped to `snapshot_captured_at` / `created_at` because the
 * schema requires a terminal instant at or after the row's own start, and the
 * only clock this phase may read is the supplied `occurredAt`.
 */
const prepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  if ((await aiFootprint(tx, request.organizationId)) === 0) {
    // Affirmative absence: an Organization that never authorized AI still
    // answers. An omitted contributor would make a partial purge look complete.
    return { outcome: 'no_data', evidenceRef: evidenceRef('closing', request, [0]) }
  }

  const enrollments = await tx.execute(sql`
    UPDATE ai_review_analysis_enrollments
    SET state = 'superseded',
        terminal_reason = ${CLOSING_TERMINAL_REASON},
        terminal_at = GREATEST(${request.occurredAt}, snapshot_captured_at),
        updated_at = GREATEST(${request.occurredAt}, created_at)
    WHERE organization_id = ${request.organizationId}
      AND state IN ('awaiting_assisted_approval', 'queued', 'running')
    RETURNING id
  `)

  return {
    outcome: 'complete',
    evidenceRef: evidenceRef('closing', request, [enrollments.rows.length]),
  }
}

const READINESS_BLOCKER_FIELDS = Object.freeze([
  'enabled_authorizations',
  'active_enrollments',
  'in_flight_operations',
] as const)

/**
 * Phase 2 — read only. Never mutates.
 */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const footprint = await aiFootprint(tx, request.organizationId)
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM merchant_ai_enablement
        WHERE organization_id = ${request.organizationId}
          AND state = 'enabled') AS enabled_authorizations,
      (SELECT count(*)::int FROM ai_review_analysis_enrollments
        WHERE organization_id = ${request.organizationId}
          AND state IN ('awaiting_assisted_approval', 'queued', 'running'))
        AS active_enrollments,
      (SELECT count(*)::int FROM ai_operations
        WHERE organization_id = ${request.organizationId}
          AND state IN ('pending', 'executing', 'succeeded_pending_delivery'))
        AS in_flight_operations
  `)
  const row = result.rows[0] as CountRow | undefined

  const blockers = READINESS_BLOCKER_FIELDS.map((code) => ({
    code,
    count: readCount(row, code),
  })).filter((blocker) => blocker.count > 0)
  if (blockers.length > 0) throw new AiPurgeReadinessBlockedError(blockers)

  return footprint === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('readiness', request, [0]) }
    : { outcome: 'complete', evidenceRef: evidenceRef('readiness', request, [footprint]) }
}

/**
 * Retained AI derivatives and the ledgers that could rebuild them, in
 * foreign-key-safe order (children before parents).
 *
 * The ordering is not cosmetic: derivative rows are deleted before the
 * operation records they reference. Erasure also removes enrollment and
 * aggregate heads so a later sweep cannot rebuild the derivative.
 */
const PURGE_DELETE_TABLES = Object.freeze([
  'ai_review_analysis_enrollments',
  'ai_property_trend_outcomes',
  'ai_property_trend_schedules',
  'ai_property_aggregate_contributions',
  'ai_property_daily_aggregates',
  'ai_property_aggregate_heads',
  'ai_review_analyses',
  'ai_organization_cost_windows',
  'ai_operations',
  'ai_property_processing_profiles',
] as const)

/**
 * Phase 3 — irreversible, idempotent, content-free.
 *
 * Two AI-owned tables are deliberately NOT deleted here:
 *
 * - `merchant_ai_consent_evidence` is `recoverable_archive` in the data-fate
 *   authority: it is the append-only proof of what the merchant consented to,
 *   it holds no review text, guest content or provider identifier, and an
 *   append-only guard trigger refuses to delete it anyway. It is independently
 *   retained evidence, so this phase leaves it alone.
 * - `merchant_ai_enablement` cannot be deleted by any statement outside the
 *   Identity-owned transition function (`merchant_ai_head_cannot_be_deleted`).
 *   It is removed by the schema's own ON DELETE CASCADE when Property purges
 *   the `properties` rows it hangs off, which is the only path the schema
 *   permits.
 *
 * Nothing here drops a table, removes a compatibility mirror, or touches a row
 * owned by Review, Property or Identity — the source Reviews an analysis was
 * derived from stay Review's to purge.
 */
const purge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  // Probed BEFORE the deletes and inclusive of the retained consent evidence,
  // so a replay after a rolled-back attempt reports the same outcome.
  const footprint = await aiFootprint(tx, request.organizationId)

  let deleted = 0
  for (const table of PURGE_DELETE_TABLES) {
    const result = await tx.execute(
      sql`DELETE FROM ${sql.identifier(table)}
          WHERE organization_id = ${request.organizationId}
          RETURNING 1`,
    )
    deleted += result.rows.length
  }

  return footprint === 0
    ? { outcome: 'no_data', evidenceRef: evidenceRef('purge', request, [0]) }
    : { outcome: 'complete', evidenceRef: evidenceRef('purge', request, [deleted]) }
}

/**
 * AI's Organization lifecycle contributor.
 *
 * Composing it does not make any AI capability reachable: it is exposed beside
 * the export contributor on the context's `lifecycle` group, never on
 * `publicApi`.
 */
export const createAiOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'ai',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  }) as OrganizationLifecycleContributor
