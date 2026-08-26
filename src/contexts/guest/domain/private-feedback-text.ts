/** Canonical private-feedback text policy shared by legacy and current writes. */
export const MAX_PRIVATE_FEEDBACK_LENGTH = 2000

/**
 * Preserve guest-authored paragraphs while making persisted line endings
 * deterministic across browsers and operating systems.
 */
export const normalizePrivateFeedbackText = (value: string): string =>
  value.replace(/\r\n?/gu, '\n').trim()
