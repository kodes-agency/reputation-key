// The wording a Portal saved for its print kit (2026-10-27): the call to
// action and the manager's own words that Share opens on, kept per Portal until
// the manager saves another. Pure and shared, like the kit's other vocabulary:
// Share decides what to open on and whether the words on show are saved, the
// server stores exactly what `printWordingToSave` says and refuses what
// `printWordingSaveProblem` refuses.

import { PRINT_DEFAULT_CALL_TO_ACTION, type PrintCallToAction } from './portal-print-copy'
import {
  printCustomCopyProblem,
  printOwnWordsToSend,
  type PrintCustomWords,
  type PrintWordsChoice,
} from './portal-print-custom'
import type { GuestLocale } from './guest-locale'
import { printWordsOffer } from './portal-print-warnings'

/**
 * A wording as it is saved: the wording picked, or the one the manager's own
 * words started from, and the own words per language where they wrote them (null
 * when the wording's copy is what prints).
 */
export type PrintSavedWording = Readonly<{
  callToAction: PrintCallToAction
  customWords: PrintCustomWords | null
}>

/** What Share opens on with nothing saved and nothing printed. */
export const PRINT_DEFAULT_WORDING: PrintSavedWording = Object.freeze({
  callToAction: PRINT_DEFAULT_CALL_TO_ACTION,
  customWords: null,
})

/**
 * The wording Share opens on: the saved one; else the wording of the Portal's
 * last print (which a Portal printed before saving was ever offered still has);
 * else the default.
 */
export function printOpeningWording(
  saved: PrintSavedWording | null,
  last: PrintSavedWording | null,
): PrintSavedWording {
  return saved ?? last ?? PRINT_DEFAULT_WORDING
}

/** A wording's own words as a field-by-field list: a stored object's key order is not the order a print made it in. */
function ownWordsKey(words: PrintCustomWords | null): string {
  const entries = Object.entries(words ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, copy]) => [locale, copy?.headline, copy?.subline])
  return JSON.stringify(entries)
}

/** Two own-words sets are the same: the same languages, each with the same headline and sub-line. */
export const printSameOwnWords = (
  left: PrintCustomWords | null,
  right: PrintCustomWords | null,
): boolean => ownWordsKey(left) === ownWordsKey(right)

/**
 * The wording a save stores for these words: the picked wording, and the own
 * words normalised for each of `languages` where they differ from the wording's
 * copy; null when none does (fields left as prefilled are the wording).
 */
export function printWordingToSave(
  words: PrintWordsChoice,
  languages: readonly GuestLocale[],
): PrintSavedWording {
  return {
    callToAction: words.preset,
    customWords: printOwnWordsToSend(words, languages),
  }
}

/** The saved wording as the print would say it in `languages`, to compare with the words on show. */
const sayingOf = (saved: PrintSavedWording, languages: readonly GuestLocale[]) =>
  printWordingToSave({ preset: saved.callToAction, custom: saved.customWords }, languages)

/**
 * Whether the words on show are the saved ones: the same wording and, for the
 * languages of the print, the same own words once normalised. A saved language the
 * print does not carry is not compared.
 */
export function printWordingIsSaved(
  words: PrintWordsChoice,
  languages: readonly GuestLocale[],
  saved: PrintSavedWording,
): boolean {
  const showing = printWordingToSave(words, languages)
  const keeping = sayingOf(saved, languages)
  return (
    showing.callToAction === keeping.callToAction &&
    printSameOwnWords(showing.customWords, keeping.customWords)
  )
}

/** Why words cannot be saved: a language with no headline, or an offer for the review (§5.8). Fit is the download's to judge, not the save's. */
export type PrintWordingSaveProblem = 'empty_headline' | 'offer'

export function printWordingSaveProblem(
  words: PrintWordsChoice,
  languages: readonly GuestLocale[],
): PrintWordingSaveProblem | null {
  const emptyHeadline = languages.some((locale) => {
    const copy = words.custom?.[locale]
    return copy !== undefined && printCustomCopyProblem(copy) === 'empty_headline'
  })
  if (emptyHeadline) return 'empty_headline'
  return printWordsOffer(words, languages) ? 'offer' : null
}
