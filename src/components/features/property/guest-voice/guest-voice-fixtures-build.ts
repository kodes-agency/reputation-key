// The parts the Guest voice 2.0 fixtures are built from: ids, and quotes the way the
// read model hands them over. The figures are `issueStatistics`' (the engine's); a test
// holds each fixture to the read model's own rules.
import type { LiveEvidence } from '#/contexts/ai/application/public-api'

export const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

/** The numbered sentences of a review, split by the rule the analysis uses. */
function sentenceSpans(text: string): readonly { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let cursor = 0
  for (const part of text.split(/(?<=[.!?…])\s+|\n+/u)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const start = text.indexOf(trimmed, cursor)
    cursor = start + trimmed.length
    spans.push({ start, end: cursor })
  }
  return spans
}

/**
 * A quote as the read model hands it over: the review's text and where, in it, the
 * sentences the analysis cites are (1-based, as the analysis numbers them).
 */
export function quoteOf(
  evidence: Readonly<{
    id: string
    rating: LiveEvidence['rating']
    reviewedAt: string
    text: string
    cited: readonly number[]
  }>,
): LiveEvidence {
  const spans = sentenceSpans(evidence.text)
  return {
    inboxItemId: evidence.id,
    reviewedAt: evidence.reviewedAt,
    rating: evidence.rating,
    text: evidence.text,
    sentenceRanges: evidence.cited.map((number) => {
      const span = spans[number - 1]
      if (span === undefined) throw new RangeError(`The review has no sentence ${number}`)
      return span
    }),
  }
}

/** A stable id for an issue or an inbox item in a fixture: `a000…0007`. */
export function fixtureId(prefix: 'a' | 'b', number: number): string {
  return `${prefix}0000000-0000-4000-8000-${String(number).padStart(12, '0')}`
}
