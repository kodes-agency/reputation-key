// Test-only Portal command store. Production always uses the atomic PostgreSQL
// implementation; this fake keeps application tests at the command-store seam.

import type { PortalCommandStore } from '#/contexts/portal/application/ports/portal-command-store.port'
import type { InMemoryPortalRepo } from './in-memory-portal-repo'
import type { PortalRepository } from '#/contexts/portal/application/ports/portal.repository'
import type { PortalTokenRepository } from '#/contexts/portal/application/ports/portal-token.repository'
import type { PortalGroupRepository } from '#/contexts/portal/application/ports/portal-group.repository'
import type { PortalLinkRepository } from '#/contexts/portal/application/ports/portal-link.repository'
import type { EventBus } from '#/shared/events/event-bus'
import { portalError } from '#/contexts/portal/domain/errors'

export function createInMemoryPortalCommandStore(deps: {
  portalRepo: PortalRepository
  events: EventBus
  portalTokenRepo?: PortalTokenRepository
  portalGroupRepo?: PortalGroupRepository
  portalLinkRepo?: PortalLinkRepository
}): PortalCommandStore {
  const mutablePortalRepo = deps.portalRepo as InMemoryPortalRepo
  const fencePortal = async (
    organizationId: Parameters<InMemoryPortalRepo['findById']>[0],
    portalId: Parameters<InMemoryPortalRepo['findById']>[1],
    expectedUpdatedAt: Date,
    revision: Date,
    patch: Readonly<Record<string, unknown>> = {},
  ) => {
    const current = await deps.portalRepo.findById(organizationId, portalId)
    if (!current || current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw portalError('revision_conflict', 'Portal changed during command')
    }
    await mutablePortalRepo.update(organizationId, portalId, {
      ...patch,
      updatedAt: revision,
    })
  }
  return {
    createPortal: async (command) => {
      await mutablePortalRepo.insert(
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
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedUpdatedAt,
        command.revision,
        command.patch,
      )
      await deps.events.emit(command.event)
    },
    deletePortal: async (command) => {
      const current = await deps.portalRepo.findById(
        command.organizationId,
        command.portalId,
      )
      if (
        !current ||
        current.updatedAt.getTime() !== command.expectedUpdatedAt.getTime()
      ) {
        throw portalError('revision_conflict', 'Portal changed during command')
      }
      await mutablePortalRepo.softDelete(
        command.organizationId,
        command.portalId,
        command.occurredAt,
        command.revision,
      )
      const revoked =
        (await deps.portalTokenRepo?.revokeForPortal({
          organizationId: command.organizationId,
          portalId: command.portalId,
          revokedBy: command.revokedBy,
          reason: command.reason,
          at: command.occurredAt,
        })) ?? 0
      await deps.events.emit(command.event)
      if (revoked > 0) await deps.events.emit(command.tokenRevokedEvent)
      return { revoked }
    },
    createPortalGroup: async (command) => {
      if (!deps.portalGroupRepo) {
        throw new Error('in-memory Portal Group repository is not configured')
      }
      await deps.portalGroupRepo.insert(command.organizationId, command.group)
      for (const membership of command.memberships) {
        await deps.portalGroupRepo.addPortal(
          command.organizationId,
          command.group.id,
          membership.portalId,
          command.group.createdAt,
          membership.createdBy,
        )
      }
      for (const event of command.events) await deps.events.emit(event)
    },
    updatePortalGroup: async (command) => {
      if (!deps.portalGroupRepo) {
        throw new Error('in-memory Portal Group repository is not configured')
      }
      await deps.portalGroupRepo.update(command.organizationId, command.portalGroupId, {
        name: command.name,
        updatedAt: command.revision,
      })
      await deps.events.emit(command.event)
    },
    addPortalToGroup: async (command) => {
      if (!deps.portalGroupRepo) {
        throw new Error('in-memory Portal Group repository is not configured')
      }
      await deps.portalGroupRepo.addPortal(
        command.organizationId,
        command.portalGroupId,
        command.portalId,
        command.occurredAt,
        command.changedBy,
      )
      await deps.events.emit(command.event)
    },
    removePortalFromGroup: async (command) => {
      if (!deps.portalGroupRepo) {
        throw new Error('in-memory Portal Group repository is not configured')
      }
      const removed = await deps.portalGroupRepo.removePortal(
        command.organizationId,
        command.portalGroupId,
        command.portalId,
        command.occurredAt,
        'removed_from_group',
      )
      if (!removed) {
        throw portalError('portal_not_in_group', 'portal is not a member of this group')
      }
      await deps.events.emit(command.event)
    },
    createPortalLinkCategory: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.insertCategory(command.organizationId, command.category)
      await deps.events.emit(command.event)
    },
    updatePortalLinkCategory: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.updateCategory(
        command.organizationId,
        command.portalId,
        command.categoryId,
        { title: command.title, updatedAt: command.occurredAt },
      )
      await deps.events.emit(command.event)
    },
    deletePortalLinkCategory: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.deleteCategory(
        command.organizationId,
        command.portalId,
        command.categoryId,
      )
      await deps.events.emit(command.event)
    },
    reorderPortalLinkCategories: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.reorderCategories(
        command.organizationId,
        command.portalId,
        command.updates,
      )
      await deps.events.emit(command.event)
    },
    createPortalLink: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.insertLink(command.organizationId, command.link)
      await deps.events.emit(command.event)
    },
    updatePortalLink: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.updateLink(
        command.organizationId,
        command.portalId,
        command.linkId,
        { ...command.patch, updatedAt: command.occurredAt },
      )
      await deps.events.emit(command.event)
    },
    deletePortalLink: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.deleteLink(
        command.organizationId,
        command.portalId,
        command.linkId,
      )
      await deps.events.emit(command.event)
    },
    reorderPortalLinks: async (command) => {
      if (!deps.portalLinkRepo) {
        throw new Error('in-memory Portal Link repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalLinkRepo.reorderLinks(
        command.organizationId,
        command.portalId,
        command.categoryId,
        command.updates,
      )
      await deps.events.emit(command.event)
    },
    issuePortalToken: async (command) => {
      if (!deps.portalTokenRepo) {
        throw new Error('in-memory Portal Token repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalTokenRepo.insert(command.token)
      await deps.events.emit(command.event)
    },
    rotatePortalToken: async (command) => {
      if (!deps.portalTokenRepo) {
        throw new Error('in-memory Portal Token repository is not configured')
      }
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      await deps.portalTokenRepo.saveRotation({
        oldToken: command.oldToken,
        newToken: command.newToken,
      })
      await deps.events.emit(command.event)
    },
    revokePortalTokens: async (command) => {
      if (!deps.portalTokenRepo) {
        throw new Error('in-memory Portal Token repository is not configured')
      }
      const revoked = await deps.portalTokenRepo.revokeForPortal({
        organizationId: command.organizationId,
        portalId: command.portalId,
        revokedBy: command.revokedBy,
        reason: command.reason,
        at: command.occurredAt,
      })
      if (revoked > 0) {
        await mutablePortalRepo.update(command.organizationId, command.portalId, {
          updatedAt: command.revision,
        })
        await deps.events.emit(command.event)
      }
      return { revoked }
    },
    deletePortalGroup: async (command) => {
      if (!deps.portalGroupRepo) {
        throw new Error('in-memory Portal Group repository is not configured')
      }
      await deps.portalGroupRepo.softDelete(
        command.organizationId,
        command.portalGroupId,
        command.occurredAt,
      )
      await deps.portalGroupRepo.update(command.organizationId, command.portalGroupId, {
        updatedAt: command.revision,
      })
      await deps.events.emit(command.event)
    },
  }
}
