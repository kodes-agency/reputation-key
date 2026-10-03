// Shared form building block: a submit Button wired to a mutation and a form.
// Used in every form in the app. The pending state (spinner, aria-busy, disabled,
// reduced motion) and the touch height belong to the Button; this only decides
// when the Button is pending or blocked.

import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '#/components/ui/button'

// Minimal type for any mutation — we only read isPending/error
type AnyMutation = { isPending: boolean; error: unknown }

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
  /** The label while the mutation is pending. Without it the label stays. */
  pendingLabel?: string
  disabled?: boolean
}> &
  Pick<ButtonProps, 'variant' | 'size' | 'className'>

export function SubmitButton({
  mutation,
  form,
  children,
  pendingLabel,
  disabled = false,
  ...buttonProps
}: Props) {
  const isInvalid = form ? !form.state.canSubmit || form.state.isSubmitting : false

  return (
    <Button
      type="submit"
      {...buttonProps}
      pending={mutation.isPending}
      pendingLabel={pendingLabel}
      disabled={disabled || isInvalid}
    >
      {children}
    </Button>
  )
}
