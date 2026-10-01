// Portal context — what the editor's Linktree section reads: the link section's
// switch and titles, and each link in guest order with its texts, its icon and
// the approval of the place it opens.
//
// Pure: the use case reads the rows, this module shapes them. Links are listed
// in the order the guest page flattens them (category, then the link's own
// order), because the editor no longer shows categories.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import type {
  PortalApprovedDestination,
  PortalApprovedDestinationSource,
} from './approved-destination'
import {
  MAX_PORTAL_LINKS,
  type PortalLinkTextProvenance,
  type ResolvedPortalLinkText,
} from './portal-linktree'
import type { Portal, PortalLink, PortalLinkCategory } from './types'

/**
 * Where a link's destination stands. `unclassified` is a link from before
 * approvals that has no destination record (or whose record cannot be found):
 * it is never reported as approved.
 */
export type PortalLinktreeDestinationState =
  'approved' | 'pending' | 'disabled' | 'quarantined' | 'unclassified'

export type PortalLinktreeDestination = Readonly<{
  state: PortalLinktreeDestinationState
  sourceType: PortalApprovedDestinationSource | null
  /** The user who approved it; only set while it is approved. */
  approvedByUserId: string | null
}>

export type PortalLinktreeText = Readonly<{
  locale: GuestLocale
  label: string
  line: string | null
  provenance: PortalLinkTextProvenance | null
}>

export type PortalLinktreeLink = Readonly<{
  id: string
  categoryId: string
  url: string
  iconKey: string | null
  /** The uploaded picture the tile shows instead of its icon, if it has one. */
  imageAssetId: string | null
  sortKey: string
  texts: ReadonlyArray<PortalLinktreeText>
  destination: PortalLinktreeDestination
}>

export type PortalLinktreeView = Readonly<{
  portalId: string
  enabled: boolean
  maxLinks: number
  primaryLocale: GuestLocale
  /** Every language the Portal offers, the primary one first. */
  locales: ReadonlyArray<GuestLocale>
  /** The titles a manager wrote; a language with none uses the pack's default. */
  titles: Readonly<Partial<Record<GuestLocale, string>>>
  links: ReadonlyArray<PortalLinktreeLink>
}>

/** The link's own order inside its category, then the category's; ties on the id. */
export function orderLinksForLinktree(
  categories: ReadonlyArray<PortalLinkCategory>,
  links: ReadonlyArray<PortalLink>,
): ReadonlyArray<PortalLink> {
  const rank = new Map(
    [...categories]
      .sort((a, b) => compare(a.sortKey, b.sortKey) || compare(a.id, b.id))
      .map((category, index) => [String(category.id), index]),
  )
  const categoryRank = (link: PortalLink) =>
    rank.get(String(link.categoryId)) ?? Number.MAX_SAFE_INTEGER
  return [...links].sort(
    (a, b) =>
      categoryRank(a) - categoryRank(b) ||
      compare(a.sortKey, b.sortKey) ||
      compare(String(a.id), String(b.id)),
  )
}

function compare(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function summarizeLinkDestination(
  link: PortalLink,
  destinations: ReadonlyMap<string, PortalApprovedDestination>,
): PortalLinktreeDestination {
  const record = link.destinationId ? destinations.get(String(link.destinationId)) : null
  if (!record) {
    return {
      state:
        link.legacyDestinationState === 'quarantined' ? 'quarantined' : 'unclassified',
      sourceType: null,
      approvedByUserId: null,
    }
  }
  return {
    state: record.approvalState,
    sourceType: record.sourceType,
    approvedByUserId:
      record.approvalState === 'approved' && record.approvedBy
        ? String(record.approvedBy)
        : null,
  }
}

export type BuildPortalLinktreeViewInput = Readonly<{
  portal: Portal
  categories: ReadonlyArray<PortalLinkCategory>
  links: ReadonlyArray<PortalLink>
  texts: ReadonlyArray<ResolvedPortalLinkText>
  titles: ReadonlyArray<Readonly<{ locale: GuestLocale; linktreeTitle: string | null }>>
  destinations: ReadonlyArray<PortalApprovedDestination>
}>

export function buildPortalLinktreeView(
  input: BuildPortalLinktreeViewInput,
): PortalLinktreeView {
  const destinations = new Map(
    input.destinations.map((destination) => [String(destination.id), destination]),
  )
  const titles: Partial<Record<GuestLocale, string>> = {}
  for (const entry of input.titles) {
    if (entry.linktreeTitle !== null) titles[entry.locale] = entry.linktreeTitle
  }
  return {
    portalId: String(input.portal.id),
    enabled: input.portal.linktreeEnabled,
    maxLinks: MAX_PORTAL_LINKS,
    primaryLocale: input.portal.primaryGuestLocale,
    locales: [input.portal.primaryGuestLocale, ...input.portal.additionalGuestLocales],
    titles,
    links: orderLinksForLinktree(input.categories, input.links).map((link) => ({
      id: String(link.id),
      categoryId: String(link.categoryId),
      url: link.url,
      iconKey: link.iconKey,
      imageAssetId: link.imageAssetId ? String(link.imageAssetId) : null,
      sortKey: link.sortKey,
      texts: input.texts
        .filter((text) => text.linkId === String(link.id))
        .map((text) => ({
          locale: text.locale,
          label: text.label,
          line: text.line,
          provenance: text.provenance,
        })),
      destination: summarizeLinkDestination(link, destinations),
    })),
  }
}
