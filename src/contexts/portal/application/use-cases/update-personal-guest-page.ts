// Portal context — keeping a person's guest page in step with another Portal (ADR 0076,
// R19). The source's wording, links and look replace the page's and go live, overwriting
// anything customised there. The page's code, results, Group, responsible managers and
// rating settings stay its own. A page that is paused keeps the new content for later.
// Everything publishing asks is asked first. If it still refuses, the new content waits
// as the page's draft and the caller is told, because guests are still on the old page.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId as toPortalId, type PortalLinkId } from '#/shared/domain/ids'
import { PRINT_DEFAULT_WORDING } from '#/shared/domain/portal-print-wording'
import { isPortalError, portalError } from '../../domain/errors'
import type { PortalLink } from '../../domain/types'
import { portalUpdated } from '../../domain/events'
import { resolveNewPortalLocales } from '../../domain/portal-new-locales'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { nextPortalCommandAt } from '../portal-command-version'
import { planPortalContentCopy } from '../portal-content-copy'
import {
  assertPortalHasOwnerAndAddress,
  assertPropertyAllowsPublication,
  loadVerifiedGoogleReviewDestination,
} from '../portal-publication-readiness'
import type { CreatePortalCopiedContent } from '../../publication/portal-command-store-port.server'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import {
  copiedPrintWording,
  readPersonalCopySource,
  type CreatePersonalPortalDeps,
} from './create-personal-portal'
import type { publishPortalChanges } from './publish-portal-changes'

export type UpdatePersonalGuestPageDeps = CreatePersonalPortalDeps &
  Readonly<{
    portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummaryForPortal'>
    publishChanges: ReturnType<typeof publishPortalChanges>
  }>

export type UpdatePersonalGuestPageResult =
  | Readonly<{ outcome: 'live' | 'saved' | 'unchanged' }>
  /** Replaced, but publishing refused: guests are still on the old page. */
  | Readonly<{ outcome: 'not_live'; message: string }>

/**
 * A link that keeps its destination keeps its id, so a guest with the page already open
 * can still tap it and the taps already counted stay with it.
 */
export function keepingLinkIds(
  content: CreatePortalCopiedContent,
  current: readonly Pick<PortalLink, 'id' | 'destinationId'>[],
): CreatePortalCopiedContent {
  const taken = new Set<PortalLinkId>()
  const kept = new Map<PortalLinkId, PortalLinkId>()
  const links = content.links.map((link) => {
    const same = current.find(
      (row) => row.destinationId === link.destinationId && !taken.has(row.id),
    )
    if (!same || link.destinationId === null) return link
    taken.add(same.id)
    kept.set(link.id, same.id)
    return { ...link, id: same.id }
  })
  return {
    ...content,
    links,
    linkTexts: content.linkTexts.map((text) => ({
      ...text,
      linkId: kept.get(text.linkId) ?? text.linkId,
    })),
  }
}

export const updatePersonalGuestPage =
  (deps: UpdatePersonalGuestPageDeps) =>
  async (
    input: Readonly<{ portalId: string; sourcePortalId: string }>,
    ctx: AuthContext,
  ): Promise<UpdatePersonalGuestPageResult> => {
    const pid = toPortalId(input.portalId)
    const page = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to change this guest page',
    })
    if (page.kind !== 'personal')
      throw portalError('forbidden', 'Only a person’s guest page can be updated this way')
    if (page.publicationState === 'archived')
      throw portalError('portal_inactive', 'This guest page has been removed')
    if (input.sourcePortalId === input.portalId) return { outcome: 'unchanged' }
    const live = page.publicationState === 'published'
    const occurredAt = deps.clock()
    // Asked first: a publish that refuses after the replace would leave the page's
    // new content waiting and its guests on the old.
    if (live) {
      await assertPropertyAllowsPublication(deps, ctx.organizationId, page)
      await loadVerifiedGoogleReviewDestination(deps, ctx.organizationId, page)
      await assertPortalHasOwnerAndAddress(deps, ctx, page, occurredAt)
    }
    const source = await readPersonalCopySource(
      deps,
      ctx,
      page.propertyId,
      input.sourcePortalId,
      [page.name],
    )
    const [printWording, currentLinks] = await Promise.all([
      copiedPrintWording(deps, ctx, source.id, page.name),
      deps.portalLinkRepo.listAllLinks(ctx.organizationId, pid),
    ])
    const revision = nextPortalCommandAt(occurredAt, page.updatedAt)
    const locales = resolveNewPortalLocales({
      source: {
        primary: source.primaryGuestLocale,
        additional: source.additionalGuestLocales,
      },
      propertyDefaults: [],
    })
    const plan = planPortalContentCopy({
      source: source.copy,
      target: { portalId: pid, locales },
      idGen: deps.entityIdGen,
      now: revision,
    })
    await deps.commandStore.replacePersonalPortalContent({
      organizationId: ctx.organizationId,
      propertyId: page.propertyId,
      portalId: pid,
      actorUserId: ctx.userId,
      expectedUpdatedAt: page.updatedAt,
      revision,
      publicName: source.publicName ?? source.name,
      primaryGuestLocale: locales.primary,
      additionalGuestLocales: locales.additional,
      linktreeEnabled: plan.settings.linktreeEnabled,
      content: keepingLinkIds(plan.content, currentLinks),
      // Written, not cleared: a cleared row would fall back to this page's own last print.
      printWording: printWording ?? PRINT_DEFAULT_WORDING,
      sourceFence: source.sourceFence,
      event: portalUpdated({
        portalId: pid,
        organizationId: ctx.organizationId,
        propertyId: page.propertyId,
        previousPublicationState: page.publicationState,
        publicationState: page.publicationState,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })
    if (!live) return { outcome: 'saved' }
    try {
      await deps.publishChanges({ portalId: input.portalId }, ctx)
    } catch (error) {
      if (isPortalError(error)) return { outcome: 'not_live', message: error.message }
      throw error
    }
    return { outcome: 'live' }
  }
