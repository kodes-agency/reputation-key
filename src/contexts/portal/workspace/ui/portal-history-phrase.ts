// A sentence the History tab draws, as data: a list of pieces that are plain,
// strong (the thing that was done to), or in a language of their own. The view
// turns pieces into elements and sets `lang` on the foreign ones, so a screen
// reader reads ‘Piscina y terraza’ in Spanish; tests read `phraseText`.

import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'

export type PhrasePiece = Readonly<{
  text: string
  strong?: boolean
  /** The language of a piece of the guests' wording; omitted for admin copy. */
  lang?: GuestLocale
}>
export type Phrase = ReadonlyArray<PhrasePiece>

export const plain = (text: string): PhrasePiece => ({ text })
export const strong = (text: string, lang?: GuestLocale): PhrasePiece =>
  lang === undefined ? { text, strong: true } : { text, strong: true, lang }
/** Wording from the guests' page, in typographic quotes, in its own language when known. */
export const quoted = (text: string, lang?: GuestLocale): PhrasePiece =>
  lang === undefined ? { text: `‘${text}’` } : { text: `‘${text}’`, lang }
/** A language by its own name (Deutsch), tagged so it is read in that language. */
export const nativeLanguage = (locale: GuestLocale): PhrasePiece => ({
  text: GUEST_LOCALE_METADATA[locale].nativeName,
  lang: locale,
})
export const englishLanguage = (locale: GuestLocale): string =>
  GUEST_LOCALE_METADATA[locale].englishName

export const phraseText = (phrase: Phrase): string =>
  phrase.map((piece) => piece.text).join('')

/** "a", "a and b", "a, b and c": the pieces joined the way a person would say them. */
export function joinPhrases(items: ReadonlyArray<Phrase>): Phrase {
  return items.flatMap((item, index): Phrase => {
    if (index === 0) return item
    const separator = index === items.length - 1 ? ' and ' : ', '
    return [plain(separator), ...item]
  })
}
