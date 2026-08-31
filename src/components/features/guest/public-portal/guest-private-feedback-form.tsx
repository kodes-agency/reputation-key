import { useForm } from '@tanstack/react-form'
import { SubmitButton } from '#/components/forms/submit-button'
import { Field, FieldLabel } from '#/components/ui/field'
import { Textarea } from '#/components/ui/textarea'
import { guestPrivateFeedbackFormDto } from '#/contexts/guest/application/dto/guest-response-form.dto'
import { Honeypot } from './guest-response-fields'
import type { GuestPortalCopy } from './guest-language-pack'

type Props = Readonly<{
  mutation: Readonly<{ isPending: boolean; error: unknown }>
  onSubmit: (value: Readonly<{ text: string; honeypot: string }>) => Promise<boolean>
  copy: GuestPortalCopy
}>

export function GuestPrivateFeedbackForm({ mutation, onSubmit, copy }: Props) {
  const form = useForm({
    defaultValues: { text: '', honeypot: '' },
    validators: { onSubmit: guestPrivateFeedbackFormDto },
    onSubmit: async ({ value }) => {
      const parsed = guestPrivateFeedbackFormDto.parse(value)
      const accepted = await onSubmit({
        text: parsed.text,
        honeypot: parsed.honeypot ?? '',
      })
      if (accepted) form.reset()
    },
  })

  return (
    <form
      className="rounded-lg border p-5"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h2 className="font-semibold">{copy.privateFeedbackTitle}</h2>
      <p className="mt-1 text-sm">{copy.privateFeedbackBody}</p>
      <form.Field name="text">
        {(field) => (
          <Field className="mt-4" data-invalid={!field.state.meta.isValid}>
            <FieldLabel htmlFor="private-feedback" className="sr-only">
              {copy.privateFeedbackLabel}
            </FieldLabel>
            <Textarea
              id="private-feedback"
              name={field.name}
              value={field.state.value}
              maxLength={2_000}
              rows={4}
              disabled={mutation.isPending}
              aria-invalid={!field.state.meta.isValid}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              className="focus-visible:border-[color:var(--portal-primary)] focus-visible:ring-[color:var(--portal-primary)]"
            />
            {!field.state.meta.isValid ? (
              <p className="text-sm text-destructive" role="alert">
                {copy.feedbackRequired}
              </p>
            ) : null}
          </Field>
        )}
      </form.Field>
      <form.Field name="honeypot">
        {(field) => (
          <Honeypot
            id="guest-feedback-website"
            name={field.name}
            value={field.state.value ?? ''}
            onChange={field.handleChange}
            copy={copy}
          />
        )}
      </form.Field>
      <SubmitButton mutation={mutation} form={form} variant="outline" className="mt-4">
        {mutation.isPending ? copy.sending : copy.sendPrivateFeedback}
      </SubmitButton>
    </form>
  )
}
