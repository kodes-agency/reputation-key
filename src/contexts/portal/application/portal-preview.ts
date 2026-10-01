// Portal context — what the editor's live preview shows: the guest page of one
// Portal, as a v3-shaped (Immersive Hub) description, from either the working
// copy (the draft) or the verified version guests can open now (live).
//
// Pure. Two rules shape it:
//
//  - It carries no address. The guest page never sees a destination (a tap goes
//    through the tracked click endpoint by link id), and a preview that listed
//    one would leak an address nobody has approved. A tile whose address is not
//    approved is therefore a placeholder (`awaiting_approval` or
//    `not_approved`): it keeps its words so the manager can tell which tile it
//    is, and nothing else.
//  - It is lenient where publishing is strict. A draft with a gap still shows,
//    filled the way publishing will fill it, so a manager sees what a guest in
//    that language would read. Whether the gap blocks publishing is Review's
//    job. The rule is per field. Wording a Property wrote (title, short
//    description, photo description) and a tile's words copy the primary
//    language in, tagged with `fallbackFrom`. The Linktree title does not: it
//    is one title per language with a "Use default" reset, so a language with
//    none reads its language pack's default, never another language's title.

import { deriveFieldColour } from '#/shared/domain/portal-field-colour'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  type PortalPublicationSnapshot,
} from '../domain/portal-publication-snapshot'
import { linktreeDefaultTitle } from '../domain/portal-linktree'
import { hasPropertyWording } from '../domain/property-wording'
import {
  DEFAULT_PORTAL_ACCENT,
  DEFAULT_PORTAL_FIELD,
} from '../domain/portal-publication-source'
import type {
  PortalLinktreeDestinationState,
  PortalLinktreeView,
} from '../domain/portal-linktree-view'
import type { Portal } from '../domain/types'
import { portalMediaPublicPath } from '#/shared/domain/portal-media'
import type { PropertyLookMedia } from './property-look-media'
import { presentImmersivePortal, type ServableMediaUrls } from './public-portal-immersive'
import type { PublicImmersiveExperience, PublicPortalText } from './public-api'

export const PORTAL_PREVIEW_SOURCES = Object.freeze(['draft', 'live'] as const)
export type PortalPreviewSource = (typeof PORTAL_PREVIEW_SOURCES)[number]

/**
 * `ready` is a tile guests would open. The other two are draft tiles whose
 * address is not approved: publishing leaves them out, so the preview draws a
 * placeholder. `awaiting_approval` is a request an account admin has yet to
 * answer; `not_approved` is an address an admin disabled, or a legacy one that
 * was never reviewed, which is not waiting for anything.
 */
export type PortalPreviewLinkState = 'ready' | 'awaiting_approval' | 'not_approved'

function linkStateOf(approval: PortalLinktreeDestinationState): PortalPreviewLinkState {
  if (approval === 'approved') return 'ready'
  return approval === 'pending' ? 'awaiting_approval' : 'not_approved'
}

export type PortalPreviewLink = Readonly<{
  id: string
  state: PortalPreviewLinkState
  iconKey: string | null
  imageUrl: string | null
  label: string
  line: string | null
  fallbackFrom: GuestLocale | null
}>

/** One language of the page: `PublicImmersiveExperience`, with preview tiles. */
export type PortalPreviewExperience = Readonly<
  Omit<PublicImmersiveExperience, 'links'> & { links: readonly PortalPreviewLink[] }
>

export type PortalPreview = Readonly<{
  portalId: string
  source: PortalPreviewSource
  /** The published version being shown; null for the draft. */
  version: number | null
  primaryLocale: GuestLocale
  /** Every language the page offers, the primary first. */
  locales: readonly GuestLocale[]
  /** Ratings at or below this inclusive value are offered a private note. */
  privateFeedbackThreshold: number
  experiences: Readonly<Partial<Record<GuestLocale, PortalPreviewExperience>>>
}>

export type PortalPreviewUnavailableReason =
  /** No version is live (never published, or switched off). */
  | 'not_published'
  /** The live version was published with the earlier page design, which this preview does not draw. */
  | 'earlier_design'
  /** The live version cannot be shown in every language it offers. */
  | 'incomplete'

export type PortalPreviewOutcome =
  | Readonly<{ status: 'ready'; preview: PortalPreview }>
  | Readonly<{
      status: 'unavailable'
      source: PortalPreviewSource
      reason: PortalPreviewUnavailableReason
    }>

// ── The draft ────────────────────────────────────────────────────────────────

type PreviewProfile = Readonly<{
  displayName: string
  wordmark: string | null
  primaryColor: string
  backgroundColor: string
  backgroundMode: 'auto' | 'manual'
}>

type PreviewContent = Readonly<{
  locale: GuestLocale
  title: string
  shortDescription: string
  heroAltText: string | null
}>

type PreviewOverride = Readonly<{
  locale: GuestLocale
  title: string | null
  shortDescription: string | null
  heroImageUrl: string | null
}>

export type DraftPortalPreviewInput = Readonly<{
  portal: Pick<
    Portal,
    | 'id'
    | 'name'
    | 'description'
    | 'primaryGuestLocale'
    | 'additionalGuestLocales'
    | 'linktreeEnabled'
    | 'privateFeedbackThreshold'
  >
  linktree: PortalLinktreeView
  profile: PreviewProfile | null
  /**
   * The Property's photograph and logo, from uploaded assets that may still be
   * served. A page only ever draws these: an address left on the profile (or
   * typed into an override) is not published, so it is not previewed either.
   */
  media: PropertyLookMedia
  content: readonly PreviewContent[]
  overrides: readonly PreviewOverride[]
  /** The Property's IANA time zone. */
  timeZone: string
}>

const isWritten = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0

const firstWritten = (...candidates: ReadonlyArray<string | null | undefined>) =>
  candidates.find(isWritten)

function localeSetOf(portal: DraftPortalPreviewInput['portal']): GuestLocale[] {
  return [portal.primaryGuestLocale, ...portal.additionalGuestLocales].filter(
    (locale, index, all) => all.indexOf(locale) === index,
  )
}

const own = (value: string): PublicPortalText => ({ value, fallbackFrom: null })

/**
 * A text in `locale`: its own wording when written, else the primary language's
 * copied in and tagged, else `last`. Publishing fills a gap the same way, which
 * keeps the page's `lang` honest for the copied text.
 */
function textIn(
  locale: GuestLocale,
  primary: GuestLocale,
  writtenIn: (locale: GuestLocale) => string | undefined,
  last: string,
): PublicPortalText {
  const written = writtenIn(locale)
  if (written !== undefined) return own(written)
  const copied = locale === primary ? undefined : writtenIn(primary)
  if (copied !== undefined) return { value: copied, fallbackFrom: primary }
  return own(last)
}

/**
 * The look as the page draws it. The field follows the accent unless the
 * Property chose it by hand; the page's own resolver still guards legibility.
 */
function brandOf(input: DraftPortalPreviewInput): PublicImmersiveExperience['brand'] {
  const { profile, portal, media } = input
  const accentColour = profile?.primaryColor ?? DEFAULT_PORTAL_ACCENT
  const fieldColour =
    profile?.backgroundMode === 'manual'
      ? profile.backgroundColor
      : (deriveFieldColour(accentColour) ?? DEFAULT_PORTAL_FIELD)
  const { hero, logo } = media
  return {
    displayName: firstWritten(profile?.displayName) ?? portal.name,
    wordmark: firstWritten(profile?.wordmark) ?? null,
    logo: logo ? { url: logo.url, width: logo.width, height: logo.height } : null,
    hero: hero
      ? {
          url: hero.url,
          width: hero.width,
          height: hero.height,
          focalX: hero.focalX,
          focalY: hero.focalY,
        }
      : null,
    accentColour,
    fieldColour,
  }
}

function contentOf(
  input: DraftPortalPreviewInput,
  locale: GuestLocale,
): PortalPreviewExperience['content'] {
  const { portal, content, overrides } = input
  const primary = portal.primaryGuestLocale
  const contentIn = (code: GuestLocale) => content.find((row) => row.locale === code)
  const overrideIn = (code: GuestLocale) => overrides.find((row) => row.locale === code)
  // A language has wording only when the Property wrote some for it; a Portal
  // override then replaces it (the same rule the coverage read applies).
  const wordingIn = (key: 'title' | 'shortDescription') => (code: GuestLocale) => {
    const row = contentIn(code)
    if (!hasPropertyWording(row)) return undefined
    return firstWritten(overrideIn(code)?.[key], row[key])
  }
  const heroAltIn = (code: GuestLocale) => firstWritten(contentIn(code)?.heroAltText)
  const hasHeroAlt = heroAltIn(primary) !== undefined
  // The Linktree view already carries the titles a manager wrote.
  const customTitle = firstWritten(input.linktree.titles[locale])
  return {
    title: textIn(locale, primary, wordingIn('title'), portal.name),
    shortDescription: textIn(
      locale,
      primary,
      wordingIn('shortDescription'),
      portal.description ?? '',
    ),
    // An empty alt text marks the photo decorative; it is never "missing".
    heroAlt: hasHeroAlt ? textIn(locale, primary, heroAltIn, '') : own(''),
    linktreeTitle: own(customTitle ?? linktreeDefaultTitle(locale)),
  }
}

function linksOf(
  input: DraftPortalPreviewInput,
  locale: GuestLocale,
): readonly PortalPreviewLink[] {
  const primary = input.portal.primaryGuestLocale
  return input.linktree.links.map((link): PortalPreviewLink => {
    const textFor = (code: GuestLocale) =>
      link.texts.find((text) => text.locale === code && isWritten(text.label))
    const written = textFor(locale)
    const copied =
      written === undefined && locale !== primary ? textFor(primary) : undefined
    const used = written ?? copied
    return {
      id: link.id,
      state: linkStateOf(link.destination.state),
      iconKey: link.iconKey,
      // The view already leaves out a photo that may no longer be served.
      imageUrl: link.imageAssetId ? portalMediaPublicPath(link.imageAssetId) : null,
      label: used?.label ?? '',
      line: used?.line ?? null,
      fallbackFrom: copied ? primary : null,
    }
  })
}

/** The page as the working copy would publish it, in every language the Portal offers. */
export function buildDraftPortalPreview(input: DraftPortalPreviewInput): PortalPreview {
  const { portal } = input
  const primary = portal.primaryGuestLocale
  const locales = localeSetOf(portal)
  const brand = brandOf(input)
  const experiences = Object.fromEntries(
    locales.map((locale): [GuestLocale, PortalPreviewExperience] => [
      locale,
      {
        timeZone: input.timeZone,
        brand,
        content: contentOf(input, locale),
        linktree: { enabled: portal.linktreeEnabled },
        links: linksOf(input, locale),
      },
    ]),
  )
  return {
    portalId: String(portal.id),
    source: 'draft',
    version: null,
    primaryLocale: primary,
    locales,
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    experiences,
  }
}

// ── The live version ─────────────────────────────────────────────────────────

export type LivePortalPreviewInput = Readonly<{
  /** A snapshot that already passed `verifyPortalPublicationSnapshot`. */
  snapshot: PortalPublicationSnapshot
  /** The addresses an account admin currently stands behind, as the guest edge reads them. */
  approvedUris: ReadonlySet<string>
  /** The address of each image the version names that may still be served; one not listed is not drawn. */
  mediaUrls?: ServableMediaUrls
}>

/**
 * The version guests can open now, drawn from the verified snapshot the way the
 * public edge serves it: only addresses still approved, none when the Linktree
 * is off, and media only from what may be served.
 */
export function buildLivePortalPreview({
  snapshot,
  approvedUris,
  mediaUrls = {},
}: LivePortalPreviewInput): PortalPreviewOutcome {
  const configuration = snapshot.configuration
  if (configuration.schemaVersion !== IMMERSIVE_HUB_SCHEMA_VERSION) {
    return { status: 'unavailable', source: 'live', reason: 'earlier_design' }
  }
  const published = configuration.linktree.enabled
    ? configuration.links.filter((link) => approvedUris.has(link.url))
    : []
  const entries = configuration.localeSet.map((locale) => {
    const presented = presentImmersivePortal(configuration, locale, published, mediaUrls)
    return [locale, presented?.immersive] as const
  })
  const experiences: Partial<Record<GuestLocale, PortalPreviewExperience>> = {}
  for (const [locale, immersive] of entries) {
    if (!immersive) {
      return { status: 'unavailable', source: 'live', reason: 'incomplete' }
    }
    experiences[locale] = {
      ...immersive,
      links: immersive.links.map((link) => ({ ...link, state: 'ready' as const })),
    }
  }
  return {
    status: 'ready',
    preview: {
      portalId: configuration.portal.id,
      source: 'live',
      version: snapshot.version,
      primaryLocale: configuration.guestLocale,
      locales: configuration.localeSet,
      privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
      experiences,
    },
  }
}
