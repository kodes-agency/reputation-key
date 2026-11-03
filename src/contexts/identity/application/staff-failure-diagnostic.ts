import type { StaffOnboarding } from '../domain/staff-account'

/** Keep the underlying reason, never the contact data held by a running operation. */
export function staffFailureDiagnostic(
  row: Pick<StaffOnboarding, 'email' | 'displayName'>,
  error: unknown,
): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : 'Unknown setup failure'
  const privateWords = [
    row.email,
    row.displayName,
    ...(row.displayName?.split(/\s+/u) ?? []),
  ].filter((value): value is string => Boolean(value && value.length > 1))
  const redacted = privateWords.reduce(redactValue, message.slice(0, 1000))
  return redacted.replace(/[^\s@]+@[^\s@]+/g, '[redacted]').slice(0, 500)
}

function redactValue(text: string, value: string): string {
  const lower = text.toLowerCase()
  const needle = value.toLowerCase()
  let from = 0
  let result = ''
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    result += text.slice(from, at) + '[redacted]'
    from = at + value.length
  }
  return result + text.slice(from)
}
