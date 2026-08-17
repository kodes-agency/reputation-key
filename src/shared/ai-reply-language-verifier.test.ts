import { describe, expect, it } from 'vitest'
import { mapReviewLanguageMetadata } from './ai-review-language-catalogue'
import {
  AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
  type ReplyLanguageDetector,
  resolveConcreteReplyLanguage,
  verifyReplyLanguageOutput,
  verifyReplyTemplateCatalogueEntry,
} from './ai-reply-language-verifier'
const PINNED_LANGUAGE_RUNTIME =
  process.versions.unicode === '17.0' && process.versions.icu === '78.2'

function detector(
  language: string,
  probability = 0.85,
  reliable = true,
): ReplyLanguageDetector {
  return { detect: () => ({ language, probability, reliable }) }
}

function supported(metadata: string | null) {
  const result = mapReviewLanguageMetadata(metadata)
  if (result.status !== 'supported') throw new Error('test metadata must be supported')
  return result.language
}

const PRIMARY_CASES = [
  ['en-US', 'en', 'a'],
  ['es-MX', 'es', 'a'],
  ['fr-FR', 'fr', 'a'],
  ['de-DE', 'de', 'a'],
  ['pt-BR', 'pt', 'a'],
  ['it-IT', 'it', 'a'],
  ['nl-NL', 'nl', 'a'],
  ['pl-PL', 'pl', 'a'],
  ['tr-TR', 'tr', 'a'],
  ['uk-UA', 'uk', 'ж'],
  ['ru-RU', 'ru', 'ж'],
  ['ar-EG', 'ar', 'ع'],
  ['he-IL', 'iw', 'א'],
  ['hi-IN', 'hi', 'क'],
  ['bn-BD', 'bn', 'ক'],
  ['ta-IN', 'ta', 'அ'],
  ['th-TH', 'th', 'ก'],
  ['vi-VN', 'vi', 'a'],
  ['id-ID', 'id', 'a'],
  ['zh-CN', 'zh', '汉语龙马'],
  ['zh-TW', 'zh', '漢語龍馬'],
  ['ja-JP', 'ja', 'あ'],
  ['ko-KR', 'ko', '가'],
] as const

describe.runIf(PINNED_LANGUAGE_RUNTIME)('reply-language-verifier-v1', () => {
  it.each(PRIMARY_CASES)(
    'resolves %s with exact CLD3 primary %s',
    (metadata, primary, letter) => {
      const result = resolveConcreteReplyLanguage({
        text: letter.repeat(24),
        evaluatedLanguage: supported(metadata),
        detector: detector(primary),
      })
      const mapped = supported(metadata)
      expect(result).toMatchObject({
        status: 'resolved',
        language: { tag: mapped.tag, templateGroup: mapped.group },
      })
    },
  )

  it.each([23, 24, 25])('applies the 24-letter boundary at %i letters', (letterCount) => {
    const result = resolveConcreteReplyLanguage({
      text: 'a'.repeat(letterCount),
      evaluatedLanguage: supported('und'),
      detector: detector('en'),
    })
    expect(result.status).toBe(letterCount < 24 ? 'language_not_supported' : 'resolved')
    if (result.status === 'language_not_supported') {
      expect(result.reason).toBe('insufficient_language_evidence')
    }
  })

  it.each([
    [false, 0.99, 'insufficient_language_evidence'],
    [true, 0.849999, 'insufficient_language_evidence'],
    [true, 0.85, null],
    [true, 1, null],
  ] as const)(
    'enforces reliability=%s and confidence=%s',
    (reliable, probability, denial) => {
      const result = resolveConcreteReplyLanguage({
        text: 'a'.repeat(24),
        evaluatedLanguage: supported('und'),
        detector: detector('en', probability, reliable),
      })
      expect(result.status).toBe(denial === null ? 'resolved' : 'language_not_supported')
    },
  )

  it('rejects explicit primary mismatch and und/unmapped detector labels', () => {
    expect(
      resolveConcreteReplyLanguage({
        text: 'a'.repeat(24),
        evaluatedLanguage: supported('es-MX'),
        detector: detector('en'),
      }),
    ).toEqual({ status: 'language_not_supported', reason: 'metadata_language_mismatch' })
    for (const label of ['und', 'sw', '']) {
      expect(
        resolveConcreteReplyLanguage({
          text: 'a'.repeat(24),
          evaluatedLanguage: supported('und'),
          detector: detector(label),
        }),
      ).toEqual({
        status: 'language_not_supported',
        reason: 'insufficient_language_evidence',
      })
    }
  })

  it('retains explicit regions and infers region-free tags from und', () => {
    expect(
      resolveConcreteReplyLanguage({
        text: 'a'.repeat(24),
        evaluatedLanguage: supported('es-MX'),
        detector: detector('es'),
      }),
    ).toMatchObject({
      status: 'resolved',
      language: { tag: 'es-Latn-MX', templateGroup: 'es-Latn' },
    })
    expect(
      resolveConcreteReplyLanguage({
        text: 'a'.repeat(24),
        evaluatedLanguage: supported('und'),
        detector: detector('es'),
      }),
    ).toMatchObject({
      status: 'resolved',
      language: { tag: 'es-Latn', templateGroup: 'es-Latn' },
    })
  })

  it('requires decisive Chinese orthography and matching explicit script', () => {
    expect(
      resolveConcreteReplyLanguage({
        text: `汉龙马${'中'.repeat(21)}`,
        evaluatedLanguage: supported('und'),
        detector: detector('zh'),
      }),
    ).toEqual({
      status: 'language_not_supported',
      reason: 'insufficient_language_evidence',
    })
    expect(
      resolveConcreteReplyLanguage({
        text: `汉语龙马${'中'.repeat(20)}`,
        evaluatedLanguage: supported('und'),
        detector: detector('zh'),
      }),
    ).toMatchObject({
      status: 'resolved',
      language: { tag: 'zh-Hans', templateGroup: 'zh-Hans' },
    })
    expect(
      resolveConcreteReplyLanguage({
        text: `漢語龍馬${'中'.repeat(20)}`,
        evaluatedLanguage: supported('zh-CN'),
        detector: detector('zh'),
      }),
    ).toEqual({ status: 'language_not_supported', reason: 'metadata_language_mismatch' })
  })

  it('rejects 79% source script consistency and accepts 80%', () => {
    for (const [latin, accepted] of [
      [79, false],
      [80, true],
    ] as const) {
      const result = resolveConcreteReplyLanguage({
        text: `${'a'.repeat(latin)}${'ж'.repeat(100 - latin)}`,
        evaluatedLanguage: supported('en'),
        detector: detector('en'),
      })
      expect(result.status).toBe(accepted ? 'resolved' : 'language_not_supported')
    }
  })

  it('maps detector exceptions to policy_unavailable', () => {
    expect(
      resolveConcreteReplyLanguage({
        text: 'a'.repeat(24),
        evaluatedLanguage: supported('en'),
        detector: {
          detect: () => {
            throw new Error('fault')
          },
        },
      }),
    ).toEqual({ status: 'policy_unavailable' })
  })

  it('verifies output against exact expected primary, script, orthography, and 24 letters', () => {
    const resolved = resolveConcreteReplyLanguage({
      text: 'a'.repeat(24),
      evaluatedLanguage: supported('en'),
      detector: detector('en'),
    })
    if (resolved.status !== 'resolved') throw new Error('test language must resolve')
    expect(
      verifyReplyLanguageOutput('a'.repeat(24), resolved.language, detector('en')),
    ).toEqual({ status: 'valid' })
    expect(
      verifyReplyLanguageOutput('a'.repeat(23), resolved.language, detector('en')),
    ).toEqual({ status: 'output_invalid' })
    expect(
      verifyReplyLanguageOutput('a'.repeat(24), resolved.language, detector('es')),
    ).toEqual({ status: 'output_invalid' })
  })

  it('exposes a deterministic verifier profile digest', () => {
    expect(AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe.runIf(!PINNED_LANGUAGE_RUNTIME)(
  'reply-language-verifier-v1 runtime fence',
  () => {
    it('rejects catalogue output validation on a non-pinned ICU runtime', () => {
      expect(
        verifyReplyTemplateCatalogueEntry('a'.repeat(24), 'en-Latn', detector('en')),
      ).toEqual({ status: 'output_invalid' })
    })
  },
)
