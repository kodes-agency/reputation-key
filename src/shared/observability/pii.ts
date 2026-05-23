// PII masking utilities for safe logging.
// Always use these before including personally identifiable information in log output.

/**
 * Masks an email address for safe logging.
 * Preserves first 1–2 characters before the @ sign.
 * Example: "john@example.com" → "jo***@example.com"
 */
export const maskEmail = (email: string): string =>
  email.replace(/(.{1,2})(.*)@/, '$1***@')
