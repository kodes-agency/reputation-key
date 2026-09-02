// Read-only readers for the capability refusal explainer (issues #403/#408).
//
// Separate from `google-content-authority.repository.ts` on purpose. Those are
// the enforcement-path reads and writes; these are diagnostic reads only, and
// the filename standard for this layer (`context-standards-matrix`) wants a
// mirrored `*.repository.ts` / `*.repository.test.ts` pair rather than another
// variance pinned into the retained inventory.
//
// Every query here is a SELECT. `loadApprovalForRuntime` deliberately reuses the
// enforcement path's own `latestApprovalRow` + `approvalRecordFromRow`, so the
// explainer resolves the same row the real decision resolves. By contrast
// `loadApprovalsForIdentity` maps raw runtime columns instead of going through
// `approvalRecordFromRow`, because that helper returns null on contract-version
// drift — and a drifted row is exactly the case the explainer must still be able
// to name.

import { asc, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  authorizationExecutionPermits,
  capabilityComplianceApprovals,
  capabilityExecutionControl,
} from '#/shared/db/schema/google-content-control.schema'
import type { CapabilityRefusalDeps } from '#/shared/governance/capability-refusal'
import {
  approvalIdentityWhere,
  approvalRecordFromRow,
  latestApprovalRow,
  runtimeBindingFromApprovalRow,
} from './google-content-authority.repository'

/**
 * Read-only readers for the capability refusal explainer (issue #408). Declared
 * as an arrow const because `infrastructure-factory-style-authority` allows no
 * grandfathered `export function` infrastructure factories.
 */
export const createCapabilityRefusalReaders = (
  db: Database,
): Pick<
  CapabilityRefusalDeps,
  | 'loadExecutionControl'
  | 'loadApprovalForRuntime'
  | 'loadApprovalsForIdentity'
  | 'loadPermitOutcomes'
> =>
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
    loadApprovalForRuntime: async (binding) => {
      const row = await latestApprovalRow(db, binding)
      return row ? approvalRecordFromRow(row) : null
    },
    loadApprovalsForIdentity: async (binding) => {
      const rows = await db
        .select()
        .from(capabilityComplianceApprovals)
        .where(approvalIdentityWhere(binding))
        .orderBy(desc(capabilityComplianceApprovals.bindingVersion))
      return rows.map((row) => ({
        bindingVersion: row.bindingVersion,
        binding: runtimeBindingFromApprovalRow(row),
      }))
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
