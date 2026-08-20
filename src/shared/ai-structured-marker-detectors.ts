import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { AI_UNICODE_CASE_FOLDING_V17 } from './generated/ai-unicode-case-folding-v17'

export const AI_STRUCTURED_MARKER_DETECTORS_VERSION =
  'structured-marker-detectors-v1' as const
export const MAX_AI_STRUCTURED_MARKER_CANDIDATES_V1 = 64
export const MAX_AI_STRUCTURED_MARKER_INPUT_SCALARS_V1 = 65_536

export const AI_CLOSED_PLACEHOLDERS = Object.freeze([
  '[PERSON]',
  '[CONTACT]',
  '[ADDRESS]',
  '[FINANCIAL]',
  '[IDENTIFIER]',
  '[SECRET]',
] as const)

export type AiClosedPlaceholder = (typeof AI_CLOSED_PLACEHOLDERS)[number]
export type AiDetectedPlaceholder = Exclude<AiClosedPlaceholder, '[PERSON]'>

export type AiStructuredMarkerInterval = Readonly<{
  startUtf16: number
  endUtf16: number
  scalarLength: number
  placeholder: AiDetectedPlaceholder
}>

export type AiStructuredMarkerBlockReason =
  | 'invalid_unicode'
  | 'noncanonical_unicode'
  | 'invalid_country'
  | 'profile_mismatch'
  | 'ambiguous_candidate'
  | 'candidate_limit_exceeded'
  | 'input_too_large'
  | 'scanner_unavailable'

export type AiStructuredMarkerScanResult =
  | Readonly<{
      status: 'safe'
      intervals: readonly AiStructuredMarkerInterval[]
      candidateCount: number
    }>
  | Readonly<{ status: 'blocked'; reason: AiStructuredMarkerBlockReason }>

export type AiStructuredMarkerScanInput = Readonly<{
  text: string
  countryCode: string
  expectedProfileVersion: string
  expectedProfileDigest: string
}>

const COUNTRY_CODES = new Set<string>(getCountries())
/*
 * Detector input is rejected above 65,536 Unicode scalars before any pattern runs.
 * Candidate repetitions are bounded by the profile or consume delimiter-separated
 * atoms monotonically; the security rule cannot model those enclosing invariants.
 */
/* eslint-disable security/detect-unsafe-regex, no-useless-escape */
const EMAIL_RE = new RegExp(
  "[\\p{L}\\p{N}.!#$%&'*+/=?^_`{|}~-]{1,64}@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+",
  'gu',
)
const RECONSTRUCTED_EMAIL_RE = new RegExp(
  "[\\p{L}\\p{N}.!#$%&'*+/=?^_`{|}~-]{1,64}[ \\t]*@[ \\t]*[\\p{L}\\p{N}-]+(?:[ \\t]*\\.[ \\t]*[\\p{L}\\p{N}-]+)+",
  'gu',
)
const URL_RE = /(?:https?:\/\/|www\.)[^\s]{1,2048}/giu
const RECONSTRUCTED_URL_RE =
  /https?[ \t]*:[ \t]*\/[ \t]*\/[ \t]*[\p{L}\p{N}-]+(?:[ \t]*\.[ \t]*[\p{L}\p{N}-]+)+(?:[ \t]*\/[\p{L}\p{N}._~!$&'()*+,;=:@%/-]*)?/giu
const SPACED_DOT_RE = /[ \t]+\.[ \t]*|[ \t]*\.[ \t]+/gu
const BARE_DOMAIN_RE =
  /(?:^|[^\p{L}\p{N}-])([\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)+)(?=$|[^\p{L}\p{N}-])/gu
const SOCIAL_RE =
  /(?:^|[^\p{L}\p{N}_.])(@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)(?=$|[^A-Za-z0-9_.])/gu
const PHONE_RE =
  /(?:^|[^\p{Nd}])((?:\+?[\p{Nd}][\p{Nd} ().-]{5,30}[\p{Nd}]))(?=$|[^\p{Nd}])/gu
const IP_TOKEN_RE =
  /(?:^|[^A-Fa-f0-9:.\[])((?:\[[A-Fa-f0-9:]+\]|[A-Fa-f0-9:.]{3,}))(?=$|[^A-Fa-f0-9:.\]])/gu
const COORDINATE_RE =
  /(?:^|[^\p{N}.+-])([+-]?(?:\d{1,3})\.\d{4,8}\s*,\s*[+-]?(?:\d{1,3})\.\d{4,8})(?=$|[^\p{N}.])/gu
const CARD_RE = /(?:^|[^\p{Nd}])((?:\p{Nd}[ -]?){12,18}\p{Nd})(?=$|[^\p{Nd}])/gu
const IBAN_RE =
  /(?:^|[^A-Za-z0-9])([A-Za-z]{2}\d{2}(?:[ -]?[A-Za-z0-9]){11,30})(?=$|[^A-Za-z0-9])/gu
const LABELLED_ID_RE =
  /\b(?:passport|tax[ \t_-]*id|national[ \t_-]*id|government[ \t_-]*id|driver'?s?[ \t_-]*licen[cs]e|ssn|social[ \t_-]*security|account[ \t_-]*(?:id|number)|customer[ \t_-]*id)\b[ \t]*(?::|#|-)?[ \t]*[A-Za-z0-9][A-Za-z0-9._~-]{3,64}/giu
const ADDRESS_RE =
  /\b\d{1,8}[ \t]+(?:[\p{L}\p{M}][\p{L}\p{M}.'’-]*[ \t]+){0,8}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)\b(?:[, \t]+\d{4,10}(?:-\d{3,4})?)?/giu
const POSTAL_LABEL_RE =
  /\b(?:postal[ \t_-]*code|postal|postcode|zip[ \t_-]*code|zip)\b[ \t]*(?::|#|-)?[ \t]*[A-Za-z0-9][A-Za-z0-9 -]{2,11}[A-Za-z0-9]\b/giu
const KNOWN_SECRET_RE =
  /(?:^|[^A-Za-z0-9_])((?:sk_(?:live_|test_|proj_)?|gh[pousr]_|xox[baprs]-|AIza)[A-Za-z0-9_+/=-]{16,240})(?=$|[^A-Za-z0-9_+/=-])/gu
const HEX_SECRET_RE = /(?:^|[^A-Fa-f0-9])([A-Fa-f0-9]{32,128})(?=$|[^A-Fa-f0-9])/gu
const ENTROPY_TOKEN_RE =
  /(?:^|[^A-Za-z0-9_+/=-])([A-Za-z0-9_+/=-]{24,256})(?=$|[^A-Za-z0-9_+/=-])/gu
const OVERBOUND_PHONE_RE =
  /(?:^|[^\p{Nd}])(\+?[\p{Nd}][\p{Nd} ().-]{31,}[\p{Nd}])(?=$|[^\p{Nd}])/gu
const OVERBOUND_LABELLED_ID_RE =
  /\b(?:passport|tax[ \t_-]*id|national[ \t_-]*id|government[ \t_-]*id|driver'?s?[ \t_-]*licen[cs]e|ssn|social[ \t_-]*security|account[ \t_-]*(?:id|number)|customer[ \t_-]*id)\b[ \t]*(?::|#|-)?[ \t]*[A-Za-z0-9._~-]{65,}/giu
const OVERBOUND_CARD_RE = /(?:^|[^\p{Nd}])((?:\p{Nd}[ -]?){19,}\p{Nd})(?=$|[^\p{Nd}])/gu
const OVERBOUND_IBAN_RE =
  /(?:^|[^A-Za-z0-9])([A-Za-z]{2}\d{2}(?:[ -]?[A-Za-z0-9]){31,})(?=$|[^A-Za-z0-9])/gu
const OVERBOUND_COORDINATE_RE =
  /[+-]?(?:\d{1,3})\.\d{9,}\s*,\s*[+-]?(?:\d{1,3})\.\d{4,}|[+-]?(?:\d{1,3})\.\d{4,}\s*,\s*[+-]?(?:\d{1,3})\.\d{9,}/gu
const ADDRESS_HINT_RE =
  /\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)\b/iu
/* eslint-enable security/detect-unsafe-regex, no-useless-escape */

const PLACEHOLDER_PRIORITY: Readonly<Record<AiDetectedPlaceholder, number>> = {
  '[SECRET]': 0,
  '[FINANCIAL]': 1,
  '[IDENTIFIER]': 2,
  '[ADDRESS]': 3,
  '[CONTACT]': 4,
}
const DETECTOR_MANIFEST = Object.freeze({
  version: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  inputNormalization: 'NFKC-stable-scalar-text',
  maxCandidates: MAX_AI_STRUCTURED_MARKER_CANDIDATES_V1,
  maxInputScalars: MAX_AI_STRUCTURED_MARKER_INPUT_SCALARS_V1,
  overlapOrder: Object.freeze([
    'secret',
    'financial',
    'identifier',
    'address',
    'contact',
  ]),
  patterns: Object.freeze([
    Object.freeze({ id: 'address', source: ADDRESS_RE.source, flags: ADDRESS_RE.flags }),
    Object.freeze({
      id: 'address_hint',
      source: ADDRESS_HINT_RE.source,
      flags: ADDRESS_HINT_RE.flags,
    }),
    Object.freeze({
      id: 'bare_domain',
      source: BARE_DOMAIN_RE.source,
      flags: BARE_DOMAIN_RE.flags,
    }),
    Object.freeze({ id: 'card', source: CARD_RE.source, flags: CARD_RE.flags }),
    Object.freeze({
      id: 'coordinate',
      source: COORDINATE_RE.source,
      flags: COORDINATE_RE.flags,
    }),
    Object.freeze({ id: 'email', source: EMAIL_RE.source, flags: EMAIL_RE.flags }),
    Object.freeze({
      id: 'entropy_token',
      source: ENTROPY_TOKEN_RE.source,
      flags: ENTROPY_TOKEN_RE.flags,
    }),
    Object.freeze({
      id: 'hex_secret',
      source: HEX_SECRET_RE.source,
      flags: HEX_SECRET_RE.flags,
    }),
    Object.freeze({ id: 'iban', source: IBAN_RE.source, flags: IBAN_RE.flags }),
    Object.freeze({
      id: 'ip_token',
      source: IP_TOKEN_RE.source,
      flags: IP_TOKEN_RE.flags,
    }),
    Object.freeze({
      id: 'known_secret',
      source: KNOWN_SECRET_RE.source,
      flags: KNOWN_SECRET_RE.flags,
    }),
    Object.freeze({
      id: 'labelled_id',
      source: LABELLED_ID_RE.source,
      flags: LABELLED_ID_RE.flags,
    }),
    Object.freeze({
      id: 'overbound_card',
      source: OVERBOUND_CARD_RE.source,
      flags: OVERBOUND_CARD_RE.flags,
    }),
    Object.freeze({
      id: 'overbound_coordinate',
      source: OVERBOUND_COORDINATE_RE.source,
      flags: OVERBOUND_COORDINATE_RE.flags,
    }),
    Object.freeze({
      id: 'overbound_iban',
      source: OVERBOUND_IBAN_RE.source,
      flags: OVERBOUND_IBAN_RE.flags,
    }),
    Object.freeze({
      id: 'overbound_labelled_id',
      source: OVERBOUND_LABELLED_ID_RE.source,
      flags: OVERBOUND_LABELLED_ID_RE.flags,
    }),
    Object.freeze({
      id: 'overbound_phone',
      source: OVERBOUND_PHONE_RE.source,
      flags: OVERBOUND_PHONE_RE.flags,
    }),
    Object.freeze({ id: 'phone', source: PHONE_RE.source, flags: PHONE_RE.flags }),
    Object.freeze({
      id: 'postal_label',
      source: POSTAL_LABEL_RE.source,
      flags: POSTAL_LABEL_RE.flags,
    }),
    Object.freeze({
      id: 'reconstructed_email',
      source: RECONSTRUCTED_EMAIL_RE.source,
      flags: RECONSTRUCTED_EMAIL_RE.flags,
    }),
    Object.freeze({
      id: 'reconstructed_url',
      source: RECONSTRUCTED_URL_RE.source,
      flags: RECONSTRUCTED_URL_RE.flags,
    }),
    Object.freeze({ id: 'social', source: SOCIAL_RE.source, flags: SOCIAL_RE.flags }),
    Object.freeze({
      id: 'spaced_dot',
      source: SPACED_DOT_RE.source,
      flags: SPACED_DOT_RE.flags,
    }),
    Object.freeze({ id: 'url', source: URL_RE.source, flags: URL_RE.flags }),
  ]),
  candidateCaps: Object.freeze({
    email: 254,
    url: 2048,
    socialHandle: 31,
    phone: 32,
    coordinate: 64,
    financial: 256,
    identifier: 256,
    address: 256,
    secret: 256,
  }),
  validators: Object.freeze([
    'email-rfc-bounded-v1',
    'whatwg-http-domain-v1',
    'social-handle-v1',
    'libphonenumber-js-1.13.11-max',
    'node-net-is-ip-v1',
    'coordinate-rational-v1',
    'luhn-v1',
    'iban-mod97-v1',
    'labelled-identifier-v1',
    'postal-address-keyword-v1',
    'secret-entropy-v1',
  ]),
})

export const AI_STRUCTURED_MARKER_DETECTORS_DIGEST = createHash('sha256')
  .update('repkey-structured-marker-detectors-profile-v1\0', 'utf8')
  .update(canonicalizeRfc8785(DETECTOR_MANIFEST), 'utf8')
  .digest('hex')

type Candidate = Readonly<{
  start: number
  end: number
  placeholder: AiDetectedPlaceholder
}>

type ScanState = {
  candidates: Candidate[]
  blocked: AiStructuredMarkerBlockReason | null
}

function countScalars(value: string): number {
  let count = 0
  for (const _scalar of value) count += 1
  return count
}

function isScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0xd800 || unit > 0xdfff) continue
    if (
      unit > 0xdbff ||
      index + 1 >= value.length ||
      value.charCodeAt(index + 1) < 0xdc00 ||
      value.charCodeAt(index + 1) > 0xdfff
    ) {
      return false
    }
    index += 1
  }
  return true
}

function lookupFold(codePoint: number): string {
  let low = 0
  let high = AI_UNICODE_CASE_FOLDING_V17.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const entry = AI_UNICODE_CASE_FOLDING_V17[middle]
    if (!entry) break
    if (entry[0] === codePoint) return entry[1]
    if (entry[0] < codePoint) low = middle + 1
    else high = middle - 1
  }
  return String.fromCodePoint(codePoint)
}

export function foldAiMarkerText(value: string): string {
  let folded = ''
  for (const scalar of value) folded += lookupFold(scalar.codePointAt(0)!)
  return folded
}

function detectOverBoundCandidates(text: string, state: ScanState): void {
  for (const atom of text.split(/\s+/u)) {
    if (atom.length === 0) continue
    const scalarLength = countScalars(atom)
    if (
      (/^(?:https?:\/\/|www\.)/iu.test(atom) && scalarLength > 2048) ||
      (/^@[A-Za-z0-9_.]+$/u.test(atom) && scalarLength > 31) ||
      (/^[A-Fa-f0-9]+$/u.test(atom) && scalarLength > 128) ||
      (/^[A-Za-z0-9_+/=-]+$/u.test(atom) &&
        scalarLength > 256 &&
        isHighEntropyToken(atom.slice(0, 256)))
    ) {
      state.blocked = 'ambiguous_candidate'
      return
    }
  }
  for (const expression of [
    OVERBOUND_PHONE_RE,
    OVERBOUND_CARD_RE,
    OVERBOUND_IBAN_RE,
    OVERBOUND_COORDINATE_RE,
  ] as const) {
    forEachMatch(expression, text, () => {
      state.blocked = 'ambiguous_candidate'
    })
  }
  if (OVERBOUND_LABELLED_ID_RE.test(text)) state.blocked = 'ambiguous_candidate'
  OVERBOUND_LABELLED_ID_RE.lastIndex = 0
  if (countScalars(text) > 256 && /\p{N}/u.test(text) && ADDRESS_HINT_RE.test(text)) {
    state.blocked = 'ambiguous_candidate'
  }
}

function addCandidate(
  state: ScanState,
  text: string,
  start: number,
  end: number,
  placeholder: AiDetectedPlaceholder,
  maximumScalars: number,
): void {
  if (state.blocked !== null || start < 0 || end <= start || end > text.length) return
  const scalarLength = countScalars(text.slice(start, end))
  if (scalarLength > maximumScalars) {
    state.blocked = 'ambiguous_candidate'
    return
  }
  state.candidates.push({ start, end, placeholder })
  if (state.candidates.length > MAX_AI_STRUCTURED_MARKER_CANDIDATES_V1 * 8) {
    state.blocked = 'candidate_limit_exceeded'
  }
}

function forEachMatch(
  expression: RegExp,
  text: string,
  visitor: (match: RegExpExecArray) => void,
): void {
  expression.lastIndex = 0
  for (;;) {
    const match = expression.exec(text)
    if (match === null) return
    visitor(match)
    if (match[0].length === 0) expression.lastIndex += 1
  }
}

function trimUrlEnd(value: string): string {
  let end = value.length
  while (end > 0 && /[.,!?;:)}\]]/u.test(value[end - 1]!)) end -= 1
  return value.slice(0, end)
}

function validDomain(domain: string): boolean {
  const ascii = domainToASCII(domain)
  if (ascii.length < 1 || ascii.length > 253 || !ascii.includes('.')) return false
  const labels = ascii.split('.')
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      !label.startsWith('-') &&
      !label.endsWith('-') &&
      /^[A-Za-z0-9-]+$/u.test(label),
  )
}

function validEmail(value: string): boolean {
  if (countScalars(value) > 254) return false
  const separator = value.indexOf('@')
  if (separator <= 0 || separator !== value.lastIndexOf('@')) return false
  const local = value.slice(0, separator)
  const domain = value.slice(separator + 1)
  if (
    countScalars(local) > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  ) {
    return false
  }
  return validDomain(domain)
}

function scanEmails(text: string, state: ScanState): void {
  forEachMatch(EMAIL_RE, text, (match) => {
    const value = match[0]
    if (validEmail(value))
      addCandidate(state, text, match.index, match.index + value.length, '[CONTACT]', 254)
  })
  forEachMatch(RECONSTRUCTED_EMAIL_RE, text, (match) => {
    if (!/[ \t][@.]|[@.][ \t]/u.test(match[0])) return
    if (
      state.candidates.some(
        (candidate) =>
          candidate.placeholder === '[CONTACT]' && candidate.start === match.index,
      )
    ) {
      return
    }
    forEachMatch(SPACED_DOT_RE, match[0], (separator) => {
      const prefix = match[0].slice(0, separator.index).replace(/[ \t]/gu, '')
      if (validEmail(prefix)) state.blocked = 'ambiguous_candidate'
    })
    if (state.blocked !== null) return
    const compact = match[0].replace(/[ \t]/gu, '')
    if (validEmail(compact)) {
      addCandidate(
        state,
        text,
        match.index,
        match.index + match[0].length,
        '[CONTACT]',
        254,
      )
    }
  })
  for (const atom of text.split(/\s+/u)) {
    if (!atom.includes('@') || !atom.includes('.')) continue
    const at = atom.indexOf('@')
    if (countScalars(atom) > 254 || at > 64 || atom.length - at - 1 > 253) {
      state.blocked = 'ambiguous_candidate'
      return
    }
  }
}

function validHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(/^www\./iu.test(value) ? `https://${value}` : value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username === '' &&
      parsed.password === '' &&
      validDomain(parsed.hostname)
    )
  } catch {
    return false
  }
}

function scanUrlsAndDomains(text: string, state: ScanState): void {
  forEachMatch(URL_RE, text, (match) => {
    const value = trimUrlEnd(match[0])
    if (validHttpUrl(value)) {
      addCandidate(
        state,
        text,
        match.index,
        match.index + value.length,
        '[CONTACT]',
        2048,
      )
    }
  })
  forEachMatch(RECONSTRUCTED_URL_RE, text, (match) => {
    if (
      state.candidates.some(
        (candidate) =>
          candidate.placeholder === '[CONTACT]' && candidate.start === match.index,
      )
    ) {
      return
    }
    forEachMatch(SPACED_DOT_RE, match[0], (separator) => {
      const prefix = match[0].slice(0, separator.index).replace(/[ \t]/gu, '')
      if (validHttpUrl(prefix)) state.blocked = 'ambiguous_candidate'
    })
    if (state.blocked !== null) return
    const compact = trimUrlEnd(match[0]).replace(/[ \t]/gu, '')
    if (validHttpUrl(compact)) {
      addCandidate(
        state,
        text,
        match.index,
        match.index + match[0].length,
        '[CONTACT]',
        2048,
      )
    }
  })
  forEachMatch(BARE_DOMAIN_RE, text, (match) => {
    const value = match[1]
    if (value === undefined || !validDomain(value)) return
    const relative = match[0].lastIndexOf(value)
    const start = match.index + relative
    addCandidate(state, text, start, start + value.length, '[CONTACT]', 2048)
  })
}

function scanSocialHandles(text: string, state: ScanState): void {
  forEachMatch(SOCIAL_RE, text, (match) => {
    const value = match[1]
    if (value === undefined) return
    const relative = match[0].lastIndexOf(value)
    const start = match.index + relative
    addCandidate(state, text, start, start + value.length, '[CONTACT]', 31)
  })
}

function normalizeDecimalDigits(value: string): string | null {
  let normalized = ''
  for (const scalar of value) {
    if (!/\p{Nd}/u.test(scalar)) {
      normalized += scalar
      continue
    }
    const codePoint = scalar.codePointAt(0)!
    let runStart = codePoint
    while (
      runStart > 0 &&
      codePoint - runStart < 100 &&
      /\p{Nd}/u.test(String.fromCodePoint(runStart - 1))
    ) {
      runStart -= 1
    }
    const numeric = (codePoint - runStart) % 10
    if (numeric < 0 || numeric > 9) return null
    normalized += String(numeric)
  }
  return normalized
}

function scanPhones(text: string, countryCode: CountryCode, state: ScanState): void {
  forEachMatch(PHONE_RE, text, (match) => {
    const raw = match[1]
    if (raw === undefined) return
    const value = normalizeDecimalDigits(raw)
    if (value === null) {
      state.blocked = 'scanner_unavailable'
      return
    }
    const digits = value.replace(/\D/gu, '')
    if (digits.length < 7 || digits.length > 15) return
    const start = match.index + match[0].lastIndexOf(raw)
    try {
      const parsed = value.trimStart().startsWith('+')
        ? parsePhoneNumberFromString(value)
        : parsePhoneNumberFromString(value, countryCode)
      if (parsed?.isValid() === true) {
        addCandidate(state, text, start, start + raw.length, '[CONTACT]', 32)
      }
    } catch {
      state.blocked = 'scanner_unavailable'
    }
  })
}

function decimalMagnitudeWithin(value: string, maximum: bigint): boolean {
  const unsigned = value.startsWith('+') || value.startsWith('-') ? value.slice(1) : value
  const [whole, fraction] = unsigned.split('.')
  if (
    whole === undefined ||
    fraction === undefined ||
    !/^\d+$/u.test(whole) ||
    !/^\d+$/u.test(fraction)
  ) {
    return false
  }
  const scale = 10n ** BigInt(fraction.length)
  const numerator = BigInt(whole) * scale + BigInt(fraction)
  return numerator <= maximum * scale
}

function scanIpsAndCoordinates(text: string, state: ScanState): void {
  forEachMatch(IP_TOKEN_RE, text, (match) => {
    const raw = match[1]
    if (raw === undefined) return
    const candidate = raw.endsWith('.') ? raw.slice(0, -1) : raw
    const value =
      candidate.startsWith('[') && candidate.endsWith(']')
        ? candidate.slice(1, -1)
        : candidate
    if (isIP(value) === 0) return
    const start = match.index + match[0].lastIndexOf(raw)
    addCandidate(state, text, start, start + candidate.length, '[CONTACT]', 64)
  })
  forEachMatch(COORDINATE_RE, text, (match) => {
    const value = match[1]
    if (value === undefined) return
    const [latitudeText, longitudeText] = value.split(',').map((entry) => entry.trim())
    if (
      latitudeText === undefined ||
      longitudeText === undefined ||
      !decimalMagnitudeWithin(latitudeText, 90n) ||
      !decimalMagnitudeWithin(longitudeText, 180n)
    ) {
      return
    }
    const start = match.index + match[0].lastIndexOf(value)
    addCandidate(state, text, start, start + value.length, '[ADDRESS]', 64)
  })
}

function luhnValid(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 0x30
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

function ibanValid(value: string): boolean {
  const compact = value.replace(/[ -]/gu, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(compact) || compact.length > 34) {
    return false
  }
  const rearranged = compact.slice(4) + compact.slice(0, 4)
  let remainder = 0
  for (const character of rearranged) {
    const expanded = /[A-Z]/u.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

function scanFinancial(text: string, state: ScanState): void {
  forEachMatch(CARD_RE, text, (match) => {
    const raw = match[1]
    if (raw === undefined) return
    const normalized = normalizeDecimalDigits(raw)
    if (normalized === null) {
      state.blocked = 'scanner_unavailable'
      return
    }
    const digits = normalized.replace(/\D/gu, '')
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return
    const start = match.index + match[0].lastIndexOf(raw)
    addCandidate(state, text, start, start + raw.length, '[FINANCIAL]', 64)
  })
  forEachMatch(IBAN_RE, text, (match) => {
    const raw = match[1]
    if (raw === undefined || !ibanValid(raw)) return
    const start = match.index + match[0].lastIndexOf(raw)
    addCandidate(state, text, start, start + raw.length, '[FINANCIAL]', 64)
  })
}

function scanIdentifiersAndAddresses(text: string, state: ScanState): void {
  forEachMatch(LABELLED_ID_RE, text, (match) => {
    addCandidate(
      state,
      text,
      match.index,
      match.index + match[0].length,
      '[IDENTIFIER]',
      256,
    )
  })
  for (const expression of [POSTAL_LABEL_RE, ADDRESS_RE] as const) {
    forEachMatch(expression, text, (match) => {
      addCandidate(
        state,
        text,
        match.index,
        match.index + match[0].length,
        '[ADDRESS]',
        256,
      )
    })
  }
}

function isCanonicalBase64Like(value: string): boolean {
  try {
    const paddingMatch = /=+$/u.exec(value)
    const paddingLength = paddingMatch?.[0].length ?? 0
    if (
      paddingLength > 2 ||
      value.slice(0, value.length - paddingLength).includes('=') ||
      (/[+/]/u.test(value) && /[-_]/u.test(value))
    ) {
      return false
    }
    const unpadded = value.slice(0, value.length - paddingLength)
    if (unpadded.length % 4 === 1) return false
    const urlAlphabet = /[-_]/u.test(unpadded)
    const decoded = Buffer.from(unpadded, urlAlphabet ? 'base64url' : 'base64')
    if (decoded.byteLength < 16) return false
    const canonicalUnpadded = urlAlphabet
      ? decoded.toString('base64url')
      : decoded.toString('base64').replace(/=+$/u, '')
    const canonicalPadded =
      canonicalUnpadded + '='.repeat((4 - (canonicalUnpadded.length % 4)) % 4)
    return value === canonicalUnpadded || value === canonicalPadded
  } catch {
    return false
  }
}

function isHighEntropyToken(value: string): boolean {
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[_+/=-]/u].filter((pattern) =>
    pattern.test(value),
  ).length
  return classes >= 3 && new Set(value).size >= 12 && isCanonicalBase64Like(value)
}

function scanSecrets(text: string, state: ScanState): void {
  forEachMatch(KNOWN_SECRET_RE, text, (match) => {
    const raw = match[1]
    if (raw === undefined) return
    const start = match.index + match[0].lastIndexOf(raw)
    addCandidate(state, text, start, start + raw.length, '[SECRET]', 256)
  })
  forEachMatch(HEX_SECRET_RE, text, (match) => {
    const raw = match[1]
    if (raw === undefined) return
    const start = match.index + match[0].lastIndexOf(raw)
    addCandidate(state, text, start, start + raw.length, '[SECRET]', 128)
  })
  forEachMatch(ENTROPY_TOKEN_RE, text, (match) => {
    const raw = match[1]
    if (raw === undefined || !isHighEntropyToken(raw)) return
    const start = match.index + match[0].lastIndexOf(raw)
    addCandidate(state, text, start, start + raw.length, '[SECRET]', 256)
  })
}

function resolveCandidates(
  text: string,
  candidates: readonly Candidate[],
): AiStructuredMarkerScanResult {
  const sorted = [...candidates].sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start
    const lengthOrder = right.end - right.start - (left.end - left.start)
    if (lengthOrder !== 0) return lengthOrder
    return (
      PLACEHOLDER_PRIORITY[left.placeholder] - PLACEHOLDER_PRIORITY[right.placeholder]
    )
  })
  const resolved: Candidate[] = []
  for (const candidate of sorted) {
    const prior = resolved.at(-1)
    if (prior === undefined || candidate.start >= prior.end) {
      resolved.push(candidate)
      continue
    }
    const priorContains = prior.start <= candidate.start && prior.end >= candidate.end
    const candidateContains = candidate.start <= prior.start && candidate.end >= prior.end
    if (prior.placeholder === candidate.placeholder) {
      resolved[resolved.length - 1] = {
        start: Math.min(prior.start, candidate.start),
        end: Math.max(prior.end, candidate.end),
        placeholder: prior.placeholder,
      }
      continue
    }
    if (!priorContains && !candidateContains) {
      return { status: 'blocked', reason: 'ambiguous_candidate' }
    }
    const placeholder =
      PLACEHOLDER_PRIORITY[candidate.placeholder] <
      PLACEHOLDER_PRIORITY[prior.placeholder]
        ? candidate.placeholder
        : prior.placeholder
    resolved[resolved.length - 1] = {
      start: Math.min(prior.start, candidate.start),
      end: Math.max(prior.end, candidate.end),
      placeholder,
    }
  }
  if (resolved.length > MAX_AI_STRUCTURED_MARKER_CANDIDATES_V1) {
    return { status: 'blocked', reason: 'candidate_limit_exceeded' }
  }
  const intervals = resolved.map((candidate) =>
    Object.freeze({
      startUtf16: candidate.start,
      endUtf16: candidate.end,
      scalarLength: countScalars(text.slice(candidate.start, candidate.end)),
      placeholder: candidate.placeholder,
    }),
  )
  return Object.freeze({
    status: 'safe' as const,
    intervals: Object.freeze(intervals),
    candidateCount: intervals.length,
  })
}

export function scanStructuredMarkerCandidates(
  input: AiStructuredMarkerScanInput,
): AiStructuredMarkerScanResult {
  if (
    input.expectedProfileVersion !== AI_STRUCTURED_MARKER_DETECTORS_VERSION ||
    input.expectedProfileDigest !== AI_STRUCTURED_MARKER_DETECTORS_DIGEST
  ) {
    return { status: 'blocked', reason: 'profile_mismatch' }
  }
  if (typeof input.text !== 'string' || !isScalarString(input.text)) {
    return { status: 'blocked', reason: 'invalid_unicode' }
  }
  if (input.text !== input.text.normalize('NFKC')) {
    return { status: 'blocked', reason: 'noncanonical_unicode' }
  }
  if (countScalars(input.text) > MAX_AI_STRUCTURED_MARKER_INPUT_SCALARS_V1) {
    return { status: 'blocked', reason: 'input_too_large' }
  }
  if (!/^[A-Z]{2}$/u.test(input.countryCode) || !COUNTRY_CODES.has(input.countryCode)) {
    return { status: 'blocked', reason: 'invalid_country' }
  }

  try {
    const state: ScanState = { candidates: [], blocked: null }
    detectOverBoundCandidates(input.text, state)
    if (state.blocked !== null) return { status: 'blocked', reason: state.blocked }
    scanEmails(input.text, state)
    scanUrlsAndDomains(input.text, state)
    scanSocialHandles(input.text, state)
    scanPhones(input.text, input.countryCode as CountryCode, state)
    scanIpsAndCoordinates(input.text, state)
    scanFinancial(input.text, state)
    scanIdentifiersAndAddresses(input.text, state)
    scanSecrets(input.text, state)
    if (state.blocked !== null) return { status: 'blocked', reason: state.blocked }
    return resolveCandidates(input.text, state.candidates)
  } catch {
    return { status: 'blocked', reason: 'scanner_unavailable' }
  }
}
