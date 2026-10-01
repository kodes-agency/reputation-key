import { useId, useState, type FormEvent } from 'react'
import { guestRatingFormDto } from '#/contexts/guest/application/dto/guest-response-form.dto'
import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { GlassSurface } from './glass-surface'
import { ImmersiveHoneypot } from './immersive-honeypot'
import { ImmersiveBanner } from './immersive-banner'
import { LockIcon } from './immersive-icons'
import { RatingStars, ratingWord } from './immersive-stars'

export type RatingSubmission = Readonly<{ rating: number; honeypot: string }>

/**
 * `choose` when `rating` is not a star count the server accepts. The same
 * schema the server function checks, so the page cannot offer a value the
 * server would refuse.
 */
export function ratingChoiceError(rating: number): 'choose' | null {
  return guestRatingFormDto.shape.rating.safeParse(rating).success ? null : 'choose'
}

/**
 * The rating card (boards G01, G03, G11): the question, five stars, the scale
 * ends and the word for the chosen star, "Send privately" and who will read it.
 * It holds the guest's choice until they send it, and asks for a rating when
 * they try to send none. The server call is the caller's.
 */
export function ImmersiveRatingCard({
  pack,
  displayName,
  pending,
  saveFailed,
  onSubmit,
}: Readonly<{
  pack: GuestPortalCopyV2
  displayName: string
  pending: boolean
  /** The last attempt to save did not reach the server. */
  saveFailed: boolean
  onSubmit: (value: RatingSubmission) => Promise<void>
}>) {
  const id = useId()
  const [rating, setRating] = useState(0)
  const [honeypot, setHoneypot] = useState('')
  const [chooseError, setChooseError] = useState(false)

  const choose = (next: number) => {
    setRating(next)
    setChooseError(false)
  }
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (ratingChoiceError(rating)) {
      setChooseError(true)
      return
    }
    void onSubmit({ rating, honeypot })
  }
  const banner = chooseError
    ? pack.copy.ratingChoose
    : saveFailed
      ? pack.copy.ratingSaveFailed
      : null

  return (
    <GlassSurface
      variant="card"
      as="section"
      className="ih-rating-card"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="ih-display ih-card-title ih-card-title--centered">
        {pack.copy.ratingTitle}
      </h2>
      <form className="ih-rating-form" onSubmit={send} noValidate>
        <fieldset
          role="radiogroup"
          aria-label={pack.copy.ratingGroupLabel}
          disabled={pending}
          className="ih-fieldset"
        >
          <RatingStars
            pack={pack}
            value={rating}
            name={`${id}-rating`}
            onChange={choose}
          />
          <div className="ih-scale" aria-hidden="true">
            <span className="ih-scale__end">{pack.copy.ratingScaleLow}</span>
            <span className="ih-scale__word ih-display">
              {rating > 0 ? ratingWord(pack, rating) : ''}
            </span>
            <span className="ih-scale__end ih-scale__end--high">
              {pack.copy.ratingScaleHigh}
            </span>
          </div>
        </fieldset>
        {banner !== null && <ImmersiveBanner message={banner} />}
        <ImmersiveHoneypot
          id={`${id}-website`}
          label={pack.copy.honeypotLabel}
          value={honeypot}
          onChange={setHoneypot}
        />
        <button type="submit" className="ih-button ih-button--primary" disabled={pending}>
          {pending ? pack.copy.sending : pack.copy.ratingSend}
        </button>
      </form>
      <p className="ih-privacy">
        <LockIcon size={16} />
        <span>{guestCopyText(pack, 'ratingPrivacyLine', { name: displayName })}</span>
      </p>
    </GlassSurface>
  )
}
