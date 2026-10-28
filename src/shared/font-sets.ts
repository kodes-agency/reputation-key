// Which web fonts a page loads.
//
// The app (staff and marketing pages, login, /privacy, invites) is set in
// Satoshi, Plus Jakarta Sans and JetBrains Mono. Plus Jakarta Sans and
// JetBrains Mono are SIL OFL, so they are served from our own origin
// (`public/fonts/app/`) in unicode-range subsets. Satoshi is not: its Free Font
// License allows web use but forbids distributing or uploading the files, and
// this repository is public, so it stays on Fontshare (`api.fontshare.com` for
// the stylesheet, `cdn.fontshare.com` for the file) and the head preconnects to
// both. Every web font has a size-adjusted local fallback face in
// `app-fonts.css`, so the swap does not move text. The Immersive Hub guest page
// is set in Cormorant Garamond and Ysabeau Office, also from our own origin
// (`public/fonts/guest/`), so a guest's phone makes no request to a font CDN. A
// route declares the set it wants through its loader data (`fontSet`); the root
// document turns the set into `<link>` tags. Both sets used to be `@import`ed by
// `styles.css`, which made every page pay for the fonts of every other.
//
// The unavailable page is a `/p/$token` match with no loader data, and gets the
// guest set from the choice below. An admin live preview of the guest look is
// not that route: it links `GUEST_FONT_STYLESHEET` itself, as the Storybook
// stories do. The choice is one set per document because `/p/$token` is the only
// route that makes it.
//
// Pure on purpose: no I/O, no framework import, so it is testable in node.

import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'

export type FontSet = 'app' | 'guest'

/**
 * The app stylesheets. Satoshi is the one app face we may not host, and Fontshare
 * serves it at 400, 500 and 700. `app-fonts.css` holds the self-hosted Plus
 * Jakarta Sans and JetBrains Mono `@font-face` rules and the size-adjusted
 * fallback faces of all three families. It sits outside the Vite pipeline, like
 * the guest stylesheet, so the bundle budget does not count it.
 */
export const APP_FONT_STYLESHEETS = Object.freeze([
  'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap',
  '/fonts/app/app-fonts.css',
] as const)

/** Origins the app set opens early: the Satoshi stylesheet, then its font files. */
const APP_FONT_PRECONNECTS = Object.freeze([
  { href: 'https://api.fontshare.com' },
  { href: 'https://cdn.fontshare.com', crossOrigin: 'anonymous' },
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
  rel: 'stylesheet' | 'preload' | 'preconnect'
  href: string
  as?: 'font'
  type?: 'font/woff2'
  /** Font preloads, and the preconnect to the origin that serves fonts, are CORS requests. */
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

/** The guest Portal route. Its matches choose the font set even without loader data. */
const GUEST_PORTAL_ROUTE_ID = '/p/$token'

/**
 * The set a page asked for: the guest set when any match's loader declares it,
 * otherwise the app set. Only `/p/$token` declares one today. A `/p/$token`
 * match with no loader data at all is the unavailable page (bad token,
 * unpublished or suspended Portal, an error): it is set in the guest face, so
 * it takes the guest set rather than the app fonts of a third-party CDN.
 */
export function fontSetOfMatches(
  matches: readonly Readonly<{ routeId?: string; loaderData?: unknown }>[],
): FontSet {
  return matches.some((match) => {
    const declared = declaredFontSet(match.loaderData)
    return (
      (match.routeId === GUEST_PORTAL_ROUTE_ID ? (declared ?? 'guest') : declared) ===
      'guest'
    )
  })
    ? 'guest'
    : 'app'
}

/**
 * The set a guest surface is rendered with. The surface comes from the
 * snapshot's schema version, the same fact the renderer switches on, so the
 * fonts and the page cannot disagree: the legacy page keeps the app fonts, the
 * Immersive Hub gets the guest set. Every published snapshot is legacy today.
 */
export function fontSetForGuestSurface(surface: 'legacy' | 'immersive'): FontSet {
  return surface === 'immersive' ? 'guest' : 'app'
}

/** The `<link>` tags a set needs in the document head. */
export function fontSetLinks(set: FontSet, locale: GuestLocale): readonly FontLink[] {
  if (set === 'app') {
    return [
      ...APP_FONT_PRECONNECTS.map((origin): FontLink => ({
        rel: 'preconnect',
        ...origin,
      })),
      ...APP_FONT_STYLESHEETS.map((href): FontLink => ({ rel: 'stylesheet', href })),
    ]
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
