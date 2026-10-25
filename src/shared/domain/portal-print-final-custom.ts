// The manager's own words for a final print (final design spec §5.6): a headline
// and a sub-line per language on the print, written in Share's "Write your own…"
// and printed exactly as typed, never translated. Pure and shared: Share
// normalises as the manager types, the download's input schema refuses what this
// refuses, and the print resolves each language as its own words, else the
// wording's copy.

import type { GuestLocale } from './guest-locale'
import type { PrintKitCopy } from './portal-print-kit'
import {
  PRINT_FINAL_COPY,
  printFinalHeldLanguage,
  type PrintFinalCallToAction,
} from './portal-print-final-copy'

/** Each field holds at most this many characters: a guard on the store; the fit check refuses long before. */
export const PRINT_FINAL_CUSTOM_MAX_CHARACTERS = 60

/** One language's own words; an empty sub-line prints none, and the message closes up. */
export type PrintFinalCustomCopy = PrintKitCopy

/** The own words, keyed by language: only the languages of the print. */
export type PrintFinalCustomWords = Readonly<
  Partial<Record<GuestLocale, PrintFinalCustomCopy>>
>

/**
 * What a print says: the wording it started from, and the manager's own words
 * where they wrote them (null: the wording's copy in every language).
 */
export type PrintFinalWordsChoice = Readonly<{
  preset: PrintFinalCallToAction
  custom?: PrintFinalCustomWords | null
}>

// Control characters (C0, DEL and C1): a field is one line of printable text.
const isControl = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}
// Line breaks and tabs: each run becomes one space.
const LINE_BREAKS = /[\r\n\t\u2028\u2029]+/gu
const SPACE_RUNS = /[ \t\u00a0]{2,}/gu

/**
 * A field as the manager types it: line breaks become spaces, runs of spaces
 * close up, and nothing leads. The end is left alone, so the space before the
 * next word can be typed; `normalisePrintFinalText` trims it for the print.
 */
export function tidyPrintFinalTyping(text: string): string {
  return text
    .replace(LINE_BREAKS, ' ')
    .replace(SPACE_RUNS, (run) => (run.includes('\u00a0') ? '\u00a0' : ' '))
    .replace(/^\s+/u, '')
}

/** A field as the print sets it: tidied and trimmed. Typographic quotes stay as typed. */
export const normalisePrintFinalText = (text: string): string =>
  tidyPrintFinalTyping(text).trim()

/** Whether a field holds a control character (a pasted line break is no such character: it becomes a space). */
export const hasPrintFinalControlCharacters = (text: string): boolean =>
  [...text.replace(LINE_BREAKS, ' ')].some(isControl)

export type PrintFinalCustomProblem =
  'empty_headline' | 'too_long' | 'control_characters' | 'language_not_on_print'

/** Why one language's own words cannot print, or null. They are judged as normalised. */
export function printFinalCustomCopyProblem(
  copy: PrintFinalCustomCopy,
): PrintFinalCustomProblem | null {
  const fields = [copy.headline, copy.subline]
  if (fields.some(hasPrintFinalControlCharacters)) {
    return 'control_characters'
  }
  const headline = normalisePrintFinalText(copy.headline)
  const subline = normalisePrintFinalText(copy.subline)
  if (headline === '') return 'empty_headline'
  const longest = Math.max([...headline].length, [...subline].length)
  return longest > PRINT_FINAL_CUSTOM_MAX_CHARACTERS ? 'too_long' : null
}

/** Why the own words of a print cannot print, or null: every language must be on the print, and each one's words whole. */
export function printFinalCustomProblem(
  custom: PrintFinalCustomWords,
  languages: readonly GuestLocale[],
): PrintFinalCustomProblem | null {
  for (const [locale, copy] of Object.entries(custom) as [
    GuestLocale,
    PrintFinalCustomCopy,
  ][]) {
    if (!languages.includes(locale)) return 'language_not_on_print'
    const problem = printFinalCustomCopyProblem(copy)
    if (problem !== null) return problem
  }
  return null
}

/** One language's words on the print: its own words, normalised, else the wording's copy. */
export function printFinalCopyOf(
  words: PrintFinalWordsChoice,
  locale: GuestLocale,
): PrintKitCopy {
  const own = words.custom?.[locale]
  if (own === undefined) return PRINT_FINAL_COPY[locale][words.preset]
  return {
    headline: normalisePrintFinalText(own.headline),
    subline: normalisePrintFinalText(own.subline),
  }
}

/** Whether a language's words on the print are the manager's own: written, and not the wording's copy as it stands. */
export function printFinalIsOwnCopy(
  words: PrintFinalWordsChoice,
  locale: GuestLocale,
): boolean {
  if (words.custom?.[locale] === undefined) return false
  const own = printFinalCopyOf(words, locale)
  const preset = PRINT_FINAL_COPY[locale][words.preset]
  return own.headline !== preset.headline || own.subline !== preset.subline
}

/** The own words of a print as stored and sent: normalised, only the print's languages; null with none. */
export function printFinalStoredCustom(
  words: PrintFinalWordsChoice,
  languages: readonly GuestLocale[],
): PrintFinalCustomWords | null {
  if (words.custom == null) return null
  const entries = languages.flatMap((locale) =>
    words.custom?.[locale] === undefined
      ? []
      : [[locale, printFinalCopyOf(words, locale)] as const],
  )
  return entries.length === 0 ? null : Object.fromEntries(entries)
}

/**
 * The first language whose words would come from a wording that rule F holds
 * back (§5.5); a language with its own words never does. Null when every
 * language prints.
 */
export function printFinalWordsHeldLanguage(
  words: PrintFinalWordsChoice,
  languages: readonly GuestLocale[],
): GuestLocale | null {
  return printFinalHeldLanguage(
    words.preset,
    languages.filter((locale) => words.custom?.[locale] === undefined),
  )
}
