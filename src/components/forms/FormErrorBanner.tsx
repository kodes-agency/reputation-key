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

const extractErrorMessage = (error: unknown): string => {
  if (!error) return ''

  // TanStack Start re-throws serialized Errors from server functions.
  // The .message contains the domain error message (e.g., "slug must be URL-friendly").
  if (error instanceof Error) {
    return error.message
  }

  // Fallback for non-Error error shapes
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }

  return 'An unexpected error occurred.'
}

export function FormErrorBanner({ error }: Props) {
  if (!error) return null

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Unable to complete this action</AlertTitle>
      <AlertDescription>{extractErrorMessage(error)}</AlertDescription>
    </Alert>
  )
}
