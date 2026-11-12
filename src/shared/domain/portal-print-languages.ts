// The words a print carries, as Share offers them (design spec §11.5):
// the languages as a select of ordered pairs, at most two, the first printing
// larger, and the call to action as a select whose options read as the print
// does. Each language is named in its own words, as the guest page names it.

import { GUEST_LOCALE_METADATA, type GuestLocale } from './guest-locale'
import type { PrintTextBlock } from './portal-print-kit'
import {
  PRINT_CALLS_TO_ACTION,
  PRINT_COPY,
  type PrintCallToAction,
} from './portal-print-copy'
import { printCopyOf, type PrintWordsChoice } from './portal-print-custom'

/**
 * Every choice of languages a portal's languages make: each language with each
 * other one after it (both orders, the first larger), then that language alone.
 * The portal's primary comes first, so the first choice is the primary and the
 * next language ("English, then Español").
 */
export function printLanguageChoices(
  locales: readonly GuestLocale[],
): readonly (readonly GuestLocale[])[] {
  return locales.flatMap((first) => [
    ...locales
      .filter((second) => second !== first)
      .map((second): readonly GuestLocale[] => [first, second]),
    [first],
  ])
}

/** "English, then Español", or "English" alone. */
export function printLanguageChoiceLabel(languages: readonly GuestLocale[]): string {
  return languages
    .map((locale) => GUEST_LOCALE_METADATA[locale].nativeName)
    .join(', then ')
}

/** A choice's value in a select: "en+es". */
export const printLanguageValue = (languages: readonly GuestLocale[]): string =>
  languages.join('+')

/** Each call to action as the print says it in English: "How did we do? · About 30 seconds". */
export const PRINT_CALL_TO_ACTION_LABELS: Readonly<Record<PrintCallToAction, string>> =
  Object.freeze(
    Object.fromEntries(
      PRINT_CALLS_TO_ACTION.map((callToAction) => {
        const { headline, subline } = PRINT_COPY.en[callToAction]
        return [callToAction, `${headline} · ${subline}`]
      }),
    ) as Record<PrintCallToAction, string>,
  )

/**
 * What a face says, language by language, the first leading: the page's
 * title in that language as the kicker (the portal's name where it has none),
 * then the call to action: the manager's own words in that language where they
 * wrote them, else the wording's copy. A tent prints these on both faces.
 */
export function printBlocks(
  languages: readonly GuestLocale[],
  words: PrintWordsChoice,
  titles: Readonly<Partial<Record<GuestLocale, string>>>,
  fallbackTitle: string,
): readonly PrintTextBlock[] {
  return languages.map((locale) => ({
    locale,
    kicker: titles[locale] ?? fallbackTitle,
    ...printCopyOf(words, locale),
  }))
}
