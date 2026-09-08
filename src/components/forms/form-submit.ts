import type { FormEventHandler } from 'react'

type SubmittableForm = Readonly<{
  handleSubmit: () => Promise<void>
}>

export function submitForm(form: SubmittableForm): Promise<void> {
  return form.handleSubmit().catch(() => undefined)
}

/**
 * Prevents native submission and consumes TanStack Form's final rejection.
 *
 * The action already retains rejection state for FormErrorBanner, while
 * handleSubmit rethrows it; leaving that promise unawaited turns every designed
 * refusal into an unhandled rejection. This also hides errors thrown before or
 * beside the action inside onSubmit, but validators.onSubmit limits that
 * trade-off to already-validated values.
 */
export function submitHandler(form: SubmittableForm): FormEventHandler<HTMLFormElement> {
  return (event) => {
    event.preventDefault()
    void submitForm(form)
  }
}
