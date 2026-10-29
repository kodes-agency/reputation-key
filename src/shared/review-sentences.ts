// One source drives both splitting and offsets so live evidence cannot drift.
const REVIEW_SENTENCE_SPLIT_PATTERN = /(?<=[.!?…])\s+|\n+/u

export const REVIEW_SENTENCES_VERSION = 'review-sentences-v1' as const
export const REVIEW_SENTENCES_DIGEST =
  'b7e81ba1117905c6ef567418dba1696af46fa11ab0b2a87c33100214b8fc451a' as const

export function splitReviewSentences(text: string): readonly string[] {
  return Object.freeze(
    text
      .split(REVIEW_SENTENCE_SPLIT_PATTERN)
      .map((part) => part.trim())
      .filter(Boolean),
  )
}

export type LocatedReviewSentence = Readonly<{
  number: number
  text: string
  start: number
  end: number
}>

function locateTrimmedPart(
  text: string,
  rawStart: number,
  rawEnd: number,
  number: number,
): LocatedReviewSentence | null {
  const raw = text.slice(rawStart, rawEnd)
  const sentence = raw.trim()
  if (sentence.length === 0) return null
  const leadingLength = raw.length - raw.trimStart().length
  const start = rawStart + leadingLength
  return Object.freeze({ number, text: sentence, start, end: start + sentence.length })
}

export function locateReviewSentences(text: string): readonly LocatedReviewSentence[] {
  // The source and flags come only from the fixed module constant above, never from input.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const separatorPattern = new RegExp(
    REVIEW_SENTENCE_SPLIT_PATTERN.source,
    `${REVIEW_SENTENCE_SPLIT_PATTERN.flags}g`,
  )
  const located: LocatedReviewSentence[] = []
  let cursor = 0
  for (const match of text.matchAll(separatorPattern)) {
    const matchIndex = match.index
    const sentence = locateTrimmedPart(text, cursor, matchIndex, located.length + 1)
    if (sentence !== null) located.push(sentence)
    cursor = matchIndex + match[0].length
  }
  const finalSentence = locateTrimmedPart(text, cursor, text.length, located.length + 1)
  if (finalSentence !== null) located.push(finalSentence)
  return Object.freeze(located)
}
