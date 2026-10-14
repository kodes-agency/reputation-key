import { AI_UNICODE_CASE_FOLDING_V17 } from './generated/ai-unicode-case-folding-v17'

export const AI_REVIEW_SOURCE_CONTRACT_VERSION = 'ai-source-v1' as const
export const MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1 = 16_384
export const MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1 = 65_536

/**
 * The rules that turn raw provider text into canonical text have had two
 * revisions inside `ai-source-v1`. The byte layout (`encodeSource`) and the
 * digest domain (`ai-source-v1\0`) are the same in both, so a review whose text
 * the revisions treat alike keeps its stored digest.
 *
 * 1. Every control and bidirectional-control character is deleted. A line break
 *    or tab between two words fused them (`clean.\nStaff` became `clean.Staff`),
 *    and the redactor then read the fusion as a domain name.
 * 2. A run of line breaks and tabs between two words becomes one space (at the
 *    start or end of the text, or beside a space, it is still deleted), the
 *    other controls and bidi marks are still deleted, the Unicode noncharacters
 *    the gateway refuses become U+FFFD, and the text is normalized again after
 *    the deletions so that it is NFKC-stable (a bidi mark between a letter and
 *    its accent no longer makes the canonicalizer throw).
 *
 * `AI_SOURCE_CANONICALIZER_DIGEST_V1` (`ai-source-profile.ts`) names the
 * revision a binding was made under. Revision 1 stays reproducible only so that
 * a stored `ai_source_digest` written under it can still be recognised until the
 * Review is next observed; see `matchStoredAiReviewSourceProvenance`.
 */
export const AI_SOURCE_TEXT_REVISION = 2
type SourceTextRevision = 1 | typeof AI_SOURCE_TEXT_REVISION

const encoder = new TextEncoder()
function isControlOrBidi(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x61c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  )
}

function stripControlOrBidi(value: string): string {
  let clean = ''
  let cleanStart = 0
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)
    if (codePoint === undefined) break
    const scalarLength = codePoint > 0xffff ? 2 : 1
    if (isControlOrBidi(codePoint)) {
      clean += value.slice(cleanStart, index)
      cleanStart = index + scalarLength
    }
    index += scalarLength - 1
  }
  return cleanStart === 0 ? value : clean + value.slice(cleanStart)
}

/** Tab, line feed, vertical tab, form feed, carriage return, next line. */
function isWhitespaceControl(codePoint: number): boolean {
  return (codePoint >= 0x09 && codePoint <= 0x0d) || codePoint === 0x85
}

/** U+FDD0..U+FDEF and the last two code points of every plane. */
function isNoncharacter(codePoint: number): boolean {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe
}

const REPLACEMENT_CHARACTER = '\ufffd'
const WHITESPACE_SCALAR = /^\s$/u

/** Revision 2 of the control rules; the input is a valid scalar string. */
function separateAndStripControls(value: string): string {
  let clean = ''
  let lastScalar = ''
  let breakPending = false
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)!
    if (isWhitespaceControl(codePoint)) {
      breakPending = true
      continue
    }
    if (isControlOrBidi(codePoint)) continue
    if (
      breakPending &&
      lastScalar !== '' &&
      !WHITESPACE_SCALAR.test(lastScalar) &&
      !WHITESPACE_SCALAR.test(scalar)
    ) {
      clean += ' '
    }
    breakPending = false
    lastScalar = isNoncharacter(codePoint) ? REPLACEMENT_CHARACTER : scalar
    clean += lastScalar
  }
  return clean
}

function containsControlOrBidi(value: string): boolean {
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)
    if (codePoint !== undefined && isControlOrBidi(codePoint)) return true
  }
  return false
}

function containsNoncharacter(value: string): boolean {
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)
    if (codePoint !== undefined && isNoncharacter(codePoint)) return true
  }
  return false
}

function isAsciiLetter(codePoint: number): boolean {
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a)
  )
}

function isAsciiAlphanumeric(codePoint: number): boolean {
  return isAsciiLetter(codePoint) || (codePoint >= 0x30 && codePoint <= 0x39)
}

function isBoundedLanguageTag(value: string): boolean {
  let segmentStart = 0
  let segmentIndex = 0
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value.charCodeAt(index) !== 0x2d) continue
    const segmentLength = index - segmentStart
    const minimum = segmentIndex === 0 ? 2 : 1
    if (segmentLength < minimum || segmentLength > 8) return false
    for (let cursor = segmentStart; cursor < index; cursor += 1) {
      const codePoint = value.charCodeAt(cursor)
      if (
        segmentIndex === 0 ? !isAsciiLetter(codePoint) : !isAsciiAlphanumeric(codePoint)
      ) {
        return false
      }
    }
    segmentIndex += 1
    segmentStart = index + 1
  }
  return segmentIndex > 0
}
const CLOSED_PLACEHOLDER = /\[(PERSON|CONTACT|ADDRESS|FINANCIAL|IDENTIFIER|SECRET)\]/gu
const FORBIDDEN_CANONICAL_PLACEHOLDER =
  /\[(CONTACT|ADDRESS|FINANCIAL|IDENTIFIER|SECRET)\]/u
const RAW_PLACEHOLDER_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
  PERSON: '{#1#}',
  CONTACT: '{#2#}',
  ADDRESS: '{#3#}',
  FINANCIAL: '{#4#}',
  IDENTIFIER: '{#5#}',
  SECRET: '{#6#}',
})

declare const canonicalAiReviewSourceBrand: unique symbol

export type CanonicalAiReviewSource = Readonly<{
  text: string | null
  rating: number
  languageCode: string | null
  reviewedAtEpochMillis: number
  bytes: Uint8Array
  [canonicalAiReviewSourceBrand]: true
}>

export type RawAiReviewSource = Readonly<{
  text: string | null
  rating: number
  languageCode: string | null
  reviewedAtEpochMillis: number
  reviewerDisplayName: string | null
}>

export type IdentityMinimizedAiReviewSource = Readonly<{
  text: string | null
  rating: number
  languageCode: string | null
  reviewedAtEpochMillis: number
}>

type FoldedScalar = Readonly<{
  sourceStart: number
  sourceEnd: number
  foldedStart: number
  foldedEnd: number
}>

function fail(message: string): never {
  throw new TypeError(`Invalid ${AI_REVIEW_SOURCE_CONTRACT_VERSION} input: ${message}`)
}

function assertScalarString(value: string, field: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) continue
    if (
      codeUnit > 0xdbff ||
      index + 1 >= value.length ||
      value.charCodeAt(index + 1) < 0xdc00 ||
      value.charCodeAt(index + 1) > 0xdfff
    ) {
      fail(`${field} contains an unpaired surrogate`)
    }
    index += 1
  }
}

/** Free text: the review and the reviewer's display name. */
function normalizeRawText(value: string, field: string, revision: SourceTextRevision) {
  assertScalarString(value, field)
  const normalized =
    revision === 1
      ? stripControlOrBidi(value.normalize('NFKC'))
      : separateAndStripControls(value.normalize('NFKC')).normalize('NFKC')
  assertScalarString(normalized, field)
  return normalized
}

/** The language tag: controls are deleted in both revisions. */
function normalizeRawTag(value: string, field: string): string {
  assertScalarString(value, field)
  const normalized = stripControlOrBidi(value.normalize('NFKC'))
  assertScalarString(normalized, field)
  return normalized
}

function validateCanonicalString(
  value: string,
  field: string,
  revision: SourceTextRevision,
): void {
  assertScalarString(value, field)
  if (value !== value.normalize('NFKC')) fail(`${field} is not NFKC-normalized`)
  if (containsControlOrBidi(value)) {
    fail(`${field} contains control or bidi characters`)
  }
  if (revision !== 1 && containsNoncharacter(value)) {
    fail(`${field} contains Unicode noncharacters`)
  }
}

function validateFields(
  input: IdentityMinimizedAiReviewSource,
  revision: SourceTextRevision,
): void {
  if (!Number.isSafeInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    fail('rating must be an integer from 1 through 5')
  }
  if (
    !Number.isSafeInteger(input.reviewedAtEpochMillis) ||
    input.reviewedAtEpochMillis < 0
  ) {
    fail('reviewedAtEpochMillis must be a nonnegative safe integer')
  }
  if (input.text !== null) validateCanonicalString(input.text, 'text', revision)
  if (input.languageCode !== null) {
    validateCanonicalString(input.languageCode, 'languageCode', revision)
    if (
      input.languageCode.length === 0 ||
      input.languageCode.length > 35 ||
      !isBoundedLanguageTag(input.languageCode)
    ) {
      fail('languageCode is not a bounded BCP 47 language tag')
    }
  }
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

function foldWithIntervals(value: string): Readonly<{
  folded: string
  scalars: ReadonlyArray<FoldedScalar>
}> {
  const foldedParts: string[] = []
  const scalars: FoldedScalar[] = []
  let sourceOffset = 0
  let foldedOffset = 0
  for (const scalar of value) {
    const folded = lookupFold(scalar.codePointAt(0)!)
    const nextSourceOffset = sourceOffset + scalar.length
    const nextFoldedOffset = foldedOffset + folded.length
    foldedParts.push(folded)
    scalars.push(
      Object.freeze({
        sourceStart: sourceOffset,
        sourceEnd: nextSourceOffset,
        foldedStart: foldedOffset,
        foldedEnd: nextFoldedOffset,
      }),
    )
    sourceOffset = nextSourceOffset
    foldedOffset = nextFoldedOffset
  }
  return Object.freeze({ folded: foldedParts.join(''), scalars: Object.freeze(scalars) })
}

function fold(value: string): string {
  let result = ''
  for (const scalar of value) result += lookupFold(scalar.codePointAt(0)!)
  return result
}

function escapeRawPlaceholders(value: string): string {
  return value.replace(
    CLOSED_PLACEHOLDER,
    (_token, kind: string) => RAW_PLACEHOLDER_REPLACEMENTS[kind] ?? fail('placeholder'),
  )
}

function minimizeReviewerIdentity(text: string, reviewerDisplayName: string): string {
  const nameFolded = fold(reviewerDisplayName)
  if (nameFolded.length === 0) return escapeRawPlaceholders(text)

  const foldedText = foldWithIntervals(text)
  const startBoundaries = new Map<number, number>()
  const endBoundaries = new Map<number, number>()
  for (const [index, scalar] of foldedText.scalars.entries()) {
    startBoundaries.set(scalar.foldedStart, index)
    endBoundaries.set(scalar.foldedEnd, index)
  }

  const rendered: string[] = []
  let sourceCursor = 0
  let foldedCursor = 0
  while (foldedCursor <= foldedText.folded.length - nameFolded.length) {
    const matchStart = foldedText.folded.indexOf(nameFolded, foldedCursor)
    if (matchStart < 0) break
    const matchEnd = matchStart + nameFolded.length
    const firstScalarIndex = startBoundaries.get(matchStart)
    const lastScalarIndex = endBoundaries.get(matchEnd)
    if (firstScalarIndex === undefined || lastScalarIndex === undefined) {
      foldedCursor = matchStart + 1
      continue
    }
    const firstScalar = foldedText.scalars[firstScalarIndex]!
    const lastScalar = foldedText.scalars[lastScalarIndex]!
    rendered.push(
      escapeRawPlaceholders(text.slice(sourceCursor, firstScalar.sourceStart)),
    )
    rendered.push('[PERSON]')
    sourceCursor = lastScalar.sourceEnd
    foldedCursor = lastScalar.foldedEnd
  }
  rendered.push(escapeRawPlaceholders(text.slice(sourceCursor)))
  return rendered.join('')
}

function encodeNullableString(value: string | null): Uint8Array {
  if (value === null) return Uint8Array.of(0)
  const bytes = encoder.encode(value)
  if (bytes.byteLength > 0xffff_ffff) fail('string exceeds uint32 byte length')
  const encoded = new Uint8Array(5 + bytes.byteLength)
  encoded[0] = 1
  new DataView(encoded.buffer).setUint32(1, bytes.byteLength, false)
  encoded.set(bytes, 5)
  return encoded
}

function encodeSource(input: IdentityMinimizedAiReviewSource): Uint8Array {
  const text = encodeNullableString(input.text)
  const languageCode = encodeNullableString(input.languageCode)
  const byteLength = 1 + text.byteLength + 1 + languageCode.byteLength + 8
  if (byteLength > MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1) {
    fail('canonical source exceeds the operation byte limit')
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  bytes[offset++] = 1
  bytes.set(text, offset)
  offset += text.byteLength
  bytes[offset++] = input.rating
  bytes.set(languageCode, offset)
  offset += languageCode.byteLength
  new DataView(bytes.buffer).setBigInt64(
    offset,
    BigInt(input.reviewedAtEpochMillis),
    false,
  )
  return bytes
}

function finalize(
  input: IdentityMinimizedAiReviewSource,
  revision: SourceTextRevision,
): CanonicalAiReviewSource {
  validateFields(input, revision)
  if (input.text !== null && FORBIDDEN_CANONICAL_PLACEHOLDER.test(input.text)) {
    fail('identity-minimized text contains a forbidden closed placeholder')
  }
  return Object.freeze({
    ...input,
    bytes: encodeSource(input),
  }) as CanonicalAiReviewSource
}

function canonicalizeRaw(
  input: RawAiReviewSource,
  revision: SourceTextRevision,
): CanonicalAiReviewSource {
  if (input.text !== null) assertScalarString(input.text, 'text')
  if (input.languageCode !== null) assertScalarString(input.languageCode, 'languageCode')
  if (input.reviewerDisplayName !== null) {
    assertScalarString(input.reviewerDisplayName, 'reviewerDisplayName')
  }
  const rawByteLength =
    (input.text === null ? 0 : encoder.encode(input.text).byteLength) +
    (input.languageCode === null ? 0 : encoder.encode(input.languageCode).byteLength) +
    (input.reviewerDisplayName === null
      ? 0
      : encoder.encode(input.reviewerDisplayName).byteLength)
  if (rawByteLength > MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1) {
    fail('raw source exceeds the materialization byte limit')
  }
  const text = input.text === null ? null : normalizeRawText(input.text, 'text', revision)
  const displayName =
    input.text === null || input.reviewerDisplayName === null
      ? null
      : normalizeRawText(
          input.reviewerDisplayName,
          'reviewerDisplayName',
          revision,
        ).trim()
  const languageCode =
    input.languageCode === null
      ? null
      : normalizeRawTag(input.languageCode, 'languageCode')
  return finalize(
    {
      text:
        text === null || displayName === null || displayName.length === 0
          ? text === null
            ? null
            : escapeRawPlaceholders(text)
          : minimizeReviewerIdentity(text, displayName),
      rating: input.rating,
      languageCode,
      reviewedAtEpochMillis: input.reviewedAtEpochMillis,
    },
    revision,
  )
}

/** Review-writer entry point. Identity-minimizes raw provider source before encoding. */
export function canonicalizeRawAiReviewSource(
  input: RawAiReviewSource,
): CanonicalAiReviewSource {
  return canonicalizeRaw(input, AI_SOURCE_TEXT_REVISION)
}

/**
 * The canonical source revision 1 made of the same raw input. Only for
 * recognising a digest stored before revision 2 (`ai-review-source.ts`); it is
 * never what a model reads or what a new row stores.
 */
export function canonicalizeRawAiReviewSourcePreviousRevision(
  input: RawAiReviewSource,
): CanonicalAiReviewSource {
  return canonicalizeRaw(input, 1)
}

/** Gateway entry point. Verifies and encodes already identity-minimized source verbatim. */
export function encodeCanonicalAiReviewSource(
  input: IdentityMinimizedAiReviewSource,
): CanonicalAiReviewSource {
  return finalize(input, AI_SOURCE_TEXT_REVISION)
}
