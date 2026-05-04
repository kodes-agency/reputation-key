// Shared form building block — submit button that integrates mutation state.
// Used in every form in the app.
// Per patterns.md example #26.

import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'
// Minimal type for any mutation — we only read isPending/error
type AnyMutation = { isPending: boolean; error: unknown }
import type { ReactNode } from 'react'

// Minimal type for the form shape we need — avoids heavy FormApi generics
type FormLike = Readonly<{
  state: Readonly<{
    canSubmit: boolean
    isSubmitting: boolean
  }>
}>

type Props = Readonly<{
  mutation: AnyMutation
  form?: FormLike
  children: ReactNode
  variant?: 'default' | 'destructive' | 'secondary' | 'outline'
  className?: string
}>

export function SubmitButton({
  mutation,
  form,
  children,
  variant = 'default',
  className,
}: Props) {
  const isPending = mutation.isPending
  const isInvalid = form ? !form.state.canSubmit || form.state.isSubmitting : false

  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      disabled={isPending || isInvalid}
      aria-busy={isPending}
    >
      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}
