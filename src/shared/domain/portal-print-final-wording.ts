// The wording a Portal saved for its final print kit (2026-10-27): the call to
// action and the manager's own words that Share opens on, kept per Portal until
// the manager saves another. Pure and shared, like the kit's other vocabulary:
// Share decides what to open on and whether the words on show are saved, the
// server stores exactly what `printFinalWordingToSave` says and refuses what
// `printFinalWordingSaveProblem` refuses.

import {
  PRINT_FINAL_DEFAULT_CALL_TO_ACTION,
  type PrintFinalCallToAction,
} from './portal-print-final-copy'
import {
  printFinalCustomCopyProblem,
  printFinalOwnWordsToSend,
  type PrintFinalCustomWords,
  type PrintFinalWordsChoice,
} from './portal-print-final-custom'
import type { GuestLocale } from './guest-locale'
import { printFinalWordsOffer } from './portal-print-final-warnings'

/**
 * A wording as it is saved: the wording picked, or the one the manager's own
 * words started from, and the own words per language where they wrote them (null
 * when the wording's copy is what prints).
 */
export type PrintFinalSavedWording = Readonly<{
  callToAction: PrintFinalCallToAction
  customWords: PrintFinalCustomWords | null
}>

/** What Share opens on with nothing saved and nothing printed. */
export const PRINT_FINAL_DEFAULT_WORDING: PrintFinalSavedWording = Object.freeze({
  callToAction: PRINT_FINAL_DEFAULT_CALL_TO_ACTION,
  customWords: null,
})

/**
 * The wording Share opens on: the saved one; else the wording of the Portal's
 * last print (which a Portal printed before saving was ever offered still has);
 * else the default.
 */
export function printFinalOpeningWording(
  saved: PrintFinalSavedWording | null,
  last: PrintFinalSavedWording | null,
): PrintFinalSavedWording {
  return saved ?? last ?? PRINT_FINAL_DEFAULT_WORDING
}

/** A wording's own words as a field-by-field list: a stored object's key order is not the order a print made it in. */
function ownWordsKey(words: PrintFinalCustomWords | null): string {
  const entries = Object.entries(words ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, copy]) => [locale, copy?.headline, copy?.subline])
  return JSON.stringify(entries)
}

/** Two own-words sets are the same: the same languages, each with the same headline and sub-line. */
export const printFinalSameOwnWords = (
  left: PrintFinalCustomWords | null,
  right: PrintFinalCustomWords | null,
): boolean => ownWordsKey(left) === ownWordsKey(right)

/**
 * The wording a save stores for these words: the picked wording, and the own
 * words normalised for each of `languages` where they differ from the wording's
 * copy; null when none does (fields left as prefilled are the wording).
 */
export function printFinalWordingToSave(
  words: PrintFinalWordsChoice,
  languages: readonly GuestLocale[],
): PrintFinalSavedWording {
  return {
    callToAction: words.preset,
    customWords: printFinalOwnWordsToSend(words, languages),
  }
}

/** The saved wording as the print would say it in `languages`, to compare with the words on show. */
const sayingOf = (saved: PrintFinalSavedWording, languages: readonly GuestLocale[]) =>
  printFinalWordingToSave(
    { preset: saved.callToAction, custom: saved.customWords },
    languages,
  )

/**
 * Whether the words on show are the saved ones: the same wording and, for the
 * languages of the print, the same own words once normalised. A saved language the
 * print does not carry is not compared.
 */
export function printFinalWordingIsSaved(
  words: PrintFinalWordsChoice,
  languages: readonly GuestLocale[],
  saved: PrintFinalSavedWording,
): boolean {
  const showing = printFinalWordingToSave(words, languages)
  const keeping = sayingOf(saved, languages)
  return (
    showing.callToAction === keeping.callToAction &&
    printFinalSameOwnWords(showing.customWords, keeping.customWords)
  )
}

/** Why words cannot be saved: a language with no headline, or an offer for the review (§5.8). Fit is the download's to judge, not the save's. */
export type PrintFinalWordingSaveProblem = 'empty_headline' | 'offer'

export function printFinalWordingSaveProblem(
  words: PrintFinalWordsChoice,
  languages: readonly GuestLocale[],
): PrintFinalWordingSaveProblem | null {
  const emptyHeadline = languages.some((locale) => {
    const copy = words.custom?.[locale]
    return copy !== undefined && printFinalCustomCopyProblem(copy) === 'empty_headline'
  })
  if (emptyHeadline) return 'empty_headline'
  return printFinalWordsOffer(words, languages) ? 'offer' : null
}
