import manifest from './ai-language-script-consistency-v1.manifest.json'
import {
  AI_LANGUAGE_SCRIPT_RANGES,
  AI_LANGUAGE_SCRIPT_RANGE_COUNT,
  AI_LANGUAGE_SCRIPT_TABLE_DIGEST as GENERATED_TABLE_DIGEST,
  AI_LANGUAGE_SCRIPT_ICU_VERSION,
  AI_LANGUAGE_SCRIPT_UNICODE_VERSION,
} from './generated/ai-language-script-extensions-v17'

export { GENERATED_TABLE_DIGEST as AI_LANGUAGE_SCRIPT_TABLE_DIGEST }

export const AI_LANGUAGE_SCRIPT_CONSISTENCY_VERSION =
  'language-script-consistency-v1' as const

const SCRIPT_MASK_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  Latn: 1,
  Cyrl: 2,
  Arab: 4,
  Hebr: 8,
  Deva: 16,
  Beng: 32,
  Taml: 64,
  Thai: 128,
  Hans: 256,
  Hant: 256,
  Jpan: 256 | 512 | 1024,
  Kore: 256 | 2048,
})

const CLOSED_PLACEHOLDERS = Object.freeze([
  '[PERSON]',
  '[CONTACT]',
  '[ADDRESS]',
  '[FINANCIAL]',
  '[IDENTIFIER]',
  '[SECRET]',
] as const)

export type LanguageScriptConsistencyResult =
  | Readonly<{
      status: 'consistent' | 'inconsistent'
      letterCount: number
      expectedScriptLetterCount: number
    }>
  | Readonly<{ status: 'policy_unavailable' }>

function isInvalidScalar(codePoint: number): boolean {
  return (
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint & 0xffff) === 0xfffe ||
    (codePoint & 0xffff) === 0xffff
  )
}

/** Returns -1 for a non-Letter scalar, otherwise the generated Script_Extensions bitset. */
export function lookupAiLetterScriptExtensions(codePoint: number): number {
  let low = 0
  let high = AI_LANGUAGE_SCRIPT_RANGE_COUNT - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const offset = middle * 3
    const start = AI_LANGUAGE_SCRIPT_RANGES[offset]!
    const end = AI_LANGUAGE_SCRIPT_RANGES[offset + 1]!
    if (codePoint < start) {
      high = middle - 1
    } else if (codePoint > end) {
      low = middle + 1
    } else {
      return AI_LANGUAGE_SCRIPT_RANGES[offset + 2]!
    }
  }
  return -1
}

function placeholderLengthAt(text: string, index: number): number {
  if (text.charCodeAt(index) !== 0x5b) return 0
  for (const placeholder of CLOSED_PLACEHOLDERS) {
    if (text.startsWith(placeholder, index)) return placeholder.length
  }
  return 0
}

function scriptCodeFromTag(tag: string): string | null {
  const firstHyphen = tag.indexOf('-')
  if (firstHyphen <= 0 || firstHyphen + 5 > tag.length) return null
  const code = tag.slice(firstHyphen + 1, firstHyphen + 5)
  if (tag.length > firstHyphen + 5 && tag.charCodeAt(firstHyphen + 5) !== 0x2d)
    return null
  return code
}

export function evaluateLanguageScriptConsistency(
  text: string,
  concreteTag: string,
): LanguageScriptConsistencyResult {
  if (
    process.versions.unicode !== AI_LANGUAGE_SCRIPT_UNICODE_VERSION.replace(/\.0$/, '') ||
    process.versions.icu !== AI_LANGUAGE_SCRIPT_ICU_VERSION
  ) {
    return { status: 'policy_unavailable' }
  }
  if (text.normalize('NFKC') !== text) return { status: 'policy_unavailable' }
  const scriptCode = scriptCodeFromTag(concreteTag)
  if (scriptCode === null || !Object.hasOwn(SCRIPT_MASK_BY_CODE, scriptCode)) {
    return { status: 'policy_unavailable' }
  }
  const expectedMask = SCRIPT_MASK_BY_CODE[scriptCode]!
  let letterCount = 0
  let expectedScriptLetterCount = 0

  for (let index = 0; index < text.length; ) {
    const placeholderLength = placeholderLengthAt(text, index)
    if (placeholderLength > 0) {
      index += placeholderLength
      continue
    }
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined || isInvalidScalar(codePoint)) {
      return { status: 'policy_unavailable' }
    }
    index += codePoint > 0xffff ? 2 : 1
    const scriptBits = lookupAiLetterScriptExtensions(codePoint)
    if (scriptBits < 0) continue
    letterCount += 1
    if ((scriptBits & expectedMask) !== 0) expectedScriptLetterCount += 1
  }

  return {
    status:
      letterCount > 0 && 5 * expectedScriptLetterCount >= 4 * letterCount
        ? 'consistent'
        : 'inconsistent',
    letterCount,
    expectedScriptLetterCount,
  }
}

if (
  manifest.version !== AI_LANGUAGE_SCRIPT_CONSISTENCY_VERSION ||
  manifest.unicodeVersion !== AI_LANGUAGE_SCRIPT_UNICODE_VERSION ||
  manifest.generatedTableDigest !== GENERATED_TABLE_DIGEST ||
  manifest.icuVersion !== AI_LANGUAGE_SCRIPT_ICU_VERSION ||
  !/^[a-f0-9]{64}$/.test(manifest.attestationDigest)
) {
  throw new Error('AI language Script_Extensions profile is unavailable')
}

export const AI_LANGUAGE_SCRIPT_CONSISTENCY_MANIFEST = Object.freeze(manifest)

export const AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST = manifest.attestationDigest
