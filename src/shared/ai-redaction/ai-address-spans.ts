// Pieces the address finders share (`ai-address-markers.ts`,
// `ai-address-number-last.ts`, `ai-foreign-address-markers.ts`): a span, the
// words of a run, the postal tail after a street and the test that a number is
// a count and not a house number.

import { COUNT_FOLLOWERS, QUANTITIES, SOFT_UNITS } from './ai-address-words'

export type AddressMarkerSpan = Readonly<{ start: number; end: number }>

export type Token = Readonly<{ word: string; start: number; end: number }>

export const NUMBER_FOLLOWER_LOOKAHEAD_SCALARS = 24

/*
 * The postal tail repeats a bounded group ({0,3}) that starts with a capital
 * letter no separator shares; the input is capped at 65,536 scalars before any
 * pattern runs. The security rule cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex */
/**
 * What follows the street on the same line: up to three capitalised words (a
 * city, a state) and a postcode (digits, a British or Canadian or Dutch code).
 * Case-sensitive and sticky: it is tried at the end of a street already found.
 */
export const POSTAL_TAIL_RE =
  /[, \t]+(?:\p{Lu}[\p{L}\p{M}'’.-]*[, \t]+){0,3}(?:\d{4,10}(?:-\d{3,4})?|[A-Z]{1,2}\d[A-Z\d]?[ \t]?\d[A-Z]{2}|[A-Z]\d[A-Z][ \t]?\d[A-Z]\d|\d{4}[ \t]?[A-Z]{2})(?![\p{L}\p{N}])/uy
/* eslint-enable security/detect-unsafe-regex */

/** The word after a number. */
export const WORD_AFTER_RE = /^[ \t]+(\p{L}+)/u

export function tokensOf(run: string, base: number): readonly Token[] {
  return [...run.matchAll(/[^ \t]+/gu)].map((match) => ({
    word: match[0],
    start: base + match.index,
    end: base + match.index + match[0].length,
  }))
}

/**
 * The words of a run, a word glued to the next by a full stop taken apart:
 * `St.James` is `St.` and `James`, `nights.Quiet` is `nights.` and `Quiet`.
 */
export function wordsOf(run: string): readonly string[] {
  return run
    .trim()
    .split(/[ \t]+/u)
    .flatMap((word) => word.split(/(?<=\.)(?=\p{L})/u))
}

/** The end of a street plus its postal tail, if there is one. */
export function withPostalTail(
  text: string,
  start: number,
  end: number,
): AddressMarkerSpan {
  POSTAL_TAIL_RE.lastIndex = end
  const tail = POSTAL_TAIL_RE.exec(text)
  return { start, end: tail === null ? end : end + tail[0].length }
}

/**
 * A quantity word right after a number turns it into a count: `Street 5 times`,
 * `Station Road 2 stops`, `Main Street 3 am`.
 */
export function followedByQuantity(text: string, end: number): boolean {
  const next = WORD_AFTER_RE.exec(
    text.slice(end, end + NUMBER_FOLLOWER_LOOKAHEAD_SCALARS),
  )?.[1]
  if (next === undefined) return false
  const word = next.toLowerCase()
  return QUANTITIES.has(word) || SOFT_UNITS.has(word) || COUNT_FOLLOWERS.has(word)
}

/**
 * Whether a number just ended is followed the way a clause ends: by the end, by
 * punctuation or by a capital letter (`Avenue Louise 5, Brussels`, `50
 * Broadway.`), and not by a lower-case word (`Place Mats 4 pieces`).
 */
export function endsClause(text: string, end: number): boolean {
  return /^[ \t]*(?:$|[,.;:)\]}>!?"'”’»*_–—-]|\p{Lu})/u.test(text.slice(end, end + 8))
}
