// Portal context — what a new Portal takes over from the Portal it starts from.
//
// A copy is a plan, not a write: this module reads nothing and persists
// nothing. It turns the source's settings, wording, links and link texts into
// fresh rows that belong to the new Portal (new identifiers, the new language
// set), and the command store writes them with the Portal in one commit.
//
// What is never taken over: codes and their artifacts, publication snapshots
// and activations, responsible managers, health, history. Photos are left too:
// a Portal's hero image is a server-owned upload derivative, not wording.
// Links that are not an approved destination now (legacy, unclassified URLs,
// disabled or quarantined destinations) stay behind, because a new Portal must
// not start with a link nobody approved, and they take no slot of the link limit.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  portalLinkCategoryId,
  portalLinkId,
  type PortalId,
  type PortalLinkId,
} from '#/shared/domain/ids'
import type { Portal, PortalLink, PortalLinkCategory } from '../domain/types'
import { MAX_PORTAL_LINKS, type ResolvedPortalLinkText } from '../domain/portal-linktree'
import type { NewPortalLocales } from '../domain/portal-new-locales'
import type {
  CopiedPortalOverride,
  CreatePortalCopiedContent,
} from './ports/portal-command-store.port'
import type { PortalLocalizedOverride } from './ports/portal-experience.repository'

/** Everything read from the Portal being copied. */
export type PortalCopySource = Readonly<{
  portal: Portal
  overrides: readonly PortalLocalizedOverride[]
  categories: readonly PortalLinkCategory[]
  links: readonly PortalLink[]
  linkTexts: readonly ResolvedPortalLinkText[]
  /** The Property's destinations that are approved now; a link elsewhere stays behind. */
  approvedDestinationIds: ReadonlySet<string>
}>

/** The Portal fields a copy carries into `buildPortal`. */
export type CopiedPortalSettings = Pick<
  Portal,
  'description' | 'privateFeedbackThreshold' | 'linktreeEnabled' | 'theme'
>

export type PortalContentCopyPlan = Readonly<{
  settings: CopiedPortalSettings
  content: CreatePortalCopiedContent
}>

type PlanInput = Readonly<{
  source: PortalCopySource
  target: Readonly<{ portalId: PortalId; locales: NewPortalLocales }>
  idGen: () => string
  now: Date
}>

const targetLocaleList = (locales: NewPortalLocales): readonly GuestLocale[] => [
  locales.primary,
  ...locales.additional,
]

function copyOverrides(
  source: PortalCopySource,
  offered: readonly GuestLocale[],
  idGen: () => string,
): readonly CopiedPortalOverride[] {
  return offered.flatMap((locale) => {
    const row = source.overrides.find((candidate) => candidate.locale === locale)
    if (!row) return []
    const { title, shortDescription, linktreeTitle } = row
    // A row that only held a photo has nothing left to say once the photo stays behind.
    if (title === null && shortDescription === null && linktreeTitle === null) return []
    return [{ id: idGen(), locale, title, shortDescription, linktreeTitle }]
  })
}

/** Approved links in the order a guest sees them, at most as many as a Portal may carry. */
function linksToCopy(source: PortalCopySource): readonly PortalLink[] {
  const categoryRank = new Map(
    [...source.categories]
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((category, index) => [category.id, index] as const),
  )
  return source.links
    .filter(
      (link) =>
        link.destinationId !== null &&
        source.approvedDestinationIds.has(link.destinationId),
    )
    .sort(
      (a, b) =>
        (categoryRank.get(a.categoryId) ?? 0) - (categoryRank.get(b.categoryId) ?? 0) ||
        a.sortKey.localeCompare(b.sortKey),
    )
    .slice(0, MAX_PORTAL_LINKS)
}

function copyLinksAndTexts(
  input: PlanInput,
): Pick<CreatePortalCopiedContent, 'categories' | 'links' | 'linkTexts'> {
  const { source, target, idGen, now } = input
  const chosen = linksToCopy(source)
  const newCategoryIds = new Map<string, PortalLinkCategory['id']>()
  const categories = source.categories
    .filter((category) => chosen.some((link) => link.categoryId === category.id))
    .map((category): PortalLinkCategory => {
      const id = portalLinkCategoryId(idGen())
      newCategoryIds.set(category.id, id)
      return {
        ...category,
        id,
        portalId: target.portalId,
        createdAt: now,
        updatedAt: now,
      }
    })

  const textOf = (linkId: string, locale: GuestLocale) =>
    source.linkTexts.find((text) => text.linkId === linkId && text.locale === locale)
  const locales = targetLocaleList(target.locales)

  const copied = chosen.map((link) => {
    const id: PortalLinkId = portalLinkId(idGen())
    const sourcePrimaryLabel =
      textOf(link.id, source.portal.primaryGuestLocale)?.label ?? link.label
    const texts = locales.flatMap((locale) => {
      const own = textOf(link.id, locale)
      if (own) {
        return [
          {
            linkId: id,
            locale,
            label: own.label,
            line: own.line,
            provenance: own.provenance,
          },
        ]
      }
      // The primary language always has a text; no link is ever unnamed.
      return locale === target.locales.primary
        ? [
            {
              linkId: id,
              locale,
              label: sourcePrimaryLabel,
              line: null,
              provenance: null,
            },
          ]
        : []
    })
    const newLink: PortalLink = {
      ...link,
      id,
      portalId: target.portalId,
      categoryId: newCategoryIds.get(link.categoryId) ?? link.categoryId,
      // The copy's wording is its texts; the legacy label is not carried over.
      label: '',
      createdAt: now,
      updatedAt: now,
    }
    return { link: newLink, texts }
  })

  return {
    categories,
    links: copied.map(({ link }) => link),
    linkTexts: copied.flatMap(({ texts }) => texts),
  }
}

export function planPortalContentCopy(input: PlanInput): PortalContentCopyPlan {
  const { source, target, idGen } = input
  const { description, privateFeedbackThreshold, linktreeEnabled, theme } = source.portal
  return {
    settings: { description, privateFeedbackThreshold, linktreeEnabled, theme },
    content: {
      sourcePortalId: source.portal.id,
      overrides: copyOverrides(source, targetLocaleList(target.locales), idGen),
      ...copyLinksAndTexts(input),
    },
  }
}
