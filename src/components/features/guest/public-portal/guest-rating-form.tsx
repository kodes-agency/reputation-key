import { useForm } from '@tanstack/react-form'
import { SubmitButton } from '#/components/forms/submit-button'
import { guestRatingFormDto } from '#/contexts/guest/application/dto/guest-response-form.dto'
import { Honeypot, RatingChoices } from './guest-response-fields'
import type { GuestPortalCopy } from './guest-language-pack'

type MutationState = Readonly<{ isPending: boolean; error: unknown }>

type Props = Readonly<{
  idPrefix: string
  initialRating: number | null
  mutation: MutationState
  copy: GuestPortalCopy
  submitLabel: string
  className?: string
  buttonClassName?: string
  onSubmit: (value: Readonly<{ rating: number; honeypot: string }>) => Promise<void>
}>

export function GuestRatingForm({
  idPrefix,
  initialRating,
  mutation,
  copy,
  submitLabel,
  className,
  buttonClassName,
  onSubmit,
}: Props) {
  const form = useForm({
    defaultValues: { rating: initialRating ?? 0, honeypot: '' },
    validators: { onSubmit: guestRatingFormDto },
    onSubmit: async ({ value }) => {
      const parsed = guestRatingFormDto.parse(value)
      await onSubmit({ rating: parsed.rating, honeypot: parsed.honeypot ?? '' })
    },
  })

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="rating">
        {(field) => (
          <div data-invalid={!field.state.meta.isValid}>
            <RatingChoices
              value={field.state.value || null}
              disabled={mutation.isPending}
              onChange={field.handleChange}
              copy={copy}
            />
            {!field.state.meta.isValid ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {copy.chooseRating}
              </p>
            ) : null}
          </div>
        )}
      </form.Field>
      <form.Field name="honeypot">
        {(field) => (
          <Honeypot
            id={`${idPrefix}-website`}
            name={field.name}
            value={field.state.value ?? ''}
            onChange={field.handleChange}
            copy={copy}
          />
        )}
      </form.Field>
      <SubmitButton mutation={mutation} form={form} className={buttonClassName}>
        {mutation.isPending ? copy.submitting : submitLabel}
      </SubmitButton>
    </form>
  )
}
