// Which web fonts a page loads.
//
// The app (staff and marketing pages, login, /privacy, invites) is set in
// Satoshi, Plus Jakarta Sans and JetBrains Mono from two third-party
// stylesheets. The Immersive Hub guest page is set in Cormorant Garamond and
// Ysabeau Office, served from our own origin (`public/fonts/guest/`), so a
// guest's phone makes no request to a font CDN. A route declares the set it
// wants through its loader data (`fontSet`); the root document turns the set
// into `<link>` tags. Both sets used to be `@import`ed by `styles.css`, which
// made every page pay for the fonts of every other.
//
// Pure on purpose: no I/O, no framework import, so it is testable in node.

import {
  GUEST_LANGUAGE_PACKS,
  GUEST_LOCALE_METADATA,
  guestLanguagePackGeneration,
  type GuestLocale,
} from '#/shared/domain/guest-locale'

export type FontSet = 'app' | 'guest'

/** Exactly what `styles.css` used to `@import`, in the same order. */
export const APP_FONT_STYLESHEETS = Object.freeze([
  'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
] as const)

/** The guest `@font-face` rules, size-adjusted fallbacks and font tokens. */
export const GUEST_FONT_STYLESHEET = '/fonts/guest/guest-fonts.css'

const GUEST_FONT_DIRECTORY = '/fonts/guest/'

/** The above-the-fold pair per script: the display face and the body face. */
const GUEST_PRELOAD_FILES: Readonly<Record<'Latn' | 'Cyrl', readonly string[]>> =
  Object.freeze({
    Latn: [
      'cormorant-garamond-latin-600-normal.woff2',
      'ysabeau-office-latin-400-normal.woff2',
    ],
    Cyrl: [
      'cormorant-garamond-cyrillic-600-normal.woff2',
      'ysabeau-office-cyrillic-400-normal.woff2',
    ],
  })

export type FontLink = Readonly<{
  rel: 'stylesheet' | 'preload'
  href: string
  as?: 'font'
  type?: 'font/woff2'
  /** Font preloads are CORS requests, even from the same origin. */
  crossOrigin?: 'anonymous'
}>

function isFontSet(value: unknown): value is FontSet {
  return value === 'app' || value === 'guest'
}

function declaredFontSet(loaderData: unknown): FontSet | null {
  if (typeof loaderData !== 'object' || loaderData === null) return null
  const declared: unknown = Reflect.get(loaderData, 'fontSet')
  return isFontSet(declared) ? declared : null
}

/**
 * The set a page asked for: the guest set when any match's loader declares it,
 * otherwise the app set. Only `/p/$token` declares one today.
 */
export function fontSetOfMatches(
  matches: readonly Readonly<{ loaderData?: unknown }>[],
): FontSet {
  return matches.some((match) => declaredFontSet(match.loaderData) === 'guest')
    ? 'guest'
    : 'app'
}

/**
 * The set a published portal is rendered with. Generation 2 language packs
 * belong to the Immersive Hub; every pack shipped today is generation 1, so
 * this answers 'app' for all existing guests. The publication verifier ties
 * pack generation to snapshot schema, which is why the pack id is enough to
 * tell a v3 snapshot from a v1/v2 one.
 */
export function guestFontSetForPack(
  languagePackVersion: string,
  packs: Parameters<typeof guestLanguagePackGeneration>[1] = GUEST_LANGUAGE_PACKS,
): FontSet {
  return guestLanguagePackGeneration(languagePackVersion, packs) === 2 ? 'guest' : 'app'
}

/** The `<link>` tags a set needs in the document head. */
export function fontSetLinks(set: FontSet, locale: GuestLocale): readonly FontLink[] {
  if (set === 'app') {
    return APP_FONT_STYLESHEETS.map((href) => ({ rel: 'stylesheet', href }))
  }
  const script = GUEST_LOCALE_METADATA[locale].script
  return [
    { rel: 'stylesheet', href: GUEST_FONT_STYLESHEET },
    ...GUEST_PRELOAD_FILES[script].map((file): FontLink => ({
      rel: 'preload',
      as: 'font',
      type: 'font/woff2',
      crossOrigin: 'anonymous',
      href: `${GUEST_FONT_DIRECTORY}${file}`,
    })),
  ]
}
