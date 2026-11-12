// The pictures the print kit's stories draw (design spec boards):
// stand-ins drawn here, never a hotel's. A blue badge logo like Harborline's, a
// dark tree logo like Oakmere's (it sits on the cream plate), and a lit interior
// with a pale bed where the words go and a dark floor.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'

const RATE_COPY: Readonly<
  Record<GuestLocale, Readonly<{ headline: string; subline: string }>>
> = {
  en: { headline: 'Rate your visit', subline: 'Private, about 30 seconds' },
  bg: { headline: 'Оценете посещението си', subline: 'Поверително, около 30 секунди' },
  es: { headline: 'Valore su visita', subline: 'En privado, unos 30 segundos' },
  it: { headline: 'Valuti la sua visita', subline: 'In privato, circa 30 secondi' },
  fr: { headline: 'Évaluez votre visite', subline: 'En privé, environ 30 secondes' },
  de: { headline: 'Bewerten Sie Ihren Besuch', subline: 'Privat, etwa 30 Sekunden' },
}

/** The words a front face carries in each language: a kicker over the "rate" headline and subline. */
export const storyFrontBlocks = (
  languages: readonly GuestLocale[],
  titles: Readonly<Partial<Record<GuestLocale, string>>>,
  fallbackTitle: string,
): readonly PrintTextBlock[] =>
  languages.map((locale) => ({
    locale,
    kicker: titles[locale] ?? fallbackTitle,
    ...RATE_COPY[locale],
  }))

/** Points as CSS pixels, 96 to the inch: 144 pt is the 192 px that 2 in measures on a screen. */
export const pointsToPixels = (points: number): string =>
  `${Number(((points * 96) / 72).toFixed(4))}px`

/** A blue badge logo, like the board's Harborline. */
export const BADGE_LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200"><path d="M40 10h280l36 90-36 90H40L4 100z" fill="#1D4FC4" stroke="#0B2E8A" stroke-width="6"/><text x="180" y="118" font-family="Georgia" font-style="italic" font-size="64" text-anchor="middle" fill="#fff">Harbor</text></svg>',
  )

/** A dark tree logo, like the board's Oakmere: it sits on the cream plate. */
export const DARK_LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200" viewBox="0 0 240 200"><circle cx="120" cy="70" r="52" fill="#16224A"/><rect x="112" y="110" width="16" height="40" fill="#16224A"/><text x="120" y="188" font-family="Georgia" font-size="34" text-anchor="middle" fill="#16224A">OAKMERE</text></svg>',
  )

/** A lit interior: a patterned wall, a pale bed where the words go, a dark floor. */
export const PHOTO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1620" height="1080"><defs><pattern id="d" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="#8E3A24"/><circle cx="30" cy="30" r="14" fill="#C9763E"/></pattern><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b5446"/><stop offset="1" stop-color="#2a1d16"/></linearGradient></defs><rect width="1620" height="560" fill="url(#d)"/><rect y="560" width="1620" height="520" fill="url(#f)"/><rect x="260" y="470" width="1100" height="360" fill="#E9E2DA"/><rect x="300" y="430" width="1020" height="70" fill="#3A2A1E"/></svg>',
  )
