import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import {
  authorizationExecutionPermits,
  capabilityExecutionControl,
  credentialRevokePermits,
  googleCredentialSourceOperations,
} from '#/shared/db/schema'
import { GOOGLE_CONTENT_CAPABILITIES } from '#/shared/auth/google-content-contract'
import type {
  GoogleContentAuthorityStore,
  GoogleContentPermitRecord,
} from '#/shared/auth/google-content-authority'
import type { AuthorizationExecutionPermit } from '#/shared/auth/authorization-execution-permit'

/** Revision of the static TypeScript capability policy used in permit vectors. */
const POLICY_VERSION = 1
const authorizationVectorSchema = z.record(
  z.string(),
  z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
)
const emergencyKillVersionRowSchema = z.object({
  emergency_kill_version: z.union([z.number(), z.string().regex(/^[0-9]+$/)]),
})
const countRowSchema = z.object({
  value: z.union([z.number(), z.string().regex(/^[0-9]+$/)]),
})

async function nextEmergencyKillVersion(tx: Database): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('google-content-emergency-generation', 0))`,
  )
  const result = await tx.execute(sql`
    SELECT COALESCE(MAX(emergency_kill_version), 0) + 1 AS emergency_kill_version
    FROM capability_execution_control
  `)
  return Number(
    emergencyKillVersionRowSchema.parse(result.rows[0]).emergency_kill_version,
  )
}

type PermitRow = typeof authorizationExecutionPermits.$inferSelect

function permitRecordFromRow(row: PermitRow): GoogleContentPermitRecord | null {
  const authorizationVector = authorizationVectorSchema.safeParse(row.authorizationVector)
  if (!authorizationVector.success) return null
  const permit: AuthorizationExecutionPermit = {
    id: row.id,
    capability: row.capability,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    connectionId: row.connectionId,
    initiatorUserId: row.initiatorUserId,
    operationKey: row.operationKey,
    routeKey: row.routeKey,
    routeCatalogVersion: row.routeCatalogVersion,
    quotaPolicyId: row.quotaPolicyId,
    state: row.state,
    admittedAt: row.admittedAt,
    startDeadlineAt: row.startDeadlineAt,
    startedAt: row.startedAt,
    operationDeadlineAt: row.operationDeadlineAt,
    completedAt: row.completedAt,
    fencedAt: row.fencedAt,
  }
  return { permit, authorizationVector: authorizationVector.data }
}

export type GoogleContentAuthorityRepository = GoogleContentAuthorityStore<Database>

export const createGoogleContentAuthorityRepository = (
  db: Database,
): GoogleContentAuthorityRepository => {
  return {
    transaction: (run) => db.transaction((tx) => run(tx as unknown as Database)),

    loadControl: async (tx) => {
      const controls = await tx
        .select({
          capability: capabilityExecutionControl.capability,
          denied: capabilityExecutionControl.denied,
          emergencyKillVersion: capabilityExecutionControl.emergencyKillVersion,
        })
        .from(capabilityExecutionControl)
      const emergencyKillVersion = controls.reduce(
        (maximum, row) => Math.max(maximum, row.emergencyKillVersion),
        0,
      )
      return {
        policyVersion: POLICY_VERSION,
        emergencyKillVersion,
        killedCapabilities: GOOGLE_CONTENT_CAPABILITIES.filter(
          (capability) =>
            !controls.some((row) => row.capability === capability && !row.denied),
        ),
      }
    },

    insertPermit: async (tx, record) => {
      const permit = record.permit
      await tx.insert(authorizationExecutionPermits).values({
        id: permit.id,
        capability: permit.capability,
        organizationId: permit.organizationId,
        propertyId: permit.propertyId,
        connectionId: permit.connectionId,
        initiatorUserId: permit.initiatorUserId,
        operationKey: permit.operationKey,
        routeKey: permit.routeKey,
        routeCatalogVersion: permit.routeCatalogVersion,
        quotaPolicyId: permit.quotaPolicyId,
        authorizationVector: record.authorizationVector,
        state: permit.state,
        admittedAt: permit.admittedAt,
        startDeadlineAt: permit.startDeadlineAt,
        startedAt: permit.startedAt,
        operationDeadlineAt: permit.operationDeadlineAt,
        completedAt: permit.completedAt,
        fencedAt: permit.fencedAt,
      })
    },

    lockPermit: async (tx, id, organizationId) => {
      const rows = await tx
        .select()
        .from(authorizationExecutionPermits)
        .where(
          and(
            eq(authorizationExecutionPermits.id, id),
            organizationId === undefined
              ? undefined
              : eq(authorizationExecutionPermits.organizationId, organizationId),
          ),
        )
        .for('update')
        .limit(1)
      return rows[0] ? permitRecordFromRow(rows[0]) : null
    },

    // Candidate scan for the start-deadline sweeper. Selection only: the fence
    // decision is re-made under `lockPermit` by the domain helper, so this
    // predicate never becomes a second source of truth for the deadline.
    // The capability scope makes `authorization_execution_permits_active_idx`
    // (capability, state, start_deadline_at, ...) usable from its leading
    // column; without it this would sequential-scan a table that grows with
    // every provider call. Bounded by the caller's per-run limit, oldest
    // deadline first so a backlog drains deterministically across runs.
    listElapsedAdmittedPermitIds: async (tx, input) => {
      if (input.capabilities.length === 0) return []
      const rows = await tx
        .select({ id: authorizationExecutionPermits.id })
        .from(authorizationExecutionPermits)
        .where(
          and(
            inArray(authorizationExecutionPermits.capability, [...input.capabilities]),
            eq(authorizationExecutionPermits.state, 'admitted'),
            lt(authorizationExecutionPermits.startDeadlineAt, input.before),
          ),
        )
        .orderBy(authorizationExecutionPermits.startDeadlineAt)
        .limit(input.limit)
      return rows.map((row) => row.id)
    },

    updatePermit: async (tx, permit) => {
      await tx
        .update(authorizationExecutionPermits)
        .set({
          state: permit.state,
          startedAt: permit.startedAt,
          operationDeadlineAt: permit.operationDeadlineAt,
          completedAt: permit.completedAt,
          fencedAt: permit.fencedAt,
        })
        .where(
          and(
            eq(authorizationExecutionPermits.id, permit.id),
            eq(authorizationExecutionPermits.organizationId, permit.organizationId),
          ),
        )
    },

    denyCapability: async (tx, capability, input) => {
      const emergencyKillVersion = await nextEmergencyKillVersion(tx)
      await tx
        .insert(capabilityExecutionControl)
        .values({
          capability,
          denied: true,
          emergencyKillVersion,
          deniedAt: input.deniedAt,
          drainedAt: null,
          cleanupDrainedAt: null,
          operatorId: input.operatorId,
          reason: input.reason,
          updatedAt: input.deniedAt,
        })
        .onConflictDoUpdate({
          target: capabilityExecutionControl.capability,
          set: {
            denied: true,
            emergencyKillVersion,
            deniedAt: input.deniedAt,
            drainedAt: null,
            cleanupDrainedAt: null,
            operatorId: input.operatorId,
            reason: input.reason,
            updatedAt: input.deniedAt,
          },
        })
      // The global generation fences races; every capability row must observe
      // the same generation or unrelated capabilities fail closed.
      await tx.update(capabilityExecutionControl).set({ emergencyKillVersion })
      return emergencyKillVersion
    },

    allowCapability: async (tx, capability, input) => {
      const emergencyKillVersion = await nextEmergencyKillVersion(tx)
      await tx
        .insert(capabilityExecutionControl)
        .values({
          capability,
          denied: false,
          emergencyKillVersion,
          deniedAt: null,
          drainedAt: null,
          cleanupDrainedAt: null,
          operatorId: input.operatorId,
          reason: input.reason,
          updatedAt: input.changedAt,
        })
        .onConflictDoUpdate({
          target: capabilityExecutionControl.capability,
          set: {
            denied: false,
            emergencyKillVersion,
            deniedAt: null,
            drainedAt: null,
            cleanupDrainedAt: null,
            operatorId: input.operatorId,
            reason: input.reason,
            updatedAt: input.changedAt,
          },
        })
      // Preserve capability-local allow/deny state while advancing the shared
      // emergency generation used by transactional authorization checks.
      await tx.update(capabilityExecutionControl).set({ emergencyKillVersion })
      return emergencyKillVersion
    },

    fenceActivePermits: async (tx, capability, at) => {
      await tx
        .update(authorizationExecutionPermits)
        .set({ state: 'fenced', fencedAt: at })
        .where(
          and(
            eq(authorizationExecutionPermits.capability, capability),
            inArray(authorizationExecutionPermits.state, ['admitted', 'started']),
          ),
        )
    },

    hasActiveCapabilityWork: async (tx, capability) => {
      const rows = await tx
        .select({ value: sql<number>`COUNT(*)` })
        .from(authorizationExecutionPermits)
        .where(
          and(
            eq(authorizationExecutionPermits.capability, capability),
            inArray(authorizationExecutionPermits.state, ['admitted', 'started']),
          ),
        )
      return Number(rows[0]?.value ?? 0) > 0
    },

    hasActiveCleanupWork: async (tx, capability) => {
      const result = await tx.execute(sql`
        SELECT COUNT(*) AS value
        FROM ${credentialRevokePermits} revoke
        JOIN ${googleCredentialSourceOperations} source
          ON source.id = revoke.source_operation_id
        JOIN ${authorizationExecutionPermits} permit
          ON permit.id = source.source_work_permit_id
        WHERE permit.capability = ${capability}::google_content_capability
          AND revoke.state IN ('active', 'dispatching', 'cleanup_ambiguous')
      `)
      const countRow = countRowSchema.parse(result.rows[0])
      return Number(countRow.value) > 0
    },

    markCapabilityDrained: async (tx, capability, at, input) => {
      await tx
        .update(capabilityExecutionControl)
        .set({
          drainedAt: input.workDrained ? at : undefined,
          cleanupDrainedAt: input.cleanupDrained ? at : undefined,
          updatedAt: at,
        })
        .where(
          and(
            eq(capabilityExecutionControl.capability, capability),
            eq(capabilityExecutionControl.denied, true),
          ),
        )
    },
  }
}
