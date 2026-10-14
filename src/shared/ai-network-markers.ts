// Network markers of structured-marker-detectors-v1: IP addresses and domains
// written in the ways a guest actually types them.
//
// - An IP address with a port (`192.0.2.55:8080`, `[2001:db8::1]:443`), after a
//   label (`IP:203.0.113.9`), or followed by full stops (`203.0.113.9...`) is an
//   IP address. Main removed these only because its bare-domain rule took any
//   run of dotted numbers.
// - A domain whose dot was separated from its name by a line break reads
//   `hotelsunrise .com` in the canonical source text, where a line break is a
//   blank; main joined the two and removed it whole. A last label from a short
//   list of top-level domains, in lower case, is what tells it from a sentence
//   with a stray blank before a full stop.
//   The name is a domain's when it is lower case and long, or holds a digit or a
//   hyphen: `Booking .com said` and `The word .com` are prose.
// - A last label for a bare domain is told from a number or an abbreviation:
//   at least two letters, starting with a letter (`com`, `bg`, `бг`, `c0m`,
//   or the ASCII form of an internationalised one, `xn--p1ai`).

import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

export type NetworkMarkerSpan = Readonly<{ start: number; end: number }>

/** Top-level domains a split domain may end in; none is a word of ordinary prose. */
export const SPLIT_DOMAIN_TOP_LEVEL_WORDS: readonly string[] = Object.freeze([
  'app',
  'bar',
  'bg',
  'biz',
  'ch',
  'co',
  'com',
  'cz',
  'de',
  'dev',
  'dk',
  'edu',
  'es',
  'eu',
  'fi',
  'fr',
  'gov',
  'gr',
  'hotel',
  'hotels',
  'hu',
  'info',
  'io',
  'it',
  'net',
  'nl',
  'online',
  'org',
  'pl',
  'ro',
  'ru',
  'se',
  'shop',
  'sk',
  'travel',
  'tr',
  'ua',
  'uk',
  'xyz',
])

/*
 * Detector input is rejected above 65,536 Unicode scalars before any pattern runs;
 * the repetitions are bounded or consume delimiter-separated atoms monotonically.
 * The security rule cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex, no-useless-escape */
const IP_TOKEN_RE =
  /(?:^|[^A-Fa-f0-9:.\[])((?:\[[A-Fa-f0-9:.]+\](?::\d{1,5})?|[A-Fa-f0-9:.]{3,}))(?=$|\.(?![A-Fa-f0-9:.])|[^A-Fa-f0-9:.\]])/gu
/** An IPv4 address written in hexadecimal, a byte at a time: `0xC0.0xA8.0x01.0x01`. */
const HEX_IPV4_RE =
  /(?<![\p{L}\p{N}.])(0x[0-9A-Fa-f]{1,2}(?:\.0x[0-9A-Fa-f]{1,2}){3})(?![\p{L}\p{N}])/gu
/** A name (up to three sub-domains and a label) and a top-level domain with a blank in front of the dot. */
const SPLIT_DOMAIN_RE =
  /(?<![\p{L}\p{N}-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.){0,3}[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)[ \t]+\.(app|bar|bg|biz|ch|co|com|cz|de|dev|dk|edu|es|eu|fi|fr|gov|gr|hotel|hotels|hu|info|io|it|net|nl|online|org|pl|ro|ru|se|shop|sk|travel|tr|ua|uk|xyz)(?![\p{L}\p{N}-])/giu
const IPV4_WITH_PORT_RE = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/u
const IP_WITH_BRACKETS_RE = /^\[([A-Fa-f0-9:.]+)\](?::\d{1,5})?$/u
/** Four groups of one to three digits, zero-padded or not: `192.168.001.001`. */
const DOTTED_QUAD_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/u
/* eslint-enable security/detect-unsafe-regex, no-useless-escape */
const MAX_DOMAIN_SCALARS = 253
const MAX_LABEL_SCALARS = 63

/** A host name of at least two labels, each of letters, digits and hyphens. */
export function validDomain(domain: string): boolean {
  const ascii = domainToASCII(domain)
  if (ascii.length < 1 || ascii.length > MAX_DOMAIN_SCALARS || !ascii.includes('.')) {
    return false
  }
  return ascii
    .split('.')
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= MAX_LABEL_SCALARS &&
        !label.startsWith('-') &&
        !label.endsWith('-') &&
        /^[A-Za-z0-9-]+$/u.test(label),
    )
}

/**
 * A domain written bare, in running text, is told from a number or an
 * abbreviation by its last label, which is a top-level domain: it starts with a
 * letter and holds at least two (`com`, `bg`, `co`, `бг`, `c0m`, or the ASCII
 * form of an internationalised one, `xn--p1ai`). `4.5`, `9.99`, `12.05.2024`,
 * `2.4 GHz`, `e.g`, `a.m`, `т.е`, `U.S.A` and `v2` are not domains. Email
 * addresses and URLs keep the plainer `validDomain`: their `@` or scheme is
 * already the evidence, and `guest@192.0.2.55` must stay a contact.
 */
export function endsInAlphabeticLabel(domain: string): boolean {
  const label = domain.slice(domain.lastIndexOf('.') + 1)
  if (/^xn--[a-z0-9-]+$/iu.test(label)) return true
  if (!/^\p{L}/u.test(label)) return false
  let letters = 0
  for (const scalar of label) {
    if (/^\p{L}$/u.test(scalar)) letters += 1
    else if (!/^[\p{M}\p{N}]$/u.test(scalar)) return false
  }
  return letters >= 2
}

const MAX_OCTET = 255

/** Whether `value` is an IPv4 address with every group in range, written with or without padding. */
function isDottedQuad(value: string): boolean {
  return (
    DOTTED_QUAD_RE.test(value) &&
    value.split('.').every((group) => Number(group) <= MAX_OCTET)
  )
}

function isAddress(value: string): boolean {
  return isIP(value) !== 0 || isDottedQuad(value)
}

/** Whether `candidate` is an IP address, in brackets, with a port, or alone. */
function isIpWithPort(candidate: string): boolean {
  const bracketed = IP_WITH_BRACKETS_RE.exec(candidate)
  if (bracketed !== null) return isAddress(bracketed[1] ?? '')
  const withPort = IPV4_WITH_PORT_RE.exec(candidate)
  if (withPort !== null) return isAddress(withPort[1] ?? '')
  return isAddress(candidate)
}

/** The part of a token that is an IP address, as an offset and a length, or null. */
function ipWithin(raw: string): Readonly<{ offset: number; length: number }> | null {
  const variants = [
    raw,
    raw.replace(/[.,;:]+$/u, ''),
    raw.replace(/^:+/u, '').replace(/[.:]+$/u, ''),
  ]
  for (const variant of variants) {
    if (variant.length > 0 && isIpWithPort(variant)) {
      return { offset: raw.indexOf(variant), length: variant.length }
    }
  }
  return null
}

/** Every IP address of `text`: with a port, after a label, before full stops. */
export function findIpMarkers(text: string): readonly NetworkMarkerSpan[] {
  const spans: NetworkMarkerSpan[] = []
  for (const match of text.matchAll(IP_TOKEN_RE)) {
    const raw = match[1]
    if (raw === undefined) continue
    const found = ipWithin(raw)
    if (found === null) continue
    const start = match.index + match[0].lastIndexOf(raw) + found.offset
    spans.push({ start, end: start + found.length })
  }
  for (const match of text.matchAll(HEX_IPV4_RE)) {
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

const MIN_SPLIT_NAME_SCALARS = 6

/**
 * The name in front of a blank and a dot is the name of a domain, and not a word
 * of the sentence (`The word .com`, `Booking .com said`, `in .de or .fr`), when
 * its last label is lower case and either long (six letters) or holds a digit
 * or a hyphen: `hotelsunrise .com`, `sunrise-hotel .bg`, `hotel24 .bg`, or
 * written in camel case, `HotelSunrise .com`. A name a guest wrote with a single
 * capital is a service named in a sentence.
 */
export function isDomainLikeName(name: string): boolean {
  const label = name.slice(name.lastIndexOf('.') + 1)
  const long = [...label].length >= MIN_SPLIT_NAME_SCALARS
  if (/^\p{Lu}/u.test(label)) return long && /\p{Lu}/u.test(label.slice(1))
  return long || /[\p{N}-]/u.test(label)
}

/** Every domain whose dot is separated from its name by a blank. */
export function findSplitDomainMarkers(text: string): readonly NetworkMarkerSpan[] {
  const spans: NetworkMarkerSpan[] = []
  for (const match of text.matchAll(SPLIT_DOMAIN_RE)) {
    const [whole, name = '', topLevel = ''] = match
    const joined = `${name}.${topLevel}`
    if (
      !isDomainLikeName(name) ||
      !validDomain(joined) ||
      !endsInAlphabeticLabel(joined)
    ) {
      continue
    }
    spans.push({ start: match.index, end: match.index + whole.length })
  }
  return spans
}

/** What the detector profile digest records about the network markers. */
export const NETWORK_MARKER_PROFILE = Object.freeze({
  patterns: Object.freeze([
    Object.freeze({
      id: 'ip_token',
      source: IP_TOKEN_RE.source,
      flags: IP_TOKEN_RE.flags,
    }),
    Object.freeze({
      id: 'hex_ipv4',
      source: HEX_IPV4_RE.source,
      flags: HEX_IPV4_RE.flags,
    }),
    Object.freeze({
      id: 'split_domain',
      source: SPLIT_DOMAIN_RE.source,
      flags: SPLIT_DOMAIN_RE.flags,
    }),
  ]),
  splitDomainTopLevels: SPLIT_DOMAIN_TOP_LEVEL_WORDS,
  minSplitNameScalars: MIN_SPLIT_NAME_SCALARS,
})
