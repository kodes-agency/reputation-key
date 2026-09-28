import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { IdentityPort } from '../application/ports/identity.port'
import {
  grantPropertyAccess,
  hasActiveGrant,
} from './repositories/property-access-grant.repository'

/**
 * Build the container-scoped post-acceptance capability used by the Better
 * Auth Identity adapter. Property selections from the durable invitation are
 * access grants only; Staff participation remains a separate manager command.
 * Each Property is failure-isolated so one stale selection cannot suppress a
 * valid sibling grant, while retry/concurrency converges on the active row.
 */
export function createInvitationPropertyAccessProvisioner(
  deps: Readonly<{
    db: Database
    clock: Clock
    logger: Pick<LoggerPort, 'warn'>
  }>,
): IdentityPort['runOnAcceptInvitation'] {
  return async ({ organizationId: orgId, userId, propertyIds }) => {
    for (const propertyId of propertyIds) {
      const input = { organizationId: orgId, propertyId, userId } as const
      try {
        if (await hasActiveGrant(deps.db, { ...input, at: deps.clock() })) continue
        try {
          await grantPropertyAccess(deps.db, {
            ...input,
            source: 'invitation',
            createdBy: `invitation:${userId}`,
          })
        } catch (error) {
          // A concurrent/retried acceptance may have won the unique race.
          // Suppress only after a fresh authority read proves convergence.
          const active = await hasActiveGrant(deps.db, {
            ...input,
            at: deps.clock(),
          })
          if (!active) throw error
        }
      } catch (error) {
        deps.logger.warn({ err: error }, 'Failed to provision invited property access')
      }
    }
  }
}
