// Shared form building block — displays top-level mutation errors.
// Used in every form in the app.
// Per patterns.md example #27.
//
// TanStack Start serializes server-thrown Errors via seroval and re-throws
// them on the client. The mutation.error will be an Error instance with
// .message from the server. Custom properties (code, status) are also
// preserved by seroval.

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { AlertCircle } from 'lucide-react'

type Props = Readonly<{
  error: unknown
}>

/**
 * A server function whose `.inputValidator` schema rejects the payload throws a
 * ZodError, and seroval hands the client an Error whose `.message` is the raw
 * `JSON.stringify(issues)` dump. Rendering that verbatim showed users
 * `[{"origin":"string","code":"too_small",...}]`. Parse it back into
 * `field: message` lines — the same shape `shared/config/env.ts` and
 * `shared/bqc/status-schema.ts` use for issue lists.
 */
type IssueLike = Readonly<{ path?: unknown; message?: unknown }>

const isIssueList = (value: unknown): value is readonly IssueLike[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (issue) =>
      typeof issue === 'object' &&
      issue !== null &&
      'message' in issue &&
      typeof issue.message === 'string',
  )

/** `null` for anything that is not a serialized issue array — the caller then
 *  falls back to rendering the message as-is, so an unknown shape or a plain
 *  string message is never swallowed. */
const parseValidationIssues = (message: string): readonly string[] | null => {
  const trimmed = message.trim()
  if (!trimmed.startsWith('[')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!isIssueList(parsed)) return null
  return parsed.map((issue) => {
    const text = String(issue.message)
    const path = Array.isArray(issue.path)
      ? issue.path
          .filter(
            (segment): segment is string | number =>
              typeof segment === 'string' || typeof segment === 'number',
          )
          .join('.')
      : ''
    return path ? `${path}: ${text}` : text
  })
}

const extractErrorMessage = (error: unknown): string => {
  if (!error) return ''

  // TanStack Start re-throws serialized Errors from server functions.
  // The .message contains the domain error message (e.g., "slug must be URL-friendly").
  if (error instanceof Error) {
    return error.message
  }

  // Fallback for non-Error error shapes
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }

  return 'An unexpected error occurred.'
}

export function FormErrorBanner({ error }: Props) {
  if (!error) return null

  const message = extractErrorMessage(error)
  const issues = parseValidationIssues(message)

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Unable to complete this action</AlertTitle>
      <AlertDescription>
        {issues ? (
          <ul className="list-disc pl-4">
            {issues.map((issue, index) => (
              // Index-qualified: two issues on the same path can share text.
              <li key={`${index}-${issue}`}>{issue}</li>
            ))}
          </ul>
        ) : (
          message
        )}
      </AlertDescription>
    </Alert>
  )
}
