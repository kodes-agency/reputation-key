import { useForm } from '@tanstack/react-form'
import { submitHandler } from '#/components/forms/form-submit'
import { guestRatingFormDto } from '#/contexts/guest/application/dto/guest-response-form.dto'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { ImmersiveBanner } from './immersive-banner'
import { ImmersiveHoneypot } from './immersive-honeypot'
import { RatingStars, ratingWord } from './immersive-stars'

export type RatingSubmission = Readonly<{ rating: number; honeypot: string }>

/**
 * The form of the rating card: five stars as one radio group, the scale ends
 * and the word for the chosen star, an error banner and "Send privately".
 *
 * The choice is the form's own state, validated on submit by the same DTO the
 * server function checks (`guestRatingFormDto`), so the page cannot offer a
 * value the server would refuse. Sending with no star asks for one and sends
 * nothing. The server call is the caller's.
 */
export function ImmersiveRatingForm({
  pack,
  idPrefix,
  pending,
  saveFailed,
  initialRating = 0,
  submitLabel,
  onSubmit,
}: Readonly<{
  pack: GuestPortalCopyV2
  idPrefix: string
  pending: boolean
  /** The last attempt to save did not reach the server. */
  saveFailed: boolean
  /** The star the form starts on: the guest's current rating when they change it. */
  initialRating?: number
  /** The button's words; "Send privately" unless the guest is changing a rating. */
  submitLabel?: string
  onSubmit: (value: RatingSubmission) => Promise<void>
}>) {
  const form = useForm({
    defaultValues: { rating: initialRating, honeypot: '' },
    validators: { onSubmit: guestRatingFormDto },
    onSubmit: async ({ value }) => {
      const parsed = guestRatingFormDto.parse(value)
      await onSubmit({ rating: parsed.rating, honeypot: parsed.honeypot ?? '' })
    },
  })

  return (
    <form className="ih-rating-form" onSubmit={submitHandler(form)} noValidate>
      <form.Field name="rating">
        {(field) => (
          <>
            <fieldset
              role="radiogroup"
              aria-label={pack.copy.ratingGroupLabel}
              disabled={pending}
              className="ih-fieldset"
            >
              <RatingStars
                pack={pack}
                value={field.state.value}
                name={`${idPrefix}-rating`}
                onChange={field.handleChange}
              />
              <div className="ih-scale" aria-hidden="true">
                <span className="ih-scale__end">{pack.copy.ratingScaleLow}</span>
                <span className="ih-scale__word ih-display">
                  {field.state.value > 0 ? ratingWord(pack, field.state.value) : ''}
                </span>
                <span className="ih-scale__end ih-scale__end--high">
                  {pack.copy.ratingScaleHigh}
                </span>
              </div>
            </fieldset>
            {!field.state.meta.isValid ? (
              <ImmersiveBanner message={pack.copy.ratingChoose} />
            ) : saveFailed ? (
              <ImmersiveBanner message={pack.copy.ratingSaveFailed} />
            ) : null}
          </>
        )}
      </form.Field>
      <form.Field name="honeypot">
        {(field) => (
          <ImmersiveHoneypot
            id={`${idPrefix}-website`}
            label={pack.copy.honeypotLabel}
            value={field.state.value ?? ''}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <button type="submit" className="ih-button ih-button--primary" disabled={pending}>
        {pending ? pack.copy.sending : (submitLabel ?? pack.copy.ratingSend)}
      </button>
    </form>
  )
}
