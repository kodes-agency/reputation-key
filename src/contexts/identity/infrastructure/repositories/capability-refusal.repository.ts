// Read-only persisted readers for the capability refusal explainer (issue #408).
// Every query here is a SELECT; diagnostics never mutate the record they inspect.

import { asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  authorizationExecutionPermits,
  capabilityExecutionControl,
} from '#/shared/db/schema/google-content-control.schema'
import type { CapabilityRefusalDeps } from '#/shared/governance/capability-refusal'

/** Read-only readers for the capability refusal explainer (issue #408). */
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
        .select({
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
        })
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
      return rows.map((row) => ({
        state: row.state,
        correlationId: row.correlationId,
        count: row.count,
        lastAt:
          row.lastAt === null
            ? null
            : (row.lastAt instanceof Date
                ? row.lastAt
                : new Date(row.lastAt)
              ).toISOString(),
      }))
    },
  })
