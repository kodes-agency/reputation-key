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
 * Every word that starts with a capital letter is a candidate, wherever it stands: the
 * first word of a sentence ("Maria at reception was lovely."), a heading ("Lovely Hilton
 * Marina Bay Stay") and shouting included. A candidate is let through only when the
 * review also writes the same word entirely in lowercase, or when the cause check
 * allows it as a common word or a vocabulary hint. Missing a name costs more than
 * refusing a common word, and a guard that skipped sentence openers would never see a
 * name in the commonest place a guest writes one.
 */
export const REVIEW_NAME_TOKEN_RULES = Object.freeze({
  wordPatternSource: WORD_RUN.source,
  ignoredPlaceholderPatternSource: REDACTION_PLACEHOLDER.source,
  minimumCandidateLetters: 2,
  everyCapitalizedWordIsCandidate: true,
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

  for (const word of allWords) {
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

/**
 * Why a cause a MANAGER typed may not be stored, or null when it may. The same two guards
 * an AI's cause passes (decision 9 of docs/plan/guest-voice-2.md; ADR 0031, amended
 * 2026-10-30): no person, brand or place word, and no four or more contiguous words of the
 * review. The decision is that names stay out of a stored cause whoever writes it.
 *
 * `thing` and `issue` are the phrases as the stored contract holds them (lowercase, folded);
 * `typed` is what the manager typed, because folding to lowercase would hide the one thing
 * a name guard reads: a capital letter. A word the manager typed with a capital is a name
 * candidate wherever it stands, like a capitalised word of a review, and is let through
 * only as a common word or a vocabulary hint. `reviewText` is the review as it stands at
 * the revision the analysis was made on, or null where it cannot be read (the raw text is
 * served for 30 days): then the review's own capitalised words and its quotations cannot be
 * compared, and what the manager typed is still held to the capitals rule. A name typed in
 * lowercase passes, as one in a review does; the merchant notice says so.
 */
export function managerCauseRefusal(input: {
  readonly typed: readonly (string | null)[]
  readonly thing: string | null
  readonly issue: string | null
  readonly reviewText: string | null
  readonly allowedWords: ReadonlySet<string>
}): 'name' | 'quotation' | null {
  const nameTokens = new Set<string>()
  for (const typed of input.typed) {
    if (typed === null) continue
    for (const token of collectReviewNameTokens([typed])) nameTokens.add(token)
  }
  if (input.reviewText !== null) {
    for (const token of collectReviewNameTokens([input.reviewText])) nameTokens.add(token)
  }
  if (
    reviewCauseContainsRefusedName({
      thing: input.thing,
      issue: input.issue,
      nameTokens,
      allowedWords: input.allowedWords,
    })
  ) {
    return 'name'
  }
  if (
    input.reviewText !== null &&
    reviewCauseReproducesQuotation({
      thing: input.thing,
      issue: input.issue,
      reviewText: input.reviewText,
    })
  ) {
    return 'quotation'
  }
  return null
}
