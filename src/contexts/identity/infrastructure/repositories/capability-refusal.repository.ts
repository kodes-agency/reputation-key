// Read-only persisted readers for the capability refusal explainer (issue #408).
// Every query here is a SELECT; diagnostics never mutate the record they inspect.
//
// The permit record has two readers, one per caller. The operator command has
// no tenant and reads the tally across Organizations. The request surface
// (`explainPolicyDecisionFn`) is open to every AccountAdmin, so its reader
// tallies the asking Organization's permits and no others.

import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  authorizationExecutionPermits,
  capabilityExecutionControl,
} from '#/shared/db/schema/google-content-control.schema'
import type {
  CapabilityRefusalDeps,
  PermitOutcomeTally,
} from '#/shared/governance/capability-refusal'

/** Permits counted by state and correlation id, with each group's last move. */
const PERMIT_TALLY_COLUMNS = {
  state: authorizationExecutionPermits.state,
  correlationId: authorizationExecutionPermits.correlationId,
  count: sql<number>`count(*)::int`.as('count'),
  lastAt: sql<Date | string | null>`
    max(
      case ${authorizationExecutionPermits.state}
        when 'admitted' then ${authorizationExecutionPermits.admittedAt}
        when 'started' then ${authorizationExecutionPermits.startedAt}
        when 'completed' then ${authorizationExecutionPermits.completedAt}
        when 'fenced' then ${authorizationExecutionPermits.fencedAt}
      end
    )
  `.as('last_at'),
}

type PermitTallyRow = Readonly<{
  state: PermitOutcomeTally['state']
  correlationId: string | null
  count: number
  lastAt: Date | string | null
}>

function toPermitOutcomeTally(row: PermitTallyRow): PermitOutcomeTally {
  return {
    state: row.state,
    correlationId: row.correlationId,
    count: row.count,
    lastAt: row.lastAt === null ? null : new Date(row.lastAt).toISOString(),
  }
}

/** Readers for the operator command: its permit tally spans every Organization. */
export const createCapabilityRefusalReaders = (
  db: Database,
): Pick<CapabilityRefusalDeps, 'loadExecutionControl' | 'loadPermitOutcomes'> =>
  Object.freeze({
    loadExecutionControl: async (capability) => {
      const rows = await db
        .select({
          denied: capabilityExecutionControl.denied,
          deniedAt: capabilityExecutionControl.deniedAt,
          emergencyKillVersion: capabilityExecutionControl.emergencyKillVersion,
        })
        .from(capabilityExecutionControl)
        .where(eq(capabilityExecutionControl.capability, capability))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      return {
        denied: row.denied,
        deniedAt: row.deniedAt?.toISOString() ?? null,
        emergencyKillVersion: String(row.emergencyKillVersion),
      }
    },
    loadPermitOutcomes: async (capability) => {
      const rows = await db
        .select(PERMIT_TALLY_COLUMNS)
        .from(authorizationExecutionPermits)
        .where(eq(authorizationExecutionPermits.capability, capability))
        .groupBy(
          authorizationExecutionPermits.state,
          authorizationExecutionPermits.correlationId,
        )
        .orderBy(
          asc(authorizationExecutionPermits.state),
          asc(authorizationExecutionPermits.correlationId),
        )
      return rows.map(toPermitOutcomeTally)
    },
  })

/**
 * Readers for a tenant request surface. The execution control is the platform's
 * one row per capability; the permit tally is the named Organization's own, and
 * a report that names none is refused rather than answered across tenants.
 */
export const createOrganizationCapabilityRefusalReaders = (
  db: Database,
): Pick<CapabilityRefusalDeps, 'loadExecutionControl' | 'loadPermitOutcomes'> => {
  const loadOrganizationPermitOutcomes: CapabilityRefusalDeps['loadPermitOutcomes'] =
    async (capability, organizationId) => {
      if (!organizationId) {
        throw new Error('A tenant capability report must name its Organization')
      }
      const rows = await db
        .select(PERMIT_TALLY_COLUMNS)
        .from(authorizationExecutionPermits)
        .where(
          and(
            eq(authorizationExecutionPermits.organizationId, organizationId),
            eq(authorizationExecutionPermits.capability, capability),
          ),
        )
        .groupBy(
          authorizationExecutionPermits.state,
          authorizationExecutionPermits.correlationId,
        )
        .orderBy(
          asc(authorizationExecutionPermits.state),
          asc(authorizationExecutionPermits.correlationId),
        )
      return rows.map(toPermitOutcomeTally)
    }
  return Object.freeze({
    loadExecutionControl: createCapabilityRefusalReaders(db).loadExecutionControl,
    loadPermitOutcomes: loadOrganizationPermitOutcomes,
  })
}
