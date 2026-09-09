// Anchored and evaluated only after the 40-character bound below; the repeated
// word group cannot receive attacker-controlled unbounded input.
// eslint-disable-next-line security/detect-unsafe-regex
export const AI_ISSUE_LABEL_PATTERN = /^[a-z]+(?: [a-z]+){0,3}$/
export const AI_ISSUE_LABEL_MAX_LENGTH = 40

/** The storage, read, and rendering boundary for model-authored issue labels. */
export function isAiIssueLabel(value: string): boolean {
  return value.length <= AI_ISSUE_LABEL_MAX_LENGTH && AI_ISSUE_LABEL_PATTERN.test(value)
}
