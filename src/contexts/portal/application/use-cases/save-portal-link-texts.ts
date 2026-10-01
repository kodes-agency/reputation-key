// Portal context — save the per-language texts of a link.
//
// Manager-written texts only: a label and an optional line per language the
// Portal offers. The texts are the only place a link's wording is written; the
// link's own legacy label column is no longer touched.

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalError } from '../../domain/errors'
import { assertRequestedLocalesOffered } from '../../domain/rules'
import { portalLinkUpdated } from '../../domain/events'
import { validateLinkTextInput, type ValidLinkText } from '../../domain/portal-linktree'
import { authorizeLinkCommand } from '../authorize-link-command'
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
    const { target, portal } = await authorizeLinkCommand(deps, ctx, input.linkId)
    const { link } = target

    const texts = validateTexts(input)
    assertRequestedLocalesOffered(
      portal,
      texts.map((text) => text.locale),
    )

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
