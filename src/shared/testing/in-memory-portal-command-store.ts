// Test-only Portal command store. Production always uses the atomic PostgreSQL
// implementation; this fake keeps application tests at the command-store seam.

import type { PortalCommandStore } from '#/contexts/portal/application/ports/portal-command-store.port'
import type { InMemoryPortalRepo } from './in-memory-portal-repo'
import type { PortalRepository } from '#/contexts/portal/application/ports/portal.repository'
import type { PortalTokenRepository } from '#/contexts/portal/application/ports/portal-token.repository'
import type { PortalGroupRepository } from '#/contexts/portal/application/ports/portal-group.repository'
import type { PortalLinkRepository } from '#/contexts/portal/application/ports/portal-link.repository'
import type { InMemoryPortalLinkRepo } from './in-memory-portal-link-repo'
import { createRecordedOutbox, type RecordedOutbox } from './recorded-outbox'
import { portalError } from '#/contexts/portal/domain/errors'
import { hasRoomForAnotherLink } from '#/contexts/portal/domain/portal-linktree'
import type { GuestLocale } from '#/shared/domain/guest-locale'

export function createInMemoryPortalCommandStore(deps: {
  portalRepo: PortalRepository
  outbox?: RecordedOutbox
  portalTokenRepo?: PortalTokenRepository
  portalGroupRepo?: PortalGroupRepository
  portalLinkRepo?: PortalLinkRepository
}): PortalCommandStore {
  const outbox = deps.outbox ?? createRecordedOutbox()
  const mutablePortalRepo = deps.portalRepo as InMemoryPortalRepo
  const linkRepo = (): InMemoryPortalLinkRepo => {
    if (!deps.portalLinkRepo) {
      throw new Error('in-memory Portal Link repository is not configured')
    }
    return deps.portalLinkRepo as InMemoryPortalLinkRepo
  }
  /** What the Portal offers guests, read after the fence like the real store does. */
  const localesOf = async (
    organizationId: Parameters<InMemoryPortalRepo['findById']>[0],
    portalId: Parameters<InMemoryPortalRepo['findById']>[1],
  ) => {
    const portal = await deps.portalRepo.findById(organizationId, portalId)
    if (!portal) throw portalError('revision_conflict', 'Portal changed during command')
    return {
      primary: portal.primaryGuestLocale,
      offered: [portal.primaryGuestLocale, ...portal.additionalGuestLocales],
    }
  }
  const assertOffered = (
    offered: readonly GuestLocale[],
    requested: readonly GuestLocale[],
  ) => {
    if (new Set(requested).size !== requested.length) {
      throw portalError('locale_not_offered', 'A language was given more than once')
    }
    if (requested.some((locale) => !offered.includes(locale))) {
      throw portalError('locale_not_offered', 'This Portal does not offer that language')
    }
  }
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
      await outbox.record(command.event)
      if (command.responsibilityNeededEvent) {
        await outbox.record(command.responsibilityNeededEvent)
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
      await outbox.record(command.event)
      if (command.lifecycleEvent) await outbox.record(command.lifecycleEvent)
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
      await outbox.record(command.event)
      if (revoked > 0) await outbox.record(command.tokenRevokedEvent)
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
      for (const event of command.events) await outbox.record(event)
    },
    updatePortalGroup: async (command) => {
      if (!deps.portalGroupRepo) {
        throw new Error('in-memory Portal Group repository is not configured')
      }
      await deps.portalGroupRepo.update(command.organizationId, command.portalGroupId, {
        name: command.name,
        updatedAt: command.revision,
      })
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      const existing = await deps.portalLinkRepo.listAllLinks(
        command.organizationId,
        command.portalId,
      )
      if (!hasRoomForAnotherLink(existing.length)) {
        throw portalError('link_limit_reached', 'A Portal can carry at most four links')
      }
      const { primary } = await localesOf(command.organizationId, command.portalId)
      await deps.portalLinkRepo.insertLink(command.organizationId, command.link)
      linkRepo().syncPrimaryText(String(command.link.id), primary, command.link.label, {
        actorUserId: String(command.actorUserId),
        at: command.occurredAt,
      })
      await outbox.record(command.event)
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
      const { primary } = await localesOf(command.organizationId, command.portalId)
      linkRepo().syncPrimaryText(String(command.linkId), primary, command.patch.label, {
        actorUserId: String(command.actorUserId),
        at: command.occurredAt,
      })
      await outbox.record(command.event)
    },
    savePortalLinkTexts: async (command) => {
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      const link = await linkRepo().findLinkById(command.organizationId, command.linkId)
      if (
        !link ||
        link.portalId !== command.portalId ||
        link.categoryId !== command.categoryId
      ) {
        throw portalError('revision_conflict', 'Portal link changed during update')
      }
      const locales = await localesOf(command.organizationId, command.portalId)
      assertOffered(
        locales.offered,
        command.texts.map((text) => text.locale),
      )
      linkRepo().saveTexts(String(command.linkId), command.texts, {
        actorUserId: String(command.actorUserId),
        at: command.occurredAt,
      })
      const primary = command.texts.find((text) => text.locale === locales.primary)
      if (primary) {
        await linkRepo().updateLink(
          command.organizationId,
          command.portalId,
          command.linkId,
          {
            label: primary.label,
            updatedAt: command.occurredAt,
          },
        )
      }
      await outbox.record(command.event)
    },
    savePortalLinktreeSettings: async (command) => {
      await fencePortal(
        command.organizationId,
        command.portalId,
        command.expectedPortalUpdatedAt,
        command.revision,
      )
      const titles = command.titles ?? []
      const locales = await localesOf(command.organizationId, command.portalId)
      assertOffered(
        locales.offered,
        titles.map((title) => title.locale),
      )
      if (command.enabled !== undefined) {
        await mutablePortalRepo.update(command.organizationId, command.portalId, {
          linktreeEnabled: command.enabled,
        })
      }
      for (const { locale, title } of titles) {
        linkRepo().saveLinktreeTitle(String(command.portalId), locale, title)
      }
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      await outbox.record(command.event)
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
      await outbox.record(command.event)
      for (const event of command.accessArtifactEvents) await outbox.record(event)
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
      await outbox.record(command.event)
      for (const event of command.accessArtifactEvents) await outbox.record(event)
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
        await outbox.record(command.event)
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
      await outbox.record(command.event)
    },
  }
}
