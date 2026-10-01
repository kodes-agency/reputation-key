// Test-only Portal command store. Production always uses the atomic PostgreSQL
// implementation; this fake keeps application tests at the command-store seam.

import type {
  CopiedPortalOverride,
  PortalCommandStore,
} from '#/contexts/portal/application/ports/portal-command-store.port'
import type { InMemoryPortalRepo } from './in-memory-portal-repo'
import type { PortalRepository } from '#/contexts/portal/application/ports/portal.repository'
import type { PortalTokenRepository } from '#/contexts/portal/application/ports/portal-token.repository'
import type { SealedPortalAddress } from '#/contexts/portal/application/ports/portal-address-cipher.port'
import type { InMemoryPortalAddressRepo } from './in-memory-portal-address-repo'
import type { PortalGroupRepository } from '#/contexts/portal/application/ports/portal-group.repository'
import type { PortalLinkRepository } from '#/contexts/portal/application/ports/portal-link.repository'
import type { InMemoryPortalLinkRepo } from './in-memory-portal-link-repo'
import { createRecordedOutbox, type RecordedOutbox } from './recorded-outbox'
import { portalError } from '#/contexts/portal/domain/errors'
import { hasRoomForAnotherLink } from '#/contexts/portal/domain/portal-linktree'
import {
  groupMovementEntries,
  portalGroupHistoryEntry,
  type PortalGroupHistoryDraft,
} from '#/contexts/portal/domain/portal-group-history'
import { unbrand } from '#/shared/domain/ids'
import type { GuestLocale } from '#/shared/domain/guest-locale'

export function createInMemoryPortalCommandStore(deps: {
  portalRepo: PortalRepository
  outbox?: RecordedOutbox
  portalTokenRepo?: PortalTokenRepository
  /** Where sealed addresses live; absent means the store keeps none. */
  portalAddressRepo?: InMemoryPortalAddressRepo
  portalGroupRepo?: PortalGroupRepository
  portalLinkRepo?: PortalLinkRepository
  /** Where the wording copied into a new Portal lands; the fake has no override table. */
  onCopiedOverrides?: (
    portalId: string,
    overrides: ReadonlyArray<CopiedPortalOverride>,
  ) => void
  /** Every manager the new Portal starts with; the Portal repository keeps at most one. */
  onInitialManagers?: (portalId: string, userIds: readonly string[]) => void
  /** Receives the Portal Group history entries the real store writes in its transactions. */
  groupHistory?: PortalGroupHistoryDraft[]
}): PortalCommandStore {
  const outbox = deps.outbox ?? createRecordedOutbox()
  const recordGroupHistory = (entries: ReadonlyArray<PortalGroupHistoryDraft>) => {
    deps.groupHistory?.push(...entries)
  }
  const groupRepo = () => {
    if (!deps.portalGroupRepo) {
      throw new Error('in-memory Portal Group repository is not configured')
    }
    return deps.portalGroupRepo
  }
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
  /** The sealed address of a code just made, in the shape the reveal read returns. */
  const storeSealedAddress = (
    command: Readonly<{
      organizationId: string
      portalId: string
      propertyId: string
      sealedAddress: SealedPortalAddress | null
      accessArtifacts: readonly [
        { id: string; channel: string },
        { id: string; channel: string },
      ]
    }>,
    token: Readonly<{ id: string; version: number; issuedAt: Date }>,
  ) => {
    if (!deps.portalAddressRepo || command.sealedAddress === null) return
    const [qr, nfc] = command.accessArtifacts
    deps.portalAddressRepo.store(command, {
      tokenId: token.id,
      propertyId: command.propertyId,
      version: token.version,
      issuedAt: token.issuedAt,
      sealed: command.sealedAddress,
      accessArtifactIds: { qr: qr.id, nfc: nfc.id },
    })
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
      // All or nothing, like the Postgres store: a stale group fence refuses the
      // command before the first write. (The command's own consistency guards
      // live in infrastructure, which a shared fake may not import; they are
      // tested against the real store.)
      const membership = command.groupMembership
      const groupRepo = deps.portalGroupRepo
      if (membership) {
        if (!groupRepo) {
          throw new Error('in-memory Portal Group repository is not configured')
        }
        const group = await groupRepo.findById(
          command.organizationId,
          membership.portalGroupId,
        )
        if (
          !group ||
          group.updatedAt.getTime() !== membership.expectedGroupUpdatedAt.getTime()
        ) {
          throw portalError('revision_conflict', 'Portal Group changed during command')
        }
      }
      await mutablePortalRepo.insert(
        command.organizationId,
        command.portal,
        command.initialResponsibleManagerIds[0] ?? null,
      )
      deps.onInitialManagers?.(command.portal.id, command.initialResponsibleManagerIds)
      await outbox.record(command.event)
      if (membership && groupRepo) {
        const { portalGroupId, revision, event } = membership
        await groupRepo.update(command.organizationId, portalGroupId, {
          updatedAt: revision,
        })
        await groupRepo.addPortal(
          command.organizationId,
          portalGroupId,
          command.portal.id,
          command.portal.createdAt,
          command.portal.createdBy ?? '',
        )
        recordGroupHistory([
          portalGroupHistoryEntry({
            organizationId: command.organizationId,
            propertyId: command.portal.propertyId,
            portalGroupId,
            kind: 'portal_added',
            portalId: command.portal.id,
            actorUserId: command.portal.createdBy ?? '',
            occurredAt: command.portal.createdAt,
          }),
        ])
        await outbox.record(event)
      }
      if (command.copiedContent) {
        const { categories, links, linkTexts, overrides } = command.copiedContent
        const writer = {
          actorUserId: command.portal.createdBy ?? '',
          at: command.portal.createdAt,
        }
        for (const category of categories) {
          await linkRepo().insertCategory(command.organizationId, category)
        }
        for (const link of links)
          await linkRepo().insertLink(command.organizationId, link)
        for (const link of links) {
          linkRepo().saveTexts(
            String(link.id),
            linkTexts.filter((text) => text.linkId === link.id),
            writer,
          )
        }
        for (const override of overrides) {
          if (override.linktreeTitle !== null) {
            linkRepo().saveLinktreeTitle(
              String(command.portal.id),
              override.locale,
              override.linktreeTitle,
            )
          }
        }
        deps.onCopiedOverrides?.(String(command.portal.id), overrides)
      }
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
      deps.portalAddressRepo?.clear(command)
      await outbox.record(command.event)
      if (revoked > 0) await outbox.record(command.tokenRevokedEvent)
      return { revoked }
    },
    createPortalGroup: async (command) => {
      const repo = groupRepo()
      const { group } = command
      for (const fence of command.sourceGroups) {
        await repo.update(command.organizationId, fence.portalGroupId, {
          updatedAt: fence.revision,
        })
      }
      await repo.insert(command.organizationId, group)
      for (const membership of command.memberships) {
        if (membership.movedFrom) {
          const left = await repo.removePortal(
            command.organizationId,
            membership.movedFrom.portalGroupId,
            membership.portalId,
            group.createdAt,
            'moved_to_group',
          )
          if (!left) {
            throw portalError(
              'revision_conflict',
              'Portal changed groups while the command was being committed',
            )
          }
        }
        await repo.addPortal(
          command.organizationId,
          group.id,
          membership.portalId,
          group.createdAt,
          membership.createdBy,
        )
      }
      recordGroupHistory([
        portalGroupHistoryEntry({
          organizationId: command.organizationId,
          propertyId: group.propertyId,
          portalGroupId: group.id,
          kind: 'created',
          name: group.name,
          actorUserId: unbrand(command.changedBy),
          occurredAt: group.createdAt,
        }),
        ...command.memberships.flatMap((membership) =>
          groupMovementEntries({
            organizationId: command.organizationId,
            propertyId: group.propertyId,
            portalId: membership.portalId,
            fromGroupId: membership.movedFrom?.portalGroupId ?? null,
            toGroupId: group.id,
            actorUserId: unbrand(membership.createdBy),
            occurredAt: group.createdAt,
          }),
        ),
      ])
      for (const event of command.events) await outbox.record(event)
      for (const membership of command.memberships) {
        if (membership.movedFrom) await outbox.record(membership.movedFrom.event)
      }
    },
    updatePortalGroup: async (command) => {
      await groupRepo().update(command.organizationId, command.portalGroupId, {
        name: command.name,
        updatedAt: command.revision,
      })
      if (command.name !== command.previousName) {
        recordGroupHistory([
          portalGroupHistoryEntry({
            organizationId: command.organizationId,
            propertyId: command.propertyId,
            portalGroupId: command.portalGroupId,
            kind: 'renamed',
            name: command.name,
            previousName: command.previousName,
            actorUserId: unbrand(command.changedBy),
            occurredAt: command.occurredAt,
          }),
        ])
      }
      await outbox.record(command.event)
    },
    addPortalToGroup: async (command) => {
      await groupRepo().addPortal(
        command.organizationId,
        command.portalGroupId,
        command.portalId,
        command.occurredAt,
        command.changedBy,
      )
      recordGroupHistory([
        portalGroupHistoryEntry({
          organizationId: command.organizationId,
          propertyId: command.propertyId,
          portalGroupId: command.portalGroupId,
          kind: 'portal_added',
          portalId: command.portalId,
          actorUserId: unbrand(command.changedBy),
          occurredAt: command.occurredAt,
        }),
      ])
      await outbox.record(command.event)
    },
    removePortalFromGroup: async (command) => {
      const removed = await groupRepo().removePortal(
        command.organizationId,
        command.portalGroupId,
        command.portalId,
        command.occurredAt,
        'removed_from_group',
      )
      if (!removed) {
        throw portalError('portal_not_in_group', 'portal is not a member of this group')
      }
      recordGroupHistory([
        portalGroupHistoryEntry({
          organizationId: command.organizationId,
          propertyId: command.propertyId,
          portalGroupId: command.portalGroupId,
          kind: 'portal_removed',
          portalId: command.portalId,
          actorUserId: unbrand(command.changedBy),
          occurredAt: command.occurredAt,
        }),
      ])
      await outbox.record(command.event)
    },
    movePortalToGroup: async (command) => {
      const repo = groupRepo()
      const current = await repo.findPortalMembership(
        command.organizationId,
        command.portalId,
      )
      if (command.from) {
        if (current !== command.from.portalGroupId) {
          throw portalError(
            'revision_conflict',
            'Portal changed groups while the move was being committed',
          )
        }
        await repo.removePortal(
          command.organizationId,
          command.from.portalGroupId,
          command.portalId,
          command.occurredAt,
          'moved_to_group',
        )
        await repo.update(command.organizationId, command.from.portalGroupId, {
          updatedAt: command.from.revision,
        })
      } else if (current) {
        throw portalError('portal_already_grouped', 'portal is already in a group')
      }
      await repo.addPortal(
        command.organizationId,
        command.to.portalGroupId,
        command.portalId,
        command.occurredAt,
        command.changedBy,
      )
      await repo.update(command.organizationId, command.to.portalGroupId, {
        updatedAt: command.to.revision,
      })
      recordGroupHistory(
        groupMovementEntries({
          organizationId: command.organizationId,
          propertyId: command.propertyId,
          portalId: command.portalId,
          fromGroupId: command.from?.portalGroupId ?? null,
          toGroupId: command.to.portalGroupId,
          actorUserId: unbrand(command.changedBy),
          occurredAt: command.occurredAt,
        }),
      )
      if (command.from) await outbox.record(command.from.event)
      await outbox.record(command.to.event)
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
      if (command.startCategory) {
        await deps.portalLinkRepo.insertCategory(
          command.organizationId,
          command.startCategory.category,
        )
        await outbox.record(command.startCategory.event)
      }
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
      storeSealedAddress(command, command.token)
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
      deps.portalAddressRepo?.clear(command)
      storeSealedAddress(command, command.newToken)
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
      deps.portalAddressRepo?.clear(command)
      if (revoked > 0) {
        await mutablePortalRepo.update(command.organizationId, command.portalId, {
          updatedAt: command.revision,
        })
        await outbox.record(command.event)
      }
      return { revoked }
    },
    deletePortalGroup: async (command) => {
      const repo = groupRepo()
      await repo.softDelete(
        command.organizationId,
        command.portalGroupId,
        command.occurredAt,
      )
      await repo.update(command.organizationId, command.portalGroupId, {
        updatedAt: command.revision,
      })
      recordGroupHistory([
        portalGroupHistoryEntry({
          organizationId: command.organizationId,
          propertyId: command.propertyId,
          portalGroupId: command.portalGroupId,
          kind: 'archived',
          actorUserId: unbrand(command.changedBy),
          occurredAt: command.occurredAt,
        }),
      ])
      await outbox.record(command.event)
    },
  }
}
