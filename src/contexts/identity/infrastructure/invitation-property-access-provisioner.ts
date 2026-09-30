import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { IdentityPort } from '../application/ports/identity.port'
import {
  grantPropertyAccess,
  hasActiveGrant,
} from './repositories/property-access-grant.repository'

/** What one provisioning pass could not grant. */
export type InvitationPropertyAccessProvisioning = Readonly<{
  failedPropertyIds: ReadonlyArray<string>
}>

export type InvitationPropertyAccessProvisioner = (
  ctx: Parameters<IdentityPort['runOnAcceptInvitation']>[0],
) => Promise<InvitationPropertyAccessProvisioning>

/** Creator of an invitation grant whose inviter is unknown (older rows). */
const UNKNOWN_INVITER = 'invitation'

/**
 * Build the container-scoped post-acceptance capability used by the Better
 * Auth Identity adapter. Property selections from the durable invitation are
 * access grants only; Staff participation remains a separate manager command.
 * Each grant records the inviter as its creator (A8). Each Property is
 * failure-isolated so one stale selection cannot suppress a valid sibling
 * grant, while retry/concurrency converges on the active row. What could not
 * be granted is returned, and a partial pass is logged once at error level
 * (I3), so a manager left with fewer Properties than invited is visible.
 */
export function createInvitationPropertyAccessProvisioner(
  deps: Readonly<{
    db: Database
    clock: Clock
    logger: Pick<LoggerPort, 'warn' | 'error'>
  }>,
): InvitationPropertyAccessProvisioner {
  return async ({ organizationId: orgId, userId, propertyIds, inviterId }) => {
    const failedPropertyIds: string[] = []
    for (const propertyId of propertyIds) {
      const input = { organizationId: orgId, propertyId, userId } as const
      try {
        if (await hasActiveGrant(deps.db, { ...input, at: deps.clock() })) continue
        try {
          await grantPropertyAccess(deps.db, {
            ...input,
            source: 'invitation',
            createdBy: inviterId ?? UNKNOWN_INVITER,
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
        failedPropertyIds.push(propertyId)
        deps.logger.warn({ err: error }, 'Failed to provision invited property access')
      }
    }
    if (failedPropertyIds.length > 0) {
      // Counts only: tenant identifiers are never log fields (BQC-7.3). The
      // request's correlation fields tie this line to the acceptance.
      deps.logger.error(
        {
          failedPropertyCount: failedPropertyIds.length,
          requestedPropertyCount: propertyIds.length,
        },
        'Invited property access was only partly provisioned',
      )
    }
    return { failedPropertyIds }
  }
}
