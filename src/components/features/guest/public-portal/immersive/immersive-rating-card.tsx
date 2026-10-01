import { useId } from 'react'
import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { GlassSurface } from './glass-surface'
import { LockIcon } from './immersive-icons'
import { ImmersiveRatingForm, type RatingSubmission } from './immersive-rating-form'

export type { RatingSubmission } from './immersive-rating-form'

/**
 * The rating card (boards G01, G03, G11): the question, the form and who will
 * read the answer. The guest's choice and the server call live in the form.
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
  saveFailed: boolean
  onSubmit: (value: RatingSubmission) => Promise<void>
}>) {
  const id = useId()
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
      <ImmersiveRatingForm
        pack={pack}
        idPrefix={id}
        pending={pending}
        saveFailed={saveFailed}
        onSubmit={onSubmit}
      />
      <p className="ih-privacy">
        <LockIcon size={16} />
        <span>{guestCopyText(pack, 'ratingPrivacyLine', { name: displayName })}</span>
      </p>
    </GlassSurface>
  )
}
