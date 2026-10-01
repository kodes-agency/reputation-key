// The rating card of the previewed arrival page: the question, five stars, the
// scale ends, "Send privately" and the privacy line. Without `onAction` it is
// a picture; with it (Try as guest) the stars and the button answer, locally.

import { Lock, Star } from 'lucide-react'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { GlassSurface, guestCopyText } from '#/components/features/guest'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import { RATINGS, ratingOptionName } from './preview-copy'
import { previewStyles as styles } from './preview-page-styles'
import type { TryAsGuestAction } from './portal-preview-states'

type Props = Readonly<{
  copy: GuestPortalCopyV2
  locale: GuestLocale
  displayName: string
  /** The star chosen but not yet sent. */
  selected: number | null
  onAction?: (action: TryAsGuestAction) => void
  /** Prefixes the ids, so the filmstrip's copies of the page never share one. */
  idPrefix: string
}>

const STAR_SIZE = 30
const UNSENT: React.CSSProperties = { opacity: 0.55 }

export function PreviewRatingCard({
  copy,
  locale,
  displayName,
  selected,
  onAction,
  idPrefix,
}: Props) {
  const titleId = `${idPrefix}-rating-title`
  const canSend = onAction === undefined || selected !== null
  return (
    <GlassSurface
      variant="card"
      as="section"
      aria-labelledby={titleId}
      style={styles.card}
    >
      <h2 id={titleId} className="ih-display" style={styles.cardTitle}>
        {copy.copy.ratingTitle}
      </h2>
      <div role="radiogroup" aria-label={copy.copy.ratingGroupLabel} style={styles.stars}>
        {RATINGS.map((rating) => (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={selected === rating}
            aria-label={ratingOptionName(copy, locale, rating)}
            style={styles.star}
            onClick={() => onAction?.({ type: 'choose', rating })}
          >
            <Star
              aria-hidden="true"
              size={STAR_SIZE}
              strokeWidth={1.5}
              fill={selected !== null && rating <= selected ? 'currentColor' : 'none'}
            />
          </button>
        ))}
      </div>
      <div style={styles.scaleEnds} aria-hidden="true">
        <span>{copy.copy.ratingScaleLow}</span>
        <span>{copy.copy.ratingScaleHigh}</span>
      </div>
      <button
        type="button"
        aria-disabled={!canSend}
        style={canSend ? styles.primaryButton : { ...styles.primaryButton, ...UNSENT }}
        onClick={() => onAction?.({ type: 'send' })}
      >
        {copy.copy.ratingSend}
      </button>
      <p style={styles.privacyLine}>
        <Lock aria-hidden="true" size={12} />
        {guestCopyText(copy, 'ratingPrivacyLine', { name: displayName })}
      </p>
    </GlassSurface>
  )
}
