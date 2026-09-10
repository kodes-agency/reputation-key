// Anchored and evaluated only after the 40-character bound below; the repeated
// word group cannot receive attacker-controlled unbounded input.
// eslint-disable-next-line security/detect-unsafe-regex
export const AI_ISSUE_LABEL_PATTERN = /^[a-z]+(?: [a-z]+){0,3}$/
export const AI_ISSUE_LABEL_MAX_LENGTH = 40

/** The storage, read, and rendering boundary for model-authored issue labels. */
export function isAiIssueLabel(value: string): boolean {
  return value.length <= AI_ISSUE_LABEL_MAX_LENGTH && AI_ISSUE_LABEL_PATTERN.test(value)
}

/**
 * The consented merchant notice states the issue label "never reproduces
 * review text". `isAiIssueLabel` only enforces shape, and a lowercase excerpt
 * such as `worst hotel ever` satisfies it, so the claim rested entirely on a
 * prompt sentence. This is the structural half of it.
 *
 * A SINGLE word is a category, not an excerpt: `cleanliness` appears verbatim
 * in any review that complains about cleanliness, and rejecting it would
 * discard the discovery signal the open label exists to provide. Two or more
 * words appearing contiguously in the source is quotation, and is refused.
 *
 * Comparison is NFKC-folded, lowercased and whitespace-collapsed on both sides,
 * and both are space-padded so matching is token-aligned rather than an
 * incidental substring hit.
 */
export function issueLabelReproducesSource(label: string, sourceText: string): boolean {
  const foldedLabel = foldForComparison(label)
  if (foldedLabel.split(' ').length < 2) return false
  return ` ${foldForComparison(sourceText)} `.includes(` ${foldedLabel} `)
}

function foldForComparison(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}
