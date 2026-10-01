// Portal context — what Publish reads, and what it makes of it.
//
// A publication source is the Portal's working copy in the terms the guest page
// needs: the languages, the wording each language was given, the look, and the
// links in guest order. `resolvePortalPublication` turns it into the content of
// a schema version 3 (Immersive Hub) snapshot, filling each gap the one way the
// design allows, and says what stops a publication and what only deserves a
// note:
//
//  - A gap in the primary language blocks publishing: there is nothing honest
//    to copy.
//  - A gap in another language is filled by copying the primary language's text
//    and tagging it `fallbackFrom`, so the page can set `lang` truthfully. That
//    is a warning, not a blocker.
//  - The Linktree title is never copied: a language with none reads its pack's
//    default, which is a decision about wording the design already made.
//
// Pure. The reader (infrastructure/portal-working-copy.reader.ts) builds the
// source, the builder (application/portal-publication-snapshot.ts) turns the
// content into a snapshot, and the working-copy comparison resolves a source
// the same way to see whether it still says what a snapshot says. One function
// answers all three, so they cannot disagree about what a publication is.

import { deriveFieldColour } from '#/shared/domain/portal-field-colour'
import { currentGuestLanguagePack, type GuestLocale } from '#/shared/domain/guest-locale'
import { isValidTimeZone } from './portal-immersive-snapshot'
import { linktreeDefaultTitle } from './portal-linktree'
import type {
  ImmersiveBrandProfile,
  ImmersiveLink,
  ImmersiveLinkText,
  ImmersiveLocalizedContent,
  ImmersivePortalPublicationConfiguration,
  PortalSnapshotText,
} from './portal-publication-snapshot'

/** The accent of a Property that has no Brand Profile yet: champagne. */
export const DEFAULT_PORTAL_ACCENT = '#EAD6A8'
/** Used only if the derived field cannot be computed, which a valid accent never causes. */
export const DEFAULT_PORTAL_FIELD = '#15110D'

/** A stored image the page may use: its asset and its stored size. */
export type PublicationMedia = Readonly<{
  assetId: string
  width: number
  height: number
}>

export type PublicationLook = Readonly<{
  displayName: string
  wordmark: string | null
  accentColour: string
  /** The field when `backgroundMode` is manual; otherwise the accent decides. */
  backgroundColour: string
  backgroundMode: 'auto' | 'manual'
  /** Moves with everything a guest sees of the look. */
  lookVersion: number
  logo: PublicationMedia | null
  hero: (PublicationMedia & Readonly<{ focalX: number; focalY: number }>) | null
}>

/** What was written in one language; null is a text nobody wrote. */
export type PublicationWording = Readonly<{
  title: string | null
  shortDescription: string | null
  heroAlt: string | null
  linktreeTitle: string | null
}>

export type PublicationLinkText = Readonly<{
  label: string
  line: string | null
  /** `ai_draft` when the text began as an AI draft; null for a manager's own words. */
  provenance: 'ai_draft' | null
}>

export type PublicationLink = Readonly<{
  id: string
  /** The approved address the tile opens. Links without one are not in the source. */
  url: string
  iconKey: string | null
  /** The tile's picture, only while it may still be served. */
  imageAssetId: string | null
  texts: Readonly<Partial<Record<GuestLocale, PublicationLinkText>>>
}>

export type PortalPublicationSource = Readonly<{
  organizationId: string
  propertyId: string
  portal: Readonly<{ id: string; name: string; slug: string }>
  privateFeedbackThreshold: number
  primaryGuestLocale: GuestLocale
  /** The primary first, then the additional languages. */
  localeSet: readonly GuestLocale[]
  linktreeEnabled: boolean
  /** The Property's IANA time zone; null when it has none the page can use. */
  timeZone: string | null
  /** The Property's look; null while it has no Brand Profile. */
  look: PublicationLook | null
  wording: Readonly<Partial<Record<GuestLocale, PublicationWording>>>
  /** Approved links only, in the order the page shows them. */
  links: readonly PublicationLink[]
}>

/** The text a publication reads for a key that blocks or warns. */
export type PublicationTextKey =
  'title' | 'shortDescription' | 'heroAlt' | `link:${string}`

export type PublicationBlocker =
  | Readonly<{
      code: 'primary_text_missing'
      locale: GuestLocale
      key: PublicationTextKey
    }>
  | Readonly<{ code: 'language_pack_missing'; locale: GuestLocale }>
  | Readonly<{ code: 'time_zone_invalid' }>

export type PublicationWarning = Readonly<{
  code: 'text_copied_from_primary'
  locale: GuestLocale
  key: PublicationTextKey
}>

/** The part of a v3 configuration that comes from the working copy. */
export type ImmersivePublicationContent = Pick<
  ImmersivePortalPublicationConfiguration,
  | 'portal'
  | 'guestLocale'
  | 'languagePackVersion'
  | 'localeSet'
  | 'languagePackVersions'
  | 'localizedContent'
  | 'linktree'
  | 'links'
  | 'brandProfile'
  | 'timeZone'
  | 'provenance'
>

export type PortalPublicationResolution = Readonly<{
  blockers: readonly PublicationBlocker[]
  warnings: readonly PublicationWarning[]
  /** Best effort while there are blockers; complete when there are none. */
  content: ImmersivePublicationContent
}>

const isWritten = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0

const own = (value: string): PortalSnapshotText => ({ value, fallbackFrom: null })

type Findings = {
  blockers: PublicationBlocker[]
  warnings: PublicationWarning[]
}

/**
 * A text in `locale`: its own wording when written, else the primary language's
 * copied in and tagged. Null only when the primary language has none either.
 */
function textIn(
  source: PortalPublicationSource,
  locale: GuestLocale,
  key: 'title' | 'shortDescription' | 'heroAlt',
  findings: Findings,
): PortalSnapshotText | null {
  const primary = source.primaryGuestLocale
  const written = source.wording[locale]?.[key]
  if (isWritten(written)) return own(written)
  const primaryText = source.wording[primary]?.[key]
  if (locale === primary || !isWritten(primaryText)) return null
  findings.warnings.push({ code: 'text_copied_from_primary', locale, key })
  return { value: primaryText, fallbackFrom: primary }
}

function localizedContentOf(
  source: PortalPublicationSource,
  locale: GuestLocale,
  hasHero: boolean,
  findings: Findings,
): ImmersiveLocalizedContent {
  const primary = source.primaryGuestLocale
  const title = textIn(source, locale, 'title', findings)
  const shortDescription = textIn(source, locale, 'shortDescription', findings)
  // An empty photo description marks the photo decorative; it is never
  // "missing". It is also empty when there is no photo to describe.
  const primaryHasAlt = hasHero && isWritten(source.wording[primary]?.heroAlt)
  const heroAlt = primaryHasAlt ? textIn(source, locale, 'heroAlt', findings) : null
  if (locale === primary) {
    if (!title) {
      findings.blockers.push({ code: 'primary_text_missing', locale, key: 'title' })
    }
    if (!shortDescription) {
      findings.blockers.push({
        code: 'primary_text_missing',
        locale,
        key: 'shortDescription',
      })
    }
  }
  const customTitle = source.wording[locale]?.linktreeTitle
  return {
    title: title ?? own(''),
    shortDescription: shortDescription ?? own(''),
    heroAlt: heroAlt ?? own(''),
    linktreeTitle: own(
      isWritten(customTitle) ? customTitle : linktreeDefaultTitle(locale),
    ),
  }
}

/** One locale's wording of a link, written or copied from the primary as a unit. */
function linkTextIn(
  link: PublicationLink,
  locale: GuestLocale,
  primary: GuestLocale,
  findings: Findings,
): ImmersiveLinkText {
  const written = link.texts[locale]
  if (written && isWritten(written.label)) {
    return { label: written.label, line: written.line, fallbackFrom: null }
  }
  const copied = locale === primary ? undefined : link.texts[primary]
  if (copied && isWritten(copied.label)) {
    findings.warnings.push({
      code: 'text_copied_from_primary',
      locale,
      key: `link:${link.id}`,
    })
    return { label: copied.label, line: copied.line, fallbackFrom: primary }
  }
  if (locale === primary) {
    findings.blockers.push({
      code: 'primary_text_missing',
      locale,
      key: `link:${link.id}`,
    })
  }
  return { label: '', line: null, fallbackFrom: null }
}

function linksOf(
  source: PortalPublicationSource,
  findings: Findings,
): readonly ImmersiveLink[] {
  return source.links.map((link) => ({
    id: link.id,
    url: link.url,
    iconKey: link.iconKey,
    imageAssetId: link.imageAssetId,
    texts: Object.fromEntries(
      source.localeSet.map((locale) => [
        locale,
        linkTextIn(link, locale, source.primaryGuestLocale, findings),
      ]),
    ),
  }))
}

function brandProfileOf(source: PortalPublicationSource): ImmersiveBrandProfile {
  const { look } = source
  if (!look) {
    return {
      displayName: source.portal.name,
      wordmark: null,
      logo: null,
      hero: null,
      accentColour: DEFAULT_PORTAL_ACCENT,
      fieldColour: deriveFieldColour(DEFAULT_PORTAL_ACCENT) ?? DEFAULT_PORTAL_FIELD,
      lookVersion: 1,
    }
  }
  return {
    displayName: look.displayName,
    wordmark: look.wordmark,
    logo: look.logo,
    hero: look.hero,
    accentColour: look.accentColour,
    fieldColour:
      look.backgroundMode === 'manual'
        ? look.backgroundColour
        : (deriveFieldColour(look.accentColour) ?? DEFAULT_PORTAL_FIELD),
    lookVersion: look.lookVersion,
  }
}

function languagePacksOf(
  source: PortalPublicationSource,
  findings: Findings,
): Partial<Record<GuestLocale, string>> {
  const packs: Partial<Record<GuestLocale, string>> = {}
  for (const locale of source.localeSet) {
    const pack = currentGuestLanguagePack(locale, 2)
    if (pack === null) findings.blockers.push({ code: 'language_pack_missing', locale })
    else packs[locale] = pack
  }
  return packs
}

/** The link texts that began as AI drafts, in link then language order. */
function aiDraftKeysOf(source: PortalPublicationSource): readonly string[] {
  return source.links.flatMap((link) =>
    source.localeSet.flatMap((locale) =>
      link.texts[locale]?.provenance === 'ai_draft'
        ? [`link:${link.id}:text:${locale}`]
        : [],
    ),
  )
}

/**
 * What publishing `source` would write, and what stands in the way. The same
 * source always gives the same answer, in the same key order, so the content is
 * safe to digest and to compare.
 */
export function resolvePortalPublication(
  source: PortalPublicationSource,
): PortalPublicationResolution {
  const findings: Findings = { blockers: [], warnings: [] }
  const primary = source.primaryGuestLocale
  const brandProfile = brandProfileOf(source)
  const languagePackVersions = languagePacksOf(source, findings)
  const localizedContent = Object.fromEntries(
    source.localeSet.map((locale) => [
      locale,
      localizedContentOf(source, locale, brandProfile.hero !== null, findings),
    ]),
  )
  const links = linksOf(source, findings)
  const timeZone = source.timeZone ?? ''
  if (!isValidTimeZone(timeZone)) findings.blockers.push({ code: 'time_zone_invalid' })
  const aiDraftTextKeys = aiDraftKeysOf(source)
  return {
    blockers: findings.blockers,
    warnings: findings.warnings,
    content: {
      portal: { id: source.portal.id, slug: source.portal.slug },
      guestLocale: primary,
      languagePackVersion: languagePackVersions[primary] ?? '',
      localeSet: source.localeSet,
      languagePackVersions,
      localizedContent,
      linktree: { enabled: source.linktreeEnabled },
      links,
      brandProfile,
      timeZone,
      ...(aiDraftTextKeys.length > 0 ? { provenance: { aiDraftTextKeys } } : {}),
    },
  }
}
