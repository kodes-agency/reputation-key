import { matchGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'

/** English: the language a page falls back to when nothing the guest prefers has a pack. */
const FALLBACK_GUEST_LOCALE: GuestLocale = 'en'

/** The tags of an `Accept-Language` header, best first; `q=0` entries are dropped and equal weights keep the header's order. */
function rankedTags(header: string): string[] {
  const ranked = header.split(',').flatMap((part, position) => {
    const [tag = '', ...parameters] = part.split(';').map((piece) => piece.trim())
    const weight = parameters.find((piece) => /^q=/iu.test(piece))
    const quality = weight === undefined ? 1 : Number(weight.slice(2))
    return tag !== '' && Number.isFinite(quality) && quality > 0
      ? [{ tag, quality, position }]
      : []
  })
  ranked.sort((a, b) => b.quality - a.quality || a.position - b.position)
  return ranked.map((entry) => entry.tag)
}

/**
 * The guest language a visitor's own browser asks for: the first language of
 * their `Accept-Language` header (or of `navigator.languages`, already in order)
 * that the guest surface can write, else English.
 *
 * It is for the page that has no portal to take a language from, the
 * unavailable page. The browser's preference says nothing about the portal, so
 * reading it tells a guest nothing about why the page is not there.
 */
export function preferredGuestLocale(
  languages: string | readonly string[] | null | undefined,
): GuestLocale {
  const tags = typeof languages === 'string' ? rankedTags(languages) : (languages ?? [])
  for (const tag of tags) {
    const locale = matchGuestLocale(tag)
    if (locale) return locale
  }
  return FALLBACK_GUEST_LOCALE
}
