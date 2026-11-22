import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_FLAGS,
  REVIEW_ANALYSIS_NORMALIZATION_MANIFEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/analysis/normalizer'

describe('review analysis v3 normalization governance', () => {
  it('pins the full manifest and computed digest', () => {
    expect(REVIEW_ANALYSIS_NORMALIZATION_VERSION).toBe('review-analysis-normalization-v1')
    expect(REVIEW_ANALYSIS_NORMALIZATION_DIGEST).toBe(
      'd3f2d832717d9639c41eeefc65255f87c51e6e92d61cfeafff329af736e955fb',
    )
    expect(REVIEW_ANALYSIS_NORMALIZATION_DIGEST).toBe(
      createHash('sha256')
        .update('repkey-review-analysis-normalization-v1\0', 'utf8')
        .update(canonicalizeRfc8785(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST), 'utf8')
        .digest('hex'),
    )
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST).toMatchObject({
      version: 'review-analysis-normalization-v1',
      limits: { mentions: 48, sentenceReferences: 16, sentenceNumber: 10_000 },
      causePatternSource: '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$',
      causePhraseMaximumWords: 3,
      causePhraseMaximumLength: 80,
      invalidCausePolicy: 'empty-cause-keep-mention',
      quotationRunLength: 4,
      quotationScope: 'all-present-fields-space-or-hyphen-words-v2',
      personMarker: '[PERSON]',
      commonWordCatalogueVersion: 'review-cause-common-words-v1',
    })
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.nameTokenRules).toEqual({
      wordPatternSource: "\\p{L}+(?:['’-]\\p{L}+)*",
      ignoredPlaceholderPatternSource: '\\[[A-Z_]+\\]',
      minimumCandidateLetters: 2,
      everyCapitalizedWordIsCandidate: true,
      lowercaseOccurrenceSuppressesCandidate: true,
      includeHyphenAndApostropheParts: true,
    })
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.normalizedDashCodePoints).toEqual([
      'U+2010',
      'U+2011',
      'U+2012',
      'U+2013',
      'U+2014',
      'U+2015',
      'U+2212',
      'U+FE58',
      'U+FE63',
      'U+FF0D',
    ])
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.flags).toEqual(
      REVIEW_ANALYSIS_NORMALIZATION_FLAGS,
    )
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST)).toBe(true)
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.limits)).toBe(true)
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.enumVocabularies)).toBe(
      true,
    )
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.commonWords)).toBe(true)
  })

  it('attests a sorted unique lowercase common-word catalogue', () => {
    const words = REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.commonWords
    expect(words.length).toBeGreaterThan(500)
    expect(words).toEqual([...words].sort())
    expect(new Set(words).size).toBe(words.length)
    for (const word of words) expect(word).toMatch(/^[a-z]{2,}$/)
  })

  it('exports the exact closed flag vocabulary', () => {
    expect(REVIEW_ANALYSIS_NORMALIZATION_FLAGS).toEqual([
      'mentions_capped',
      'sentence_refs_capped',
      'enum_case_repaired',
      'mention_dropped_malformed',
      'mention_dropped_enum',
      'mention_dropped_cause',
      'mention_dropped_sentences',
      'sentence_refs_repaired',
      'cause_refused_name',
      'cause_refused_quotation',
      'cause_refused_shape',
      'names_person_invalid',
      'names_person_raised',
      'mentions_merged',
      'urgent_reason_unknown',
    ])
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_FLAGS)).toBe(true)
  })
})
