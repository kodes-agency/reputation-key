// LIF-01-T12/T13/T14 — Integration's Organization lifecycle contribution.
//
// Integration is the provider boundary, so its three phases answer three very
// different questions about ONE thing: the Organization's Google grant.
//
//   closing          stop every provider effect, keep every row
//   purge_readiness  read only: is any provider effect still outstanding?
//   purge            irreversible, content-free scrub of provider-derived
//                    tenant content; retained lifecycle facts stay
//
// The authority, advisory lock, fingerprint and receipt semantics are NOT
// re-implemented here: `createOrganizationLifecycleContributorScaffold` owns
// them once for all sixteen non-Identity contexts. What is local to this file
// is the three phase bodies and the reasoning about which row is stopped,
// scrubbed, or deliberately left alone.

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
import type {
  GoogleClosureRevocationOutcome,
  GoogleClosureSubscriptionOutcome,
  GoogleOrganizationClosureProviderPort,
} from '../../application/ports/google-organization-closure.port'

export type IntegrationOrganizationLifecycleDeps = Readonly<{
  db: Database
  provider: GoogleOrganizationClosureProviderPort
}>

/**
 * Content-free readiness refusal.
 *
 * `purge_readiness` has no "blocked" receipt outcome by design — the contract
 * is `complete | no_data`, and recording an affirmative receipt for an
 * Organization that is NOT ready would let a later pass treat the refusal as
 * satisfied. Refusing by throwing leaves the lifecycle state at `closing`,
 * writes no receipt, and lets the next scheduled pass re-ask the question.
 *
 * The message carries blocker CODES and COUNTS only: never a connection id,
 * user id, provider identifier or any other tenant value.
 */
export class IntegrationPurgeReadinessBlockedError extends Error {
  readonly blockers: readonly Readonly<{ code: string; count: number }>[]

  constructor(blockers: readonly Readonly<{ code: string; count: number }>[]) {
    super(
      `integration purge readiness blocked: ${blockers
        .map((blocker) => `${blocker.code}=${blocker.count}`)
        .join(',')}`,
    )
    this.name = 'IntegrationPurgeReadinessBlockedError'
    this.blockers = Object.freeze([...blockers])
  }
}

type CountRow = Readonly<Record<string, unknown>>

function readCount(row: CountRow | undefined, field: string): number {
  const value = row?.[field]
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value)
  throw new Error(`Integration lifecycle count is unavailable: ${field}`)
}

/**
 * Evidence references are the only string a receipt carries, so they are built
 * from the lineage, the revision and COUNTS. `evidenceRef` is validated by the
 * shared store against a content-free character class; keeping the shape here
 * makes the constraint visible at the point of construction.
 */
function evidenceRef(
  phase: 'closing' | 'readiness' | 'purge',
  request: OrganizationLifecycleContributionRequest,
  counts: readonly number[],
): string {
  return [
    'integration',
    phase,
    request.closureLineageId,
    `r${request.lifecycleRevision}`,
    ...counts.map((count) => `n${count}`),
  ].join(':')
}

/** Whether Integration holds anything at all for this Organization. */
async function integrationFootprint(
  tx: Tx,
  organizationId: string,
): Promise<Readonly<{ connections: number; imports: number; legacy: number }>> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM google_connections
        WHERE organization_id = ${organizationId}) AS connections,
      (SELECT count(*)::int FROM gbp_import_requests
        WHERE organization_id = ${organizationId}) AS imports,
      (SELECT count(*)::int FROM gbp_import_jobs
        WHERE organization_id = ${organizationId}) AS legacy
  `)
  const row = result.rows[0] as CountRow | undefined
  return {
    connections: readCount(row, 'connections'),
    imports: readCount(row, 'imports'),
    legacy: readCount(row, 'legacy'),
  }
}

type ClosureConnectionRow = Readonly<{
  id: string
  encrypted_refresh_token: string
  credential_use_state: string
}>

/**
 * Phase 1 — stop provider effects, delete nothing.
 *
 * Order matters and mirrors the reviewed disconnect seam
 * (`disconnect-google-account.ts`): unsubscribe FIRST while the token is still
 * valid, then revoke, then land the local fence. Provider outcomes are
 * recorded, never thrown: a partial provider failure must still leave the
 * Organization locally fenced, and the next call converges because a fenced
 * connection is skipped instead of re-sent.
 */
const prepareClosing =
  (provider: GoogleOrganizationClosureProviderPort) =>
  async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const footprint = await integrationFootprint(tx, request.organizationId)
    if (
      footprint.connections === 0 &&
      footprint.imports === 0 &&
      footprint.legacy === 0
    ) {
      // Affirmative absence. An Organization that never connected Google has no
      // provider effects to stop, and that is evidence — not an omission.
      return {
        outcome: 'no_data',
        evidenceRef: evidenceRef('closing', request, [0, 0, 0, 0]),
      }
    }

    // Deterministic lock order over the tenant's connections. The row lock is
    // what stops a concurrent reconnect from re-crediting a row between the
    // provider call and the fence.
    const connectionRows = await tx.execute(sql`
      SELECT
        id::text AS id,
        encrypted_refresh_token,
        credential_use_state::text AS credential_use_state
      FROM google_connections
      WHERE organization_id = ${request.organizationId}
      ORDER BY id
      FOR UPDATE
    `)

    let subscriptionsStopped = 0
    let credentialsRevoked = 0
    for (const row of connectionRows.rows as unknown as ClosureConnectionRow[]) {
      // Convergence: a connection whose credential is already retired holds no
      // provider grant, so a second closing pass sends nothing at all.
      if (row.credential_use_state === 'none') continue
      const target = {
        organizationId: request.organizationId,
        connectionId: row.id,
        encryptedRefreshToken: row.encrypted_refresh_token,
        occurredAt: request.occurredAt,
      } as const

      // The port already promises not to throw; the guard is defence in depth
      // so an adapter defect cannot roll the local fence back.
      let subscription: GoogleClosureSubscriptionOutcome
      try {
        subscription = await provider.stopNotificationSubscriptions(target)
      } catch {
        subscription = 'ambiguous'
      }
      if (subscription === 'stopped' || subscription === 'already_stopped') {
        subscriptionsStopped += 1
      }

      let revocation: GoogleClosureRevocationOutcome
      try {
        revocation = await provider.revokeCredentials(target)
      } catch {
        revocation = 'cleanup_ambiguous'
      }
      if (revocation === 'confirmed_revoked' || revocation === 'already_revoked') {
        credentialsRevoked += 1
      }
    }

    // The local fence. Nothing is deleted: the row survives as the content-free
    // Google lifecycle fact this context exports. What leaves is the credential
    // material whose grant no longer exists at Google — keeping a revoked token
    // would be a standing secret with zero recovery value, because recovery
    // from closure requires a fresh OAuth ceremony either way. `status_reason`
    // preserves the prior lifecycle state so nothing is lost by the transition.
    //
    // The three version bumps are the load-bearing part: every in-flight import
    // item, review sync, reply push and discovery handle pins
    // `expected_connection_lifecycle_version` / `_access_version` /
    // `_credential_generation`, so bumping them invalidates all outstanding
    // provider work in one statement without touching a single work row.
    const fenced = await tx.execute(sql`
      UPDATE google_connections
      SET status = 'disconnected',
          status_reason = 'organization_closing_from_' || status::text,
          credential_use_state = 'none',
          encrypted_access_token = 'redacted',
          encrypted_refresh_token = 'redacted',
          google_subject = NULL,
          scopes = ARRAY[]::text[],
          cleanup_material_deadline_at = NULL,
          lifecycle_version = lifecycle_version + 1,
          access_version = access_version + 1,
          credential_generation = credential_generation + 1,
          status_changed_at = ${request.occurredAt},
          updated_at = ${request.occurredAt}
      WHERE organization_id = ${request.organizationId}
        AND (
          status <> 'disconnected'
          OR credential_use_state <> 'none'
          OR google_subject IS NOT NULL
        )
      RETURNING id
    `)

    // Import parents are FENCED, not terminalized: closing keeps data. Bumping
    // `deletion_fence` and voiding the replay digests is the same fence the
    // reviewed import lifecycle uses (`fenceLifecycleParent`), and its
    // `wire_replay_digest IS NOT NULL` guard is what makes a second pass a
    // no-op instead of a double bump.
    //
    // `gbp_import_sagas` has no fenceable column — its replay version/digest
    // pair is NOT NULL by schema, so the saga header can only be voided by
    // deleting the row, which closing must never do. A saga is an aggregate
    // over its batches, so fencing every batch fences the saga.
    const importsFenced = await tx.execute(sql`
      UPDATE gbp_import_requests
      SET deletion_fence = deletion_fence + 1,
          wire_replay_key_version = NULL,
          wire_replay_digest = NULL,
          semantic_replay_key_version = NULL,
          semantic_replay_digest = NULL,
          updated_at = ${request.occurredAt}
      WHERE organization_id = ${request.organizationId}
        AND wire_replay_digest IS NOT NULL
      RETURNING id
    `)

    return {
      outcome: 'complete',
      evidenceRef: evidenceRef('closing', request, [
        fenced.rows.length,
        subscriptionsStopped,
        credentialsRevoked,
        importsFenced.rows.length,
      ]),
    }
  }

const READINESS_BLOCKER_FIELDS = Object.freeze([
  // A credentialed connection means a live Google grant. Purging tenant content
  // while the provider still trusts us would leave an orphaned grant nobody can
  // revoke afterwards.
  'live_connections',
  // An item still pending or processing may be mid-provider-effect.
  'in_flight_import_items',
  // A disconnect cleanup attempt without a terminal outcome still binds a
  // credential digest and may still dispatch.
  'pending_revoke_attempts',
  // A non-terminal OAuth exchange still holds application-encrypted provider
  // response material.
  'pending_exchange_attempts',
  // A source operation that never reached terminal may still be running at the
  // provider.
  'pending_source_operations',
  // An unredeemed, unexpired cross-cell credential grant is a live external
  // effect. Beta is one logical US Data Cell, so this is expected to be zero;
  // it is checked rather than assumed.
  'live_broker_grants',
  // An unexpired discovery handle still addresses provider candidate content.
  // Its 24-hour database-enforced bound makes this drain on its own well
  // inside the recovery window, so blocking here costs nothing and refuses to
  // purge around live provider content.
  'live_discovery_handles',
] as const)

/**
 * Phase 2 — read only. Never mutates, never "helps".
 *
 * Every blocker below is a real external effect that must have drained before
 * the irreversible boundary. Reporting ready to keep things moving would trade
 * a delay for an unrevoked Google grant.
 */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const footprint = await integrationFootprint(tx, request.organizationId)
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM google_connections
        WHERE organization_id = ${request.organizationId}
          AND (
            credential_use_state <> 'none'
            OR google_subject IS NOT NULL
            OR status NOT IN ('disconnected', 'failed')
          )) AS live_connections,
      (SELECT count(*)::int FROM gbp_import_request_items
        WHERE organization_id = ${request.organizationId}
          AND status IN ('pending', 'processing')) AS in_flight_import_items,
      (SELECT count(*)::int FROM google_disconnect_revoke_attempts
        WHERE organization_id = ${request.organizationId}
          AND terminal_at IS NULL) AS pending_revoke_attempts,
      (SELECT count(*)::int FROM google_oauth_exchange_attempts
        WHERE organization_id = ${request.organizationId}
          AND terminal_at IS NULL) AS pending_exchange_attempts,
      (SELECT count(*)::int FROM google_credential_source_operations
        WHERE organization_id = ${request.organizationId}
          AND terminal_at IS NULL) AS pending_source_operations,
      (SELECT count(*)::int FROM google_credential_broker_replay
        WHERE organization_id = ${request.organizationId}
          AND state = 'issued'
          AND expires_at > ${request.occurredAt}) AS live_broker_grants,
      (SELECT count(*)::int FROM google_import_discovery_records
        WHERE organization_id = ${request.organizationId}
          AND expires_at > ${request.occurredAt}) AS live_discovery_handles
  `)
  const row = result.rows[0] as CountRow | undefined

  const blockers = READINESS_BLOCKER_FIELDS.map((code) => ({
    code,
    count: readCount(row, code),
  })).filter((blocker) => blocker.count > 0)
  if (blockers.length > 0) throw new IntegrationPurgeReadinessBlockedError(blockers)

  if (footprint.connections === 0 && footprint.imports === 0 && footprint.legacy === 0) {
    return {
      outcome: 'no_data',
      evidenceRef: evidenceRef('readiness', request, [0]),
    }
  }
  return {
    outcome: 'complete',
    evidenceRef: evidenceRef('readiness', request, [
      footprint.connections,
      footprint.imports,
      footprint.legacy,
    ]),
  }
}

/**
 * Tenant content this context deletes at the irreversible boundary, in
 * foreign-key-safe order.
 *
 * Every entry is a ROW delete scoped to one `organization_id`. No table is
 * dropped, and the legacy `gbp_*` compatibility mirrors keep existing: they are
 * emptied for this tenant exactly like any other table, because a compatibility
 * mirror holds the same provider content under an older shape.
 */
const PURGE_DELETE_TABLES = Object.freeze([
  // Import work, children before parents.
  'gbp_import_item_retry_receipts',
  'gbp_import_request_items',
  'gbp_import_requests',
  'gbp_import_sagas',
  // Pre-confirmation provider candidate pages behind HMAC handles.
  'google_import_discovery_records',
  // The crash boundary that can hold an application-encrypted token response.
  'google_oauth_exchange_attempts',
  // Legacy compatibility mirrors — rows only, never the table.
  'gbp_cache',
  'gbp_import_jobs',
  'gbp_import_legacy_history',
  // Cross-cell broker grants.
  'google_credential_broker_replay',
] as const)

/**
 * Phase 3 — irreversible, idempotent, content-free.
 *
 * Two rows are deliberately KEPT and scrubbed in place rather than deleted:
 *
 * - `google_connections` and `google_organization_credential_homes` are
 *   referenced with ON DELETE RESTRICT by `google_disconnect_revoke_attempts`,
 *   which the data-fate authority classifies `recoverable_archive`: the
 *   content-free permit and outcome fact is independently retained evidence
 *   and this phase may not erase it. Deleting the connection would therefore
 *   either fail or force deleting that evidence, so the connection is reduced
 *   to a content-free lifecycle fact instead.
 * - `authorization_execution_permits` is the control plane those same attempts
 *   point at. Only its tenant-linked fields are cleared.
 *
 * `merchant_ai_enablement`-style cross-context rows are not touched here, and
 * neither is anything Review, Property or Identity owns.
 */
const purge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  // Probe BEFORE the work, and include the rows this phase retains, so a
  // replay after a rolled-back attempt reports the same outcome instead of
  // degrading `complete` into `no_data`.
  const footprint = await integrationFootprint(tx, request.organizationId)
  const hasFootprint =
    footprint.connections > 0 || footprint.imports > 0 || footprint.legacy > 0

  let deleted = 0
  for (const table of PURGE_DELETE_TABLES) {
    const result = await tx.execute(
      sql`DELETE FROM ${sql.identifier(table)}
          WHERE organization_id = ${request.organizationId}
          RETURNING 1`,
    )
    deleted += result.rows.length
  }

  // Content-free scrub of the retained provider lifecycle facts. `connected_by`
  // is NOT NULL, so it becomes a fixed non-identifying literal rather than a
  // user id; the authorized-by/at pair is nulled together to satisfy the
  // schema's pair check.
  const scrubbedConnections = await tx.execute(sql`
    UPDATE google_connections
    SET connected_by = 'purged',
        credential_authorized_by = NULL,
        credential_authorized_at = NULL,
        last_successful_sync_at = NULL,
        status = 'disconnected',
        status_reason = 'organization_purged',
        credential_use_state = 'none',
        encrypted_access_token = 'redacted',
        encrypted_refresh_token = 'redacted',
        google_subject = NULL,
        scopes = ARRAY[]::text[],
        cleanup_material_deadline_at = NULL,
        status_changed_at = ${request.occurredAt},
        updated_at = ${request.occurredAt}
    WHERE organization_id = ${request.organizationId}
      AND (
        connected_by <> 'purged'
        OR credential_authorized_by IS NOT NULL
        OR last_successful_sync_at IS NOT NULL
        OR google_subject IS NOT NULL
        OR status_reason IS DISTINCT FROM 'organization_purged'
      )
    RETURNING id
  `)

  const scrubbedHomes = await tx.execute(sql`
    UPDATE google_organization_credential_homes
    SET changed_by = 'purged',
        change_ticket = NULL,
        updated_at = ${request.occurredAt}
    WHERE organization_id = ${request.organizationId}
      AND (changed_by <> 'purged' OR change_ticket IS NOT NULL)
    RETURNING organization_id
  `)

  const scrubbedAttempts = await tx.execute(sql`
    UPDATE google_disconnect_revoke_attempts
    SET credential_binding = NULL,
        initiator_user_id = 'purged',
        updated_at = ${request.occurredAt}
    WHERE organization_id = ${request.organizationId}
      AND (credential_binding IS NOT NULL OR initiator_user_id <> 'purged')
    RETURNING id
  `)

  const scrubbedPermits = await tx.execute(sql`
    UPDATE authorization_execution_permits
    SET initiator_user_id = NULL,
        correlation_id = NULL
    WHERE organization_id = ${request.organizationId}
      AND (initiator_user_id IS NOT NULL OR correlation_id IS NOT NULL)
    RETURNING id
  `)

  if (!hasFootprint) {
    return { outcome: 'no_data', evidenceRef: evidenceRef('purge', request, [0, 0]) }
  }
  return {
    outcome: 'complete',
    evidenceRef: evidenceRef('purge', request, [
      deleted,
      scrubbedConnections.rows.length +
        scrubbedHomes.rows.length +
        scrubbedAttempts.rows.length +
        scrubbedPermits.rows.length,
    ]),
  }
}

/**
 * Integration's Organization lifecycle contributor.
 *
 * Composition must supply the provider seam. There is no default: a lifecycle
 * contributor that silently skipped revocation would report `complete` for an
 * Organization whose Google grant is still live.
 */
export const createIntegrationOrganizationLifecycleContributor = (
  deps: IntegrationOrganizationLifecycleDeps,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db: deps.db,
    context: 'integration',
    prepareClosing: prepareClosing(deps.provider),
    verifyPurgeReadiness,
    purge,
  }) as OrganizationLifecycleContributor
