import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { regionMoves } from '#/shared/db/schema/region-move.schema'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import type {
  RegionMoveAuditEntry,
  RegionMoveRequestCommandStore,
} from '../../application/ports/region-move-request-command-store.port'

type AuditExecutor = Pick<Database, 'execute'>
type AuditAppender = (
  executor: AuditExecutor,
  audit: RegionMoveAuditEntry,
) => Promise<void>

const appendAudit: AuditAppender = async (executor, audit) => {
  await executor.execute(sql`
    INSERT INTO policy_decision_audit (
      actor_type, actor_id, organization_id, property_id,
      action, capability, execution_kind, decision, reason,
      policy_version, correlation_id
    ) VALUES (
      'operator', ${audit.actorUserId}, ${audit.organizationId}, ${audit.propertyId},
      ${audit.action}, NULL, 'operator', ${audit.decision}, ${audit.reason},
      ${EXECUTION_POLICY_VERSION}, NULL
    )
  `)
}

const isActiveMoveUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as {
    code?: unknown
    constraint?: unknown
    cause?: unknown
  }
  return (
    (candidate.code === '23505' &&
      candidate.constraint === 'region_moves_one_active_per_property_idx') ||
    isActiveMoveUniqueViolation(candidate.cause)
  )
}

export const createRegionMoveRequestCommandStore = (
  db: Database,
  options: Readonly<{ writeAudit?: AuditAppender }> = {},
): RegionMoveRequestCommandStore => {
  const writeAudit = options.writeAudit ?? appendAudit
  return {
    recordRequest: async ({ move, audit }) => {
      if (
        move.state !== 'requested' ||
        move.stateRevision !== 1 ||
        move.denialReason !== null ||
        move.completedAt !== null ||
        move.error !== null ||
        move.requestedAt.getTime() !== move.stateChangedAt.getTime()
      ) {
        throw new Error('Region move request must start at requested revision 1')
      }
      if (
        audit.action !== 'policy.region.move.request' ||
        audit.decision !== 'allow' ||
        audit.organizationId !== move.organizationId ||
        audit.propertyId !== move.propertyId ||
        audit.actorUserId !== move.requestedBy
      ) {
        throw new Error('Region move request audit does not match the requested move')
      }
      try {
        await db.transaction(async (tx) => {
          const property = await tx
            .select({ id: properties.id })
            .from(properties)
            .where(
              and(
                eq(properties.id, move.propertyId),
                eq(properties.organizationId, move.organizationId),
              ),
            )
            .limit(1)
          if (!property[0]) {
            throw new Error(
              'Region move request Property does not belong to the command tenant',
            )
          }
          await tx.insert(regionMoves).values({
            id: move.id,
            propertyId: move.propertyId,
            organizationId: move.organizationId,
            fromRegion: move.fromRegion,
            toRegion: move.toRegion,
            state: move.state,
            stateRevision: move.stateRevision,
            denialReason: move.denialReason,
            requestedBy: move.requestedBy,
            requestedAt: move.requestedAt,
            stateChangedAt: move.stateChangedAt,
            completedAt: move.completedAt,
            error: move.error,
          })
          await writeAudit(tx, audit)
        })
        return 'recorded'
      } catch (error) {
        if (isActiveMoveUniqueViolation(error)) return 'active_move_exists'
        throw error
      }
    },
  }
}
