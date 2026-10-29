import { issueLabelReproducesSource } from './ai-issue-label'
import {
  REVIEW_CAUSE_PHRASE_MAX_LENGTH,
  REVIEW_CAUSE_PHRASE_PATTERN,
} from './review-analysis-v3'
import type { ReviewTopicV3 } from './review-topic-taxonomy'

const DASH_VARIANTS = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/gu
// A letter run with inner apostrophes or hyphens. The repeated group is delimited by those
// marks, so it cannot backtrack, and it only reads review sentences (16 KB at most).
// eslint-disable-next-line security/detect-unsafe-regex
const WORD_RUN = /\p{L}+(?:['’-]\p{L}+)*/gu
// The redactor's placeholders ([PERSON], [CONTACT]...) stand where text was removed; they
// are not words the guest wrote.
const REDACTION_PLACEHOLDER = /\[[A-Z_]+\]/gu
const LETTER = /\p{L}/gu
const STARTS_UPPERCASE = /^\p{Lu}/u
const CAUSE_WORD_SEPARATOR = /[ -]/u
const NAME_PART_SEPARATOR = /['’-]/u
const HINT_WORD = /\p{L}+/gu

/**
 * How person, brand and place words are found in a review's sentences. One object
 * drives the code below and the normalizer's governed manifest, so the two cannot drift.
 * A sentence of at least 4 words in which every word starts with a capital is a heading
 * or shouting: capitals there say nothing about names. Anything less uniform is read as
 * written ("Thanks Maria and John!", "Lovely Hilton Marina Bay stay"), because missing a
 * name costs more than refusing a common word.
 */
export const REVIEW_NAME_TOKEN_RULES = Object.freeze({
  wordPatternSource: WORD_RUN.source,
  ignoredPlaceholderPatternSource: REDACTION_PLACEHOLDER.source,
  headingMinimumWords: 4,
  headingRequiresEveryWordCapitalized: true,
  minimumCandidateLetters: 2,
  ignoreSentenceInitialWord: true,
  lowercaseOccurrenceSuppressesCandidate: true,
  includeHyphenAndApostropheParts: true,
})

export type NormalizedReviewCausePhrase =
  Readonly<{ valid: true; value: string | null }> | Readonly<{ valid: false }>

export function normalizeReviewCausePhrase(value: unknown): NormalizedReviewCausePhrase {
  if (value === null) return Object.freeze({ valid: true, value: null })
  if (typeof value !== 'string') return Object.freeze({ valid: false })
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(DASH_VARIANTS, '-')
    .replace(/\s+/gu, ' ')
  if (normalized.length > REVIEW_CAUSE_PHRASE_MAX_LENGTH) {
    return Object.freeze({ valid: false })
  }
  if (!REVIEW_CAUSE_PHRASE_PATTERN.test(normalized)) {
    return Object.freeze({ valid: false })
  }
  return Object.freeze({ valid: true, value: normalized })
}

function normalizedNameToken(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function letterCount(value: string): number {
  return value.match(LETTER)?.length ?? 0
}

function startsUppercase(value: string): boolean {
  return STARTS_UPPERCASE.test(value.normalize('NFKC'))
}

function wordsInSentence(sentence: string): readonly string[] {
  return (
    sentence.normalize('NFKC').replace(REDACTION_PLACEHOLDER, ' ').match(WORD_RUN) ?? []
  )
}

function isHeadingLike(words: readonly string[]): boolean {
  return (
    words.length >= REVIEW_NAME_TOKEN_RULES.headingMinimumWords &&
    words.every(startsUppercase)
  )
}

export function collectReviewNameTokens(
  sentences: readonly string[],
): ReadonlySet<string> {
  const allWords = sentences.flatMap((sentence) => wordsInSentence(sentence))
  const lowercaseForms = new Set(
    allWords
      .filter((word) => word === word.toLowerCase())
      .map((word) => normalizedNameToken(word)),
  )
  const candidates = new Set<string>()

  for (const sentence of sentences) {
    const words = wordsInSentence(sentence)
    if (isHeadingLike(words)) continue
    for (const word of words.slice(1)) {
      const normalized = normalizedNameToken(word)
      if (
        letterCount(word) < REVIEW_NAME_TOKEN_RULES.minimumCandidateLetters ||
        !startsUppercase(word) ||
        lowercaseForms.has(normalized)
      ) {
        continue
      }
      candidates.add(normalized)
      for (const part of normalized.split(NAME_PART_SEPARATOR)) {
        if (part.length > 0) candidates.add(part)
      }
    }
  }
  return candidates
}

export function collectVocabularyHintWords(
  hints: Partial<Record<ReviewTopicV3, readonly string[]>> | undefined,
): ReadonlySet<string> {
  const words = new Set<string>()
  for (const phrases of Object.values(hints ?? {})) {
    for (const phrase of phrases ?? []) {
      for (const word of phrase.normalize('NFKC').toLowerCase().match(HINT_WORD) ?? []) {
        words.add(word)
      }
    }
  }
  return words
}

function causeWords(thing: string | null, issue: string | null): readonly string[] {
  return [thing, issue]
    .filter((value): value is string => value !== null)
    .flatMap((value) => value.split(CAUSE_WORD_SEPARATOR))
}

export function reviewCauseContainsRefusedName(input: {
  readonly thing: string | null
  readonly issue: string | null
  readonly nameTokens: ReadonlySet<string>
  readonly allowedWords: ReadonlySet<string>
}): boolean {
  return causeWords(input.thing, input.issue).some(
    (word) => input.nameTokens.has(word) && !input.allowedWords.has(word),
  )
}

export function reviewCauseReproducesQuotation(input: {
  readonly thing: string | null
  readonly issue: string | null
  readonly reviewText: string
}): boolean {
  if (input.thing === null || input.issue === null) return false
  const words = causeWords(input.thing, input.issue)
  for (let start = 0; start + 4 <= words.length; start += 1) {
    const window = words.slice(start, start + 4).join(' ')
    if (issueLabelReproducesSource(window, input.reviewText)) return true
  }
  return false
}
