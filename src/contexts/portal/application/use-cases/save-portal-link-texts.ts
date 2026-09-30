// Portal context — save the per-language texts of a link.
//
// Manager-written texts only: a label and an optional line per language the
// Portal offers. The primary-language label is mirrored to the link's own label
// by the command store, so the legacy guest page keeps reading what it reads.

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalLinkId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalLinkUpdated } from '../../domain/events'
import { validateLinkTextInput, type ValidLinkText } from '../../domain/portal-linktree'
import { assertPortalPropertyAccess } from '../assert-property-access'
import { nextPortalCommandAt } from '../portal-command-version'

export type SavePortalLinkTextsInput = Readonly<{
  linkId: string
  texts: ReadonlyArray<
    Readonly<{ locale: GuestLocale; label: string; line?: string | null }>
  >
}>

export type SavePortalLinkTextsDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

function validateTexts(input: SavePortalLinkTextsInput): ValidLinkText[] {
  if (input.texts.length === 0) {
    throw portalError('invalid_label', 'Give at least one text to save')
  }
  return input.texts.map((text) => {
    // Manager input never carries a provenance: what a manager saves is theirs.
    const result = validateLinkTextInput({
      locale: text.locale,
      label: text.label,
      line: text.line ?? null,
    })
    if (result.isErr()) throw result.error
    return result.value
  })
}

export const savePortalLinkTexts =
  (deps: SavePortalLinkTextsDeps) =>
  async (input: SavePortalLinkTextsInput, ctx: AuthContext): Promise<void> => {
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot update portal links')
    }
    const target = await deps.portalLinkRepo.findLinkCommandTarget(
      ctx.organizationId,
      portalLinkId(input.linkId),
    )
    if (!target) throw portalError('link_not_found', 'link not found')
    const { link } = target
    const portal = await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      'portal.update',
      link.portalId,
    )

    const texts = validateTexts(input)
    const offered = [portal.primaryGuestLocale, ...portal.additionalGuestLocales]
    const requested = texts.map((text) => text.locale)
    if (
      new Set(requested).size !== requested.length ||
      requested.some((locale) => !offered.includes(locale))
    ) {
      throw portalError('locale_not_offered', 'This Portal does not offer that language')
    }

    const expectedPortalUpdatedAt = target.portalUpdatedAt ?? portal.updatedAt
    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, expectedPortalUpdatedAt)
    await deps.commandStore.savePortalLinkTexts({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt,
      revision,
      occurredAt,
      actorUserId: ctx.userId,
      linkId: link.id,
      categoryId: link.categoryId,
      texts,
      event: portalLinkUpdated({
        portalId: portal.id,
        linkId: link.id,
        categoryId: link.categoryId,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })
  }

export type SavePortalLinkTexts = ReturnType<typeof savePortalLinkTexts>
