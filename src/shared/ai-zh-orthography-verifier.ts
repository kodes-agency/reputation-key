import manifest from './ai-zh-orthography-profile-v1.manifest.json'
import {
  AI_ZH_ORTHOGRAPHY_EVIDENCE,
  AI_ZH_ORTHOGRAPHY_EVIDENCE_ROW_COUNT,
  AI_ZH_ORTHOGRAPHY_TABLE_DIGEST,
} from './generated/ai-zh-orthography-v1'

export const AI_ZH_ORTHOGRAPHY_VERSION = 'zh-orthography-verifier-v1' as const
export const MIN_ZH_ORTHOGRAPHY_DECISIVE_LETTERS_V1 = 4 as const

export type ZhOrthographyScript = 'Hans' | 'Hant'
export type ZhOrthographyResult =
  | Readonly<{
      status: 'accepted' | 'rejected' | 'insufficient_evidence'
      simplifiedCount: number
      traditionalCount: number
    }>
  | Readonly<{ status: 'policy_unavailable' }>

function invalidUnicodeScalar(codePoint: number): boolean {
  return (
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint & 0xffff) === 0xfffe ||
    (codePoint & 0xffff) === 0xffff
  )
}

/** 0 means no decisive evidence, 1 simplified, and 2 traditional. */
export function lookupZhOrthographyEvidence(codePoint: number): 0 | 1 | 2 {
  let low = 0
  let high = AI_ZH_ORTHOGRAPHY_EVIDENCE_ROW_COUNT - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const offset = middle * 2
    const candidate = AI_ZH_ORTHOGRAPHY_EVIDENCE[offset]!
    if (codePoint < candidate) high = middle - 1
    else if (codePoint > candidate) low = middle + 1
    else return AI_ZH_ORTHOGRAPHY_EVIDENCE[offset + 1] as 1 | 2
  }
  return 0
}

export function evaluateZhOrthography(
  text: string,
  expectedScript: ZhOrthographyScript,
): ZhOrthographyResult {
  if (
    process.versions.unicode !== manifest.unicodeVersion.replace(/\.0$/, '') ||
    process.versions.icu !== manifest.icuVersion
  ) {
    return { status: 'policy_unavailable' }
  }
  if (text.normalize('NFKC') !== text) return { status: 'policy_unavailable' }
  let simplifiedCount = 0
  let traditionalCount = 0
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined || invalidUnicodeScalar(codePoint)) {
      return { status: 'policy_unavailable' }
    }
    index += codePoint > 0xffff ? 2 : 1
    const evidence = lookupZhOrthographyEvidence(codePoint)
    if (evidence === 1) simplifiedCount += 1
    else if (evidence === 2) traditionalCount += 1
  }

  const decisiveCount = simplifiedCount + traditionalCount
  if (decisiveCount < MIN_ZH_ORTHOGRAPHY_DECISIVE_LETTERS_V1) {
    return { status: 'insufficient_evidence', simplifiedCount, traditionalCount }
  }
  const expectedCount = expectedScript === 'Hans' ? simplifiedCount : traditionalCount
  return {
    status: 5 * expectedCount >= 4 * decisiveCount ? 'accepted' : 'rejected',
    simplifiedCount,
    traditionalCount,
  }
}

if (
  manifest.version !== AI_ZH_ORTHOGRAPHY_VERSION ||
  manifest.table.profileDigest !== AI_ZH_ORTHOGRAPHY_TABLE_DIGEST ||
  !/^[a-f0-9]{64}$/.test(manifest.attestationDigest)
) {
  throw new Error('Chinese orthography manifest/table drift')
}

export const AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST = manifest.attestationDigest
