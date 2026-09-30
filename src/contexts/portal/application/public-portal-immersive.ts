// Maps a verified schema version 3 (Immersive Hub) configuration into what the
// public edge serves for one guest locale.
//
// Pure. Media is referenced by asset id in the snapshot and becomes a URL only
// here, from whatever the caller currently allows to be served, so a takedown
// reaches immutable snapshots. History-only facts (provenance) are never read.

import type {
  ImmersiveLink,
  ImmersivePortalPublicationConfiguration,
  PortalGuestLocale,
} from '../domain/portal-publication-snapshot'
import type {
  PublicImmersiveExperience,
  PublicPortalMedia,
  PublicPortalResult,
} from './public-api'

/** Servable media URLs by asset id; an asset missing from it is not served. */
export type ServableMediaUrls = Readonly<Record<string, string>>

/** Every asset id a v3 configuration refers to, once each, in a stable order. */
export function immersiveAssetIds(
  configuration: ImmersivePortalPublicationConfiguration,
): readonly string[] {
  const { logo, hero } = configuration.brandProfile
  const ids = [
    logo?.assetId,
    hero?.assetId,
    ...configuration.links.map((link) => link.imageAssetId),
  ]
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
}

/** The URL of an asset the caller allowed, never one inherited from Object.prototype. */
function urlOf(urls: ServableMediaUrls, assetId: string): string | undefined {
  return Object.hasOwn(urls, assetId) ? urls[assetId] : undefined
}

function mediaOf(
  reference: { assetId: string; width: number; height: number } | null,
  urls: ServableMediaUrls,
): PublicPortalMedia | null {
  const url = reference ? urlOf(urls, reference.assetId) : undefined
  return reference && url
    ? { url, width: reference.width, height: reference.height }
    : null
}

type LocalizedLink = Readonly<{
  link: ImmersiveLink
  text: NonNullable<ImmersiveLink['texts'][PortalGuestLocale]>
}>

/** Each approved link with its wording for `locale`; null when one has none. */
function localizedLinks(
  links: readonly ImmersiveLink[],
  locale: PortalGuestLocale,
): readonly LocalizedLink[] | null {
  const result: LocalizedLink[] = []
  for (const link of links) {
    const text = link.texts[locale]
    if (!text) return null
    result.push({ link, text })
  }
  return result
}

export type PublicImmersivePresentation = Readonly<{
  immersive: PublicImmersiveExperience
  portal: PublicPortalResult['portal']
  /** The approved links in the legacy shape, which click tracking still reads. */
  links: PublicPortalResult['links']
}>

/**
 * The served view of a v3 publication in `locale`, for the links that are still
 * approved. Null when the snapshot cannot serve that locale, which fails the
 * whole request closed.
 */
export function presentImmersivePortal(
  configuration: ImmersivePortalPublicationConfiguration,
  locale: PortalGuestLocale,
  approvedLinks: readonly ImmersiveLink[],
  mediaUrls: ServableMediaUrls,
): PublicImmersivePresentation | null {
  const content = configuration.localizedContent[locale]
  const links = localizedLinks(approvedLinks, locale)
  if (!content || !links) return null
  const brand = configuration.brandProfile
  const logo = mediaOf(brand.logo, mediaUrls)
  const heroMedia = mediaOf(brand.hero, mediaUrls)
  const hero =
    brand.hero && heroMedia
      ? { ...heroMedia, focalX: brand.hero.focalX, focalY: brand.hero.focalY }
      : null
  return {
    immersive: {
      timeZone: configuration.timeZone,
      brand: {
        displayName: brand.displayName,
        wordmark: brand.wordmark,
        logo,
        hero,
        accentColour: brand.accentColour,
        fieldColour: brand.fieldColour,
      },
      content: {
        title: content.title,
        shortDescription: content.shortDescription,
        heroAlt: content.heroAlt,
        linktreeTitle: content.linktreeTitle,
      },
      linktree: { enabled: configuration.linktree.enabled },
      links: links.map(({ link, text }) => ({
        id: link.id,
        iconKey: link.iconKey,
        imageUrl: (link.imageAssetId && urlOf(mediaUrls, link.imageAssetId)) || null,
        label: text.label,
        line: text.line,
        fallbackFrom: text.fallbackFrom,
      })),
    },
    portal: {
      id: configuration.portal.id,
      name: content.title.value,
      slug: configuration.portal.slug,
      description: content.shortDescription.value,
      heroImageUrl: hero?.url ?? null,
      theme: null,
      logoUrl: logo?.url ?? null,
      organizationName: brand.displayName,
    },
    links: links.map(({ link, text }, index) => ({
      id: link.id,
      label: text.label,
      url: link.url,
      categoryId: null,
      sortKey: String(index).padStart(4, '0'),
    })),
  }
}
