// Shared form building block — displays top-level mutation errors.
// Used in every form in the app.
// Per patterns.md example #27.

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { AlertCircle } from 'lucide-react'

type Props = Readonly<{
  error: unknown
}>

const extractErrorMessage = (error: unknown): string => {
  if (!error) return ''

  // Server functions throw Response with JSON body: { error: '<code>', message: string }
  if (error instanceof Response) {
    return 'Something went wrong. Please try again.'
  }

  if (error instanceof Error) {
    return error.message
  }

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
