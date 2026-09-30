// Portal context — save the Linktree section's switch and its title per language.
//
// The title is the manager's own words for the link section; null or blank
// resets a language to the default ("Useful links", translated in the guest
// language packs). Both parts are optional, but one must be given.

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { assertRequestedLocalesOffered } from '../../domain/rules'
import { portalUpdated } from '../../domain/events'
import { validateLinktreeTitle } from '../../domain/portal-linktree'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { nextPortalCommandAt } from '../portal-command-version'

export type SaveLinktreeSettingsInput = Readonly<{
  portalId: string
  enabled?: boolean
  titles?: ReadonlyArray<Readonly<{ locale: GuestLocale; title: string | null }>>
}>

export type SaveLinktreeSettingsDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  idGen: () => string
  clock: () => Date
}>

export const saveLinktreeSettings =
  (deps: SaveLinktreeSettingsDeps) =>
  async (input: SaveLinktreeSettingsInput, ctx: AuthContext): Promise<void> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to update the Linktree',
    })
    const titles = input.titles ?? []
    if (input.enabled === undefined && titles.length === 0) {
      throw portalError('invalid_title', 'Give the switch or a title to save')
    }
    assertRequestedLocalesOffered(
      portal,
      titles.map((entry) => entry.locale),
    )
    const validTitles = titles.map((entry) => {
      const result = validateLinktreeTitle(entry.title)
      if (result.isErr()) throw result.error
      return { locale: entry.locale, title: result.value, overrideId: deps.idGen() }
    })

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
    await deps.commandStore.savePortalLinktreeSettings({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      revision,
      occurredAt,
      actorUserId: ctx.userId,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      titles: validTitles,
      event: portalUpdated({
        portalId: portal.id,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        previousPublicationState: portal.publicationState,
        publicationState: portal.publicationState,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })
  }

export type SaveLinktreeSettings = ReturnType<typeof saveLinktreeSettings>
