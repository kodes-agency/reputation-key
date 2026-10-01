// Portal context — what the editor's live preview shows: the guest page of one
// Portal, as a v3-shaped (Immersive Hub) description, from either the working
// copy (the draft) or the verified version guests can open now (live).
//
// Pure. Two rules shape it:
//
//  - It carries no address. The guest page never sees a destination (a tap goes
//    through the tracked click endpoint by link id), and a preview that listed
//    one would leak an address nobody has approved. A tile whose address is not
//    approved is therefore a placeholder (`awaiting_approval`): it keeps its
//    words so the manager can tell which tile it is, and nothing else.
//  - It is lenient where publishing is strict. A draft with a gap still shows,
//    filled the way publishing will fill it (the primary language copied in,
//    tagged with `fallbackFrom`), so a manager sees what a guest in that
//    language would read. Whether the gap blocks publishing is Review's job.

import { deriveFieldColour } from '#/shared/domain/portal-field-colour'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  type PortalPublicationSnapshot,
} from '../domain/portal-publication-snapshot'
import { linktreeDefaultTitle } from '../domain/portal-linktree'
import type { PortalLinktreeView } from '../domain/portal-linktree-view'
import type { Portal } from '../domain/types'
import { presentImmersivePortal } from './public-portal-immersive'
import type { PublicImmersiveExperience, PublicPortalText } from './public-api'

export const PORTAL_PREVIEW_SOURCES = Object.freeze(['draft', 'live'] as const)
export type PortalPreviewSource = (typeof PORTAL_PREVIEW_SOURCES)[number]

/**
 * `ready` is a tile guests would open. `awaiting_approval` is a draft tile
 * whose address no account admin has approved: publishing leaves it out, so
 * the preview draws a placeholder.
 */
export type PortalPreviewLinkState = 'ready' | 'awaiting_approval'

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

/** The accent of a Property that has no Brand Profile yet: champagne. */
const DEFAULT_ACCENT = '#EAD6A8'
/** Used only if the derived field cannot be computed, which a valid accent never causes. */
const DEFAULT_FIELD = '#15110D'

// A working-copy image is an address, not a stored asset, so its size is not
// known. The page boxes the photo with CSS, so these only give the aspect.
const WORKING_COPY_HERO_SIZE = { width: 1600, height: 1000 } as const
const WORKING_COPY_LOGO_SIZE = { width: 480, height: 120 } as const

type PreviewProfile = Readonly<{
  displayName: string
  wordmark: string | null
  logoUrl: string | null
  defaultHeroImageUrl: string | null
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
function brandOf(
  input: DraftPortalPreviewInput,
  primary: GuestLocale,
): PublicImmersiveExperience['brand'] {
  const { profile, portal, overrides } = input
  const accentColour = profile?.primaryColor ?? DEFAULT_ACCENT
  const fieldColour =
    profile?.backgroundMode === 'manual'
      ? profile.backgroundColor
      : (deriveFieldColour(accentColour) ?? DEFAULT_FIELD)
  const heroUrl = firstWritten(
    overrides.find((override) => override.locale === primary)?.heroImageUrl,
    profile?.defaultHeroImageUrl,
  )
  const logoUrl = firstWritten(profile?.logoUrl)
  return {
    displayName: firstWritten(profile?.displayName) ?? portal.name,
    wordmark: firstWritten(profile?.wordmark) ?? null,
    logo: logoUrl ? { url: logoUrl, ...WORKING_COPY_LOGO_SIZE } : null,
    hero: heroUrl
      ? { url: heroUrl, ...WORKING_COPY_HERO_SIZE, focalX: 0.5, focalY: 0.5 }
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
  const wording =
    (
      pick: (row: PreviewContent) => string | null,
      pickOverride: (row: PreviewOverride) => string | null,
    ) =>
    (code: GuestLocale) => {
      const row = contentIn(code)
      if (!row) return undefined
      const override = overrideIn(code)
      return firstWritten(override && pickOverride(override), pick(row))
    }
  const heroAltIn = (code: GuestLocale) => firstWritten(contentIn(code)?.heroAltText)
  const hasHeroAlt = heroAltIn(primary) !== undefined
  // The Linktree view already carries the titles a manager wrote.
  const customTitle = firstWritten(input.linktree.titles[locale])
  return {
    title: textIn(
      locale,
      primary,
      wording(
        (row) => row.title,
        (row) => row.title,
      ),
      portal.name,
    ),
    shortDescription: textIn(
      locale,
      primary,
      wording(
        (row) => row.shortDescription,
        (row) => row.shortDescription,
      ),
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
    const own_ = textFor(locale)
    const copied = own_ === undefined && locale !== primary ? textFor(primary) : undefined
    const used = own_ ?? copied
    return {
      id: link.id,
      state: link.destination.state === 'approved' ? 'ready' : 'awaiting_approval',
      iconKey: link.iconKey,
      // Tile photos need uploads, which are not live yet.
      imageUrl: null,
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
  const brand = brandOf(input, primary)
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
}>

/**
 * The version guests can open now, drawn from the verified snapshot the way the
 * public edge serves it: only addresses still approved, none when the Linktree
 * is off, and media only from what may be served (nothing yet).
 */
export function buildLivePortalPreview({
  snapshot,
  approvedUris,
}: LivePortalPreviewInput): PortalPreviewOutcome {
  const configuration = snapshot.configuration
  if (configuration.schemaVersion !== IMMERSIVE_HUB_SCHEMA_VERSION) {
    return { status: 'unavailable', source: 'live', reason: 'earlier_design' }
  }
  const published = configuration.linktree.enabled
    ? configuration.links.filter((link) => approvedUris.has(link.url))
    : []
  const entries = configuration.localeSet.map((locale) => {
    const presented = presentImmersivePortal(configuration, locale, published, {})
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
