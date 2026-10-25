// The warning list over the manager's own call to action (final design spec
// §5.8): what Share says under the words, and what the download refuses. Only a
// clear offer blocks (a discount, a coupon, "free dessert", "chance to win");
// mood, pressure, privacy and a lone "free" warn and never block; a number of
// seconds or minutes in changed words earns a neutral note to keep it true. A
// field still holding the wording's copy raises nothing. Pure and shared, so
// Share and the server read the words the same way.

import type { GuestLocale } from './guest-locale'
import type { PrintKitCopy } from './portal-print-kit'
import { PRINT_FINAL_COPY, type PrintFinalCallToAction } from './portal-print-final-copy'
import {
  printFinalCopyOf,
  printFinalIsOwnCopy,
  type PrintFinalWordsChoice,
} from './portal-print-final-custom'
import {
  PRINT_FINAL_WARNING_WORDS,
  type PrintFinalWarningWords,
} from './portal-print-final-warning-words'

export type PrintFinalWarningTopic =
  'offer' | 'mood' | 'pressure' | 'privacy' | 'offer_word' | 'time'

export type PrintFinalWordsWarning = Readonly<{
  /** `block` stops the print; `warn` only says so; `time` is a neutral note. */
  kind: 'block' | 'warn' | 'time'
  topic: PrintFinalWarningTopic
  /** The words as the manager typed them that raised it ("Loved"). */
  word: string
}>

/** Words, numbers and the signs of an amount, each a token; apostrophes stay inside a word. */
// A word may hold apostrophes ("don't", "n'oubliez"): letters, digits and
// apostrophes, trimmed of any apostrophe at either end below.
const TOKEN = /[\p{L}\p{N}']+|[%$€]/gu
const DIGITS = /^\p{N}+$/u
const MARKS = /\p{M}/gu

type Token = Readonly<{ folded: string; typed: string }>

/** Case and accents folded, typographic apostrophes made plain. */
const fold = (text: string): string =>
  text.normalize('NFD').replace(MARKS, '').replace(/[’‘]/gu, "'").toLowerCase()

function tokensOf(text: string): readonly Token[] {
  const plain = text.replace(/[’‘]/gu, "'")
  return [...plain.matchAll(TOKEN)]
    .map((match) => match[0].replace(/^'+|'+$/gu, ''))
    .filter((typed) => typed !== '')
    .map((typed) => ({ folded: fold(typed), typed }))
}

/** Where the phrase starts in the tokens, or -1. */
function findPhrase(tokens: readonly Token[], phrase: string): number {
  const words = phrase.split(' ')
  return tokens.findIndex((_, start) =>
    words.every((word, offset) => tokens[start + offset]?.folded === word),
  )
}

/** The first phrase of `list` the tokens hold, as typed. */
function firstHit(tokens: readonly Token[], list: readonly string[]): string | null {
  for (const phrase of list) {
    const start = findPhrase(tokens, phrase)
    if (start >= 0) {
      const length = phrase.split(' ').length
      return tokens
        .slice(start, start + length)
        .map((token) => token.typed)
        .join(' ')
    }
  }
  return null
}

const isNumber = (token: Token | undefined) =>
  token !== undefined && DIGITS.test(token.folded)
const isAmountSign = (token: Token | undefined) =>
  token !== undefined && ['%', '$', '€'].includes(token.folded)

/** "10% off", "$5 off", "5 € de descuento": an amount followed by the language's word for off. */
function amountOff(
  tokens: readonly Token[],
  words: PrintFinalWarningWords,
): string | null {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const here = tokens[index]
    const next = tokens[index + 1]
    const amount =
      (isNumber(here) && isAmountSign(next)) || (isAmountSign(here) && isNumber(next))
    if (!amount) continue
    const rest = tokens.slice(index + 2)
    const off = words.off.find((phrase) => findPhrase(rest, phrase) === 0)
    if (off !== undefined)
      return firstHit(tokens.slice(index), [`${here?.folded} ${next?.folded} ${off}`])
  }
  return null
}

/** "free dessert", "postre gratis": a free word beside one of the things. */
function freeThing(
  tokens: readonly Token[],
  words: PrintFinalWarningWords,
): string | null {
  for (const free of words.free) {
    const at = findPhrase(tokens, free)
    if (at < 0) continue
    const length = free.split(' ').length
    const after = tokens[at + length]
    const before = tokens[at - 1]
    const thing = [after, before].find(
      (token) => token !== undefined && words.things.includes(token.folded),
    )
    if (thing !== undefined)
      return thing === after
        ? `${tokens[at]?.typed} ${thing.typed}`
        : `${thing.typed} ${tokens[at]?.typed}`
  }
  return null
}

/** A number followed by seconds or minutes. */
function timeClaim(
  tokens: readonly Token[],
  words: PrintFinalWarningWords,
): string | null {
  const index = tokens.findIndex(
    (token, at) => isNumber(token) && words.time.includes(tokens[at + 1]?.folded ?? ''),
  )
  return index < 0 ? null : `${tokens[index]?.typed} ${tokens[index + 1]?.typed}`
}

/** The lists a language's field is read with: its own, and English, which managers type everywhere. */
const listsFor = (locale: GuestLocale): readonly PrintFinalWarningWords[] =>
  locale === 'en'
    ? [PRINT_FINAL_WARNING_WORDS.en]
    : [PRINT_FINAL_WARNING_WORDS[locale], PRINT_FINAL_WARNING_WORDS.en]

type Check = Readonly<{
  kind: PrintFinalWordsWarning['kind']
  topic: PrintFinalWarningTopic
  find: (tokens: readonly Token[], words: PrintFinalWarningWords) => string | null
}>

/** In order: the first that matches is said. */
const CHECKS: readonly Check[] = [
  { kind: 'block', topic: 'offer', find: amountOff },
  { kind: 'block', topic: 'offer', find: freeThing },
  {
    kind: 'block',
    topic: 'offer',
    find: (tokens, words) => firstHit(tokens, words.offers),
  },
  { kind: 'warn', topic: 'mood', find: (tokens, words) => firstHit(tokens, words.mood) },
  {
    kind: 'warn',
    topic: 'pressure',
    find: (tokens, words) => firstHit(tokens, words.pressure),
  },
  {
    kind: 'warn',
    topic: 'privacy',
    find: (tokens, words) => firstHit(tokens, words.privacy),
  },
  {
    kind: 'warn',
    topic: 'offer_word',
    find: (tokens, words) => firstHit(tokens, words.offerWords),
  },
  { kind: 'time', topic: 'time', find: timeClaim },
]

/** The note a text raises in a language, or null. */
export function printFinalTextWarning(
  text: string,
  locale: GuestLocale,
): PrintFinalWordsWarning | null {
  const tokens = tokensOf(text)
  for (const check of CHECKS) {
    for (const words of listsFor(locale)) {
      const word = check.find(tokens, words)
      if (word !== null) return { kind: check.kind, topic: check.topic, word }
    }
  }
  return null
}

/** The changed fields of a language's words, each against the wording's copy: an unchanged field raises nothing. */
function changedText(copy: PrintKitCopy, preset: PrintKitCopy): string {
  return [
    copy.headline === preset.headline ? '' : copy.headline,
    copy.subline === preset.subline ? '' : copy.subline,
  ].join(' · ')
}

/** The note one language of the print raises (§5.8), or null; words still the wording's raise none. */
export function printFinalWordsWarning(
  words: PrintFinalWordsChoice,
  locale: GuestLocale,
): PrintFinalWordsWarning | null {
  if (!printFinalIsOwnCopy(words, locale)) return null
  const preset: PrintFinalCallToAction = words.preset
  return printFinalTextWarning(
    changedText(printFinalCopyOf(words, locale), PRINT_FINAL_COPY[locale][preset]),
    locale,
  )
}

/** Whether any language of the print offers something for the review: the one note that blocks. */
export function printFinalWordsOffer(
  words: PrintFinalWordsChoice,
  languages: readonly GuestLocale[],
): boolean {
  return languages.some(
    (locale) => printFinalWordsWarning(words, locale)?.kind === 'block',
  )
}

/** What Share says for a note: its title, the line under it, and whether it offers the default wording. */
export type PrintFinalWarningNote = Readonly<{
  title: string
  body: string | null
  offersDefault: boolean
  offersKeep: boolean
}>

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

const PRESSURE_NOTE: PrintFinalWarningNote = {
  title: 'Google does not allow pressure or requests to name staff',
  body: 'Ask every guest the same way, with nothing they have to do or say.',
  offersDefault: true,
  offersKeep: true,
}

/** The note's words (§5.8; board share-words-states panels 5 to 7 and 12). */
export function printFinalWarningNote(
  warning: PrintFinalWordsWarning,
): PrintFinalWarningNote {
  switch (warning.topic) {
    case 'offer':
      return {
        title: 'Remove the offer to print',
        body: 'Google removes reviews given for a discount or a gift, and can remove them all. A card that offers something for a review cannot print.',
        offersDefault: false,
        offersKeep: false,
      }
    case 'mood':
      return {
        title: `“${capitalised(warning.word)}” asks only happy guests`,
        body: 'Google does not allow cards that ask only for good reviews. Cards that ask every guest the same way are safest.',
        offersDefault: true,
        offersKeep: true,
      }
    case 'pressure':
      return PRESSURE_NOTE
    case 'privacy':
      return {
        title: 'Words about privacy can read as steering unhappy guests away from Google',
        body: 'Cards that ask every guest the same way are safest.',
        offersDefault: true,
        offersKeep: true,
      }
    case 'offer_word':
      return {
        title: `Is “${warning.word.toLowerCase()}” part of an offer?`,
        body: 'Only an offer for a review is a problem. If nothing is given for the review, keep your words.',
        offersDefault: false,
        offersKeep: true,
      }
    case 'time':
      return {
        title: 'This promises a time. Keep it true.',
        body: null,
        offersDefault: false,
        offersKeep: false,
      }
  }
}
