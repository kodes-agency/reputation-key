// Test-only Portal command store. Production always uses the atomic PostgreSQL
// implementation; this fake keeps application tests at the command-store seam.

import type { PortalCommandStore } from '#/contexts/portal/application/ports/portal-command-store.port'
import type { PortalRepository } from '#/contexts/portal/application/ports/portal.repository'
import type { PortalTokenRepository } from '#/contexts/portal/application/ports/portal-token.repository'
import type { PortalGroupRepository } from '#/contexts/portal/application/ports/portal-group.repository'
import type { EventBus } from '#/shared/events/event-bus'

export function createInMemoryPortalCommandStore(deps: {
  portalRepo: PortalRepository
  events: EventBus
  portalTokenRepo?: PortalTokenRepository
  portalGroupRepo?: PortalGroupRepository
}): PortalCommandStore {
  return {
    createPortal: async (command) => {
      await deps.portalRepo.insert(
        command.organizationId,
        command.portal,
        command.initialResponsibleManagerId,
      )
      await deps.events.emit(command.event)
      if (command.responsibilityNeededEvent) {
        await deps.events.emit(command.responsibilityNeededEvent)
      }
    },
    updatePortal: async (command) => {
      await deps.portalRepo.update(
        command.organizationId,
        command.portalId,
        command.patch,
      )
      await deps.events.emit(command.event)
    },
    deletePortal: async (command) => {
      await deps.portalRepo.softDelete(command.organizationId, command.portalId)
      const revoked =
        (await deps.portalTokenRepo?.revokeForPortal({
          organizationId: command.organizationId,
          portalId: command.portalId,
          revokedBy: command.revokedBy,
          reason: command.reason,
          at: command.at,
        })) ?? 0
      await deps.events.emit(command.event)
      if (revoked > 0) await deps.events.emit(command.tokenRevokedEvent)
      return { revoked }
    },
    deletePortalGroup: async (command) => {
      if (!deps.portalGroupRepo) {
        throw new Error('in-memory Portal Group repository is not configured')
      }
      await deps.portalGroupRepo.softDelete(
        command.organizationId,
        command.portalGroupId,
        command.at,
      )
      await deps.events.emit(command.event)
    },
  }
}
