// Contact details and coordinates that a line break split.
//
// Revision 2 of the source text turns a line break into a blank, so that
// `clean.` and `Staff` on two lines stay two words. Main deleted the break and
// joined the halves, which removed `hotelsun` and `rise.com` on two lines as one
// domain by accident. The canonical text cannot tell a break from a space, so
// each shape here is a token with a blank in the one place a break splits it and
// something besides the blank that says it is a token:
//
// - a domain, `hotelsun rise.com`, `sunrise-ho tel.bg`, `hotelsunrise. com`;
// - an email address, `john. smith@gmail.com`, `john .smith@gmail.com`,
//   `john.smith@gma il.com`;
// - an IP address, `192.168. 1.1`, `192.16 8.1.1`;
// - a coordinate with a break in a number, `42.69 77, 23.3219`;
// - a handle, `Insta @ john_smith`, `@john_ smith`.
//
// Where a word stands in front of the joined token (`see booking.com`) it is
// taken too unless it is a word that introduces a domain or is glue: a word
// replaced in front of a contact is a small cost, a half-removed contact is not.
//
// - a street whose type or first name word a break split, `12 Oak Ro ad`, `12 Ma
//   in Street`: two fragments that spell a street-type word or a name read as one.

import {
  BASE_STREET_TYPES,
  COUNT_LEADS,
  EVALUATIVES,
  EXTRA_STREET_TYPES,
  STRONG_GLUE,
  WEAK_GLUE,
} from './ai-address-words'
import { leadOf, rejectsName, shapeOf } from './ai-address-name-rules'
import { tokensOf, withPostalTail, wordsOf } from './ai-address-spans'
import {
  isDomainLikeName,
  validDomain,
  endsInAlphabeticLabel,
  SPLIT_DOMAIN_TOP_LEVEL_WORDS,
} from './ai-network-markers'

export type BrokenTokenMarker = Readonly<{
  start: number
  end: number
  placeholder: '[CONTACT]' | '[ADDRESS]'
}>

/** Top-level domains a domain may end in after a break that follows its dot; none is a word. */
const AFTER_DOT_TOP_LEVEL_WORDS: readonly string[] = Object.freeze([
  'bg',
  'biz',
  'com',
  'de',
  'edu',
  'eu',
  'fr',
  'gov',
  'net',
  'org',
  'ro',
  'ru',
  'ua',
  'uk',
])

/** Words that introduce a domain or an address, and so are not the half of one. */
const INTRODUCING_WORDS: readonly string[] = Object.freeze([
  'address',
  'also',
  'book',
  'booked',
  'check',
  'contact',
  'email',
  'find',
  'found',
  'link',
  'mail',
  'online',
  'page',
  'please',
  'site',
  'thanks',
  'thank',
  'then',
  'try',
  'url',
  'use',
  'used',
  'using',
  'visit',
  'web',
  'website',
])

const MIN_FRAGMENT_SCALARS = 4
const MIN_EMAIL_FRAGMENT_SCALARS = 3
const MAX_BLANKS_IN_IP = 2

const FRAGMENT_STOP_WORDS: ReadonlySet<string> = new Set([
  ...INTRODUCING_WORDS,
  ...STRONG_GLUE,
  ...WEAK_GLUE,
  ...EVALUATIVES,
  ...COUNT_LEADS,
])
const AFTER_DOT_TOP_LEVELS: ReadonlySet<string> = new Set(AFTER_DOT_TOP_LEVEL_WORDS)
const SAFE_TOP_LEVELS: ReadonlySet<string> = new Set(SPLIT_DOMAIN_TOP_LEVEL_WORDS)

/*
 * Candidate repetitions are bounded ({0,3}, {1,3}, {3,40}) and every repeated unit
 * ends in a mandatory dot or starts after a lookbehind that no unit shares; the
 * input is capped at 65,536 scalars before any pattern runs. The security rule
 * cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex */
/** A name, a dot and a blank, then a top-level domain: `hotelsunrise. com`. */
const AFTER_DOT_RE =
  /(?<![\p{L}\p{N}.@-])((?:[a-z0-9][a-z0-9-]{0,40}\.){0,2}[a-z0-9][a-z0-9-]{2,40})\.[ \t]+([a-z]{2,6})(?![\p{L}\p{N}-])/gu
/**
 * A fragment of a host (dots allowed, or a scheme and the start of a host), a
 * blank, and the rest of a domain, with or without the dot that follows the blank:
 * `hotelsun rise.com`, `menu .restaurant-roma.co.uk`, `menu. restaurant-roma.co.uk`,
 * `https://h otelsunrise.com`.
 */
const MID_LABEL_RE =
  /(?<![\p{L}\p{N}.@/-])(https?:\/\/[a-z0-9.-]{0,60}|[a-z0-9][a-z0-9.-]{2,60})[ \t]+(\.?(?:[a-z0-9][a-z0-9-]{0,40}\.){1,3}[a-z]{2,10})(?![\p{L}\p{N}-])/gu
/** A host whose top-level domain a break split: `hotelsunrise.c om`, `menu.restaurant-roma.co.u k`. */
const TLD_BREAK_RE =
  /(?<![\p{L}\p{N}.@/-])((?:[a-z0-9][a-z0-9-]{0,40}\.){1,4}[a-z]{1,3})[ \t]([a-z]{1,3})(?![\p{L}\p{N}-])/gu
/**
 * The local part of an email address split beside a dot, an underscore or a
 * hyphen: `john. smith@gmail.com`, `john .smith@gmail.com`, `maria_ ivanova@abv.bg`,
 * `maria _ivanova@abv.bg`.
 */
const EMAIL_LOCAL_BREAK_RE =
  /(?<![\p{L}\p{N}._%+-])([a-z0-9][a-z0-9._-]{2,30})(?:([._-])[ \t]+|[ \t]+([._-]))([a-z0-9][a-z0-9._%+-]{0,30}@[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?![\p{L}\p{N}-])/gu
/** The domain of an email address split inside a label: `john.smith@gma il.com`. */
const EMAIL_DOMAIN_BREAK_RE =
  /(?<![\p{L}\p{N}._%+-])([a-z0-9][a-z0-9._%+-]{0,30}@[a-z0-9-]+)[ \t]([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?![\p{L}\p{N}-])/gu
/** Four groups of digits with a blank beside a dot or inside a group: `192.168. 1.1`. */
const IP_BREAK_RE =
  /(?<![\p{N}.])(\d{1,3}(?:[ \t]?\d{1,3})?(?:[ \t]?\.[ \t]?\d{1,3}(?:[ \t]\d{1,3})?){2}[ \t]?\.[ \t]?\d{1,3})(?![\p{N}])/gu
/**
 * Two decimal numbers with a blank beside the point or inside the fraction (either
 * of them), a comma or a blank between them: `42 .6977, 23.3219`, `42.69 77, 23.3219`,
 * `N 42.6977 E 23. 3219`. The pair is checked after the blanks inside the numbers
 * are taken out.
 */
const COORDINATE_BREAK_RE =
  /(?<![\p{N}.])((?:(?:lat(?:itude)?|[NS])\.?[ \t]*[:=]?[ \t]*)?[+-]?(?:\d{1,3}|\d[ \t]\d{1,2})[ \t]?\.[ \t]?\d{1,4}(?:[ \t]\d{1,4})?(?:[°º])?(?:[ \t]*[NS])?(?:[ \t]*[,;/|][ \t]*|[ \t]+)(?:(?:lon(?:g(?:itude)?)?\.?|lng|[EW])[ \t]*[:=]?[ \t]*)?[+-]?(?:\d{1,3}|\d[ \t]\d{1,2})[ \t]?\.[ \t]?\d{1,4}(?:[ \t]\d{1,4})?(?:[°º])?(?:[ \t]*[EW])?)(?![\p{N}.])/giu
const COORDINATE_NUMBER_RE =
  /[+-]?(?:\d{1,3}|\d[ \t]\d{1,2})[ \t]?\.[ \t]?\d{1,4}(?:[ \t]\d{1,4})?/gu
/** A handle with a blank after its at sign, named by a platform, or one that ends in an underscore. */
const HANDLE_BREAK_RE =
  /(?<![\p{L}\p{N}_.])(?:(?:insta(?:gram)?|ig|snap(?:chat)?|tiktok|twitter|fb|facebook|telegram|viber|whatsapp)[ \t:]*(@)[ \t]+([A-Za-z0-9_][A-Za-z0-9_.]{1,28})|(@[A-Za-z0-9_.]{1,20}_)[ \t]([A-Za-z0-9_]{2,10}))(?![A-Za-z0-9_])/giu
/** A handle of up to six characters and the rest of it after a blank: `@j ohn_smith`. */
const SHORT_HANDLE_RE =
  /(?<![\p{L}\p{N}_.])(@[A-Za-z0-9_.]{1,6})[ \t]([a-z0-9_.]{3,24})(?![A-Za-z0-9_])/gu
/** An at sign, a blank, and a handle that holds an underscore or a dot: `@ john_smith`. */
const AT_BLANK_HANDLE_RE =
  /(?<![\p{L}\p{N}_.])@[ \t]+([A-Za-z0-9]+[_.][A-Za-z0-9_.]*[A-Za-z0-9_])(?![A-Za-z0-9_])/gu
/** A house number and the words after it, one of which pairs of may be a street-type word split in two: `12 Oak Ro ad`. */
const BROKEN_TYPE_RE =
  /(?<![\p{L}\p{M}\p{N}.,:$€£])(\d{1,5}[A-Ea-e]?)((?:[ \t]+[\p{L}\p{M}'’-]+){3,7})(?![\p{L}\p{M}])/gu
/** A house number, a name split in two (`Ma in`), and a street-type word: `12 Ma in Street`. */
const BROKEN_NAME_RE =
  /(?<![\p{L}\p{M}\p{N}.,:$€£])(\d{1,5}[A-Ea-e]?)[ \t]+(\p{Lu}\p{Ll}{0,2})[ \t](\p{Ll}{1,3})[ \t]+(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)(?![\p{L}\p{M}])/giu
/* eslint-enable security/detect-unsafe-regex */

function isFragmentAccepted(fragment: string, minimum: number): boolean {
  return [...fragment].length >= minimum && !FRAGMENT_STOP_WORDS.has(fragment)
}

function domainEnd(domain: string): string {
  return domain.slice(domain.lastIndexOf('.') + 1)
}

function findAfterDot(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(AFTER_DOT_RE)) {
    const [whole, name = '', topLevel = ''] = match
    if (!AFTER_DOT_TOP_LEVELS.has(topLevel) || !isDomainLikeName(name)) continue
    if (!validDomain(`${name}.${topLevel}`)) continue
    found.push({
      start: match.index,
      end: match.index + whole.length,
      placeholder: '[CONTACT]',
    })
  }
  return found
}

/** The host of a fragment: the scheme taken off, the dot of the next part not doubled. */
function joinedHost(fragment: string, rest: string): string {
  return `${fragment.replace(/^https?:\/\//u, '')}${rest}`
}

function findMidLabel(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(MID_LABEL_RE)) {
    const [whole, fragment = '', domain = ''] = match
    const joined = joinedHost(fragment, domain)
    const word = !fragment.includes('.') && !fragment.includes('/')
    if (word && !isFragmentAccepted(fragment, MIN_FRAGMENT_SCALARS)) continue
    if (!SAFE_TOP_LEVELS.has(domainEnd(domain)) || !validDomain(joined)) continue
    if (!endsInAlphabeticLabel(joined)) continue
    found.push({
      start: match.index,
      end: match.index + whole.length,
      placeholder: '[CONTACT]',
    })
  }
  for (const match of text.matchAll(TLD_BREAK_RE)) {
    const [whole, host = '', tail = ''] = match
    if (
      !SAFE_TOP_LEVELS.has(`${domainEnd(host)}${tail}`) ||
      !validDomain(`${host}${tail}`)
    ) {
      continue
    }
    found.push({
      start: match.index,
      end: match.index + whole.length,
      placeholder: '[CONTACT]',
    })
  }
  return found
}

/** Whether `value`, joined, is an email address of the bounded shape. */
function isJoinedEmail(value: string): boolean {
  const at = value.indexOf('@')
  const local = value.slice(0, at)
  return (
    at > 0 &&
    at === value.lastIndexOf('@') &&
    local.length <= 64 &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    validDomain(value.slice(at + 1))
  )
}

function findEmailBreaks(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(EMAIL_LOCAL_BREAK_RE)) {
    const [whole, head = '', after = '', before = '', rest = ''] = match
    const joint = after === '' ? before : after
    if (
      head.length < MIN_EMAIL_FRAGMENT_SCALARS ||
      !isJoinedEmail(`${head}${joint}${rest}`)
    ) {
      continue
    }
    found.push({
      start: match.index,
      end: match.index + whole.length,
      placeholder: '[CONTACT]',
    })
  }
  for (const match of text.matchAll(EMAIL_DOMAIN_BREAK_RE)) {
    const [whole, head = '', tail = ''] = match
    if (!isJoinedEmail(`${head}${tail}`)) continue
    found.push({
      start: match.index,
      end: match.index + whole.length,
      placeholder: '[CONTACT]',
    })
  }
  return found
}

/** Whether the four groups, with every blank taken out, are an IPv4 address of at most two broken places. */
function isBrokenQuad(value: string): boolean {
  const blanks = (value.match(/[ \t]/gu) ?? []).length
  if (blanks === 0 || blanks > MAX_BLANKS_IN_IP) return false
  const groups = value.replace(/[ \t]/gu, '').split('.')
  return (
    groups.length === 4 &&
    groups.every((group) => /^\d{1,3}$/u.test(group) && Number(group) <= 255)
  )
}

function findIpBreaks(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(IP_BREAK_RE)) {
    const value = match[1] ?? ''
    if (!isBrokenQuad(value)) continue
    found.push({
      start: match.index,
      end: match.index + value.length,
      placeholder: '[CONTACT]',
    })
  }
  return found
}

const MAX_LATITUDE_DEGREES = 90
const MAX_LONGITUDE_DEGREES = 180
const MIN_BROKEN_PAIR_DECIMALS = 3

function fusedNumber(value: string): number {
  return Number(value.replace(/[ \t]/gu, ''))
}

function decimalsAfterFusing(value: string): number {
  return (value.replace(/[ \t]/gu, '').split('.')[1] ?? '').length
}

function findCoordinateBreaks(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(COORDINATE_BREAK_RE)) {
    const value = match[1] ?? ''
    const numbers = value.match(COORDINATE_NUMBER_RE) ?? []
    const [first, second] = numbers
    if (numbers.length !== 2 || first === undefined || second === undefined) continue
    if (!/[ \t]/u.test(first) && !/[ \t]/u.test(second)) continue
    const [lat, lon] = [Math.abs(fusedNumber(first)), Math.abs(fusedNumber(second))]
    const inRange =
      (lat <= MAX_LATITUDE_DEGREES && lon <= MAX_LONGITUDE_DEGREES) ||
      (lon <= MAX_LATITUDE_DEGREES && lat <= MAX_LONGITUDE_DEGREES)
    const precise = [first, second].every(
      (number) => decimalsAfterFusing(number) >= MIN_BROKEN_PAIR_DECIMALS,
    )
    if (inRange && precise) {
      found.push({
        start: match.index,
        end: match.index + value.length,
        placeholder: '[ADDRESS]',
      })
    }
  }
  return found
}

function findHandleBreaks(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(AT_BLANK_HANDLE_RE)) {
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      placeholder: '[CONTACT]',
    })
  }
  for (const match of text.matchAll(SHORT_HANDLE_RE)) {
    const [whole, , fragment = ''] = match
    if (FRAGMENT_STOP_WORDS.has(fragment)) continue
    found.push({
      start: match.index,
      end: match.index + whole.length,
      placeholder: '[CONTACT]',
    })
  }
  for (const match of text.matchAll(HANDLE_BREAK_RE)) {
    const whole = match[0]
    const at = match[1] === undefined ? match.index : match.index + whole.indexOf('@')
    found.push({ start: at, end: match.index + whole.length, placeholder: '[CONTACT]' })
  }
  return found
}

function isStreetType(word: string): boolean {
  return BASE_STREET_TYPES.has(word) || EXTRA_STREET_TYPES.has(word)
}

/** The first pair of adjacent words, after at least one capitalised name word, that spells a street type. */
function brokenTypeIn(
  words: readonly string[],
): Readonly<{ name: readonly string[]; type: string; lastFragment: number }> | null {
  for (let index = 1; index < words.length - 1; index += 1) {
    const head = words[index] ?? ''
    const tail = words[index + 1] ?? ''
    const name = words.slice(0, index)
    const type = `${head}${tail}`
    if (/^\p{Lu}/u.test(head) && isStreetType(type.toLowerCase())) {
      return { name, type, lastFragment: index + 1 }
    }
  }
  return null
}

function findBrokenTypes(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(BROKEN_TYPE_RE)) {
    const [whole, , run = ''] = match
    const words = wordsOf(run)
    const broken = brokenTypeIn(words)
    if (broken === null) continue
    const shape = shapeOf(broken.name, broken.type, leadOf(text, match.index))
    if (rejectsName(shape) || !shape.named) continue
    const tokens = tokensOf(run, match.index + whole.length - run.length)
    const last = tokens[broken.lastFragment]
    if (last === undefined) continue
    const span = withPostalTail(text, match.index, last.end)
    found.push({ ...span, placeholder: '[ADDRESS]' })
  }
  return found
}

function findBrokenNames(text: string): readonly BrokenTokenMarker[] {
  const found: BrokenTokenMarker[] = []
  for (const match of text.matchAll(BROKEN_NAME_RE)) {
    const [whole, , head = '', tail = '', type = ''] = match
    const shape = shapeOf([`${head}${tail}`], type, leadOf(text, match.index))
    const fragments = /^\p{Lu}\p{Ll}{0,2}$/u.test(head) && /^\p{Ll}{1,3}$/u.test(tail)
    if (!fragments || !shape.named || rejectsName(shape)) continue
    const span = withPostalTail(text, match.index, match.index + whole.length)
    found.push({ ...span, placeholder: '[ADDRESS]' })
  }
  return found
}

const BROKEN_TOKEN_FINDERS: ReadonlyArray<
  (text: string) => readonly BrokenTokenMarker[]
> = [
  findAfterDot,
  findMidLabel,
  findEmailBreaks,
  findIpBreaks,
  findCoordinateBreaks,
  findHandleBreaks,
  findBrokenTypes,
  findBrokenNames,
]

/** Every token of `text` that a line break split, with the blank the break left. */
export function findBrokenTokenMarkers(text: string): readonly BrokenTokenMarker[] {
  return BROKEN_TOKEN_FINDERS.flatMap((find) => find(text))
}

/** What the detector profile digest records about the broken-token markers. */
export const BROKEN_TOKEN_PROFILE = Object.freeze({
  patterns: Object.freeze(
    (
      [
        ['broken_after_dot', AFTER_DOT_RE],
        ['broken_mid_label', MID_LABEL_RE],
        ['broken_email_local', EMAIL_LOCAL_BREAK_RE],
        ['broken_email_domain', EMAIL_DOMAIN_BREAK_RE],
        ['broken_ip', IP_BREAK_RE],
        ['broken_coordinate', COORDINATE_BREAK_RE],
        ['broken_coordinate_number', COORDINATE_NUMBER_RE],
        ['broken_handle', HANDLE_BREAK_RE],
        ['broken_short_handle', SHORT_HANDLE_RE],
        ['broken_at_blank_handle', AT_BLANK_HANDLE_RE],
        ['broken_tld', TLD_BREAK_RE],
        ['broken_type', BROKEN_TYPE_RE],
        ['broken_name', BROKEN_NAME_RE],
      ] as const
    ).map(([id, expression]) =>
      Object.freeze({ id, source: expression.source, flags: expression.flags }),
    ),
  ),
  afterDotTopLevels: AFTER_DOT_TOP_LEVEL_WORDS,
  introducingWords: INTRODUCING_WORDS,
  limits: Object.freeze({
    minFragmentScalars: MIN_FRAGMENT_SCALARS,
    minEmailFragmentScalars: MIN_EMAIL_FRAGMENT_SCALARS,
    maxBlanksInIp: MAX_BLANKS_IN_IP,
    maxLatitudeDegrees: MAX_LATITUDE_DEGREES,
    maxLongitudeDegrees: MAX_LONGITUDE_DEGREES,
    minBrokenPairDecimals: MIN_BROKEN_PAIR_DECIMALS,
  }),
})
