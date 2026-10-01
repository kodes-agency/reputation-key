// What the previewed page shows once a rating was sent, in the order the guest
// design fixes: the receipt strip, the Google card (in the same place whatever
// the rating, so the page never steers a happy guest), then the private note
// when the rating is at or below the threshold.
//
// The Google action and the note send do nothing here: a preview opens no
// address and records nothing.

import { Check, ExternalLink } from 'lucide-react'
import { guestCopyText, GlassSurface } from '#/components/features/guest'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import { ratingWord } from './preview-copy'
import { previewStyles as styles } from './preview-page-styles'
import type { PreviewNoteState, TryAsGuestAction } from './portal-preview-states'

type Props = Readonly<{
  copy: GuestPortalCopyV2
  displayName: string
  rating: number
  note: PreviewNoteState
  onAction?: (action: TryAsGuestAction) => void
  idPrefix: string
}>

export function PreviewAfterRating({
  copy,
  displayName,
  rating,
  note,
  onAction,
  idPrefix,
}: Props) {
  return (
    <>
      <GlassSurface variant="tile" as="section" style={styles.receipt}>
        <p style={styles.receiptText}>
          <Check aria-hidden="true" size={16} />
          {guestCopyText(copy, 'ratingSentSummary', { word: ratingWord(copy, rating) })}
        </p>
        <button
          type="button"
          style={styles.textButton}
          onClick={() => onAction?.({ type: 'change' })}
        >
          {copy.copy.ratingChange}
        </button>
      </GlassSurface>
      <GlassSurface
        variant="card"
        as="section"
        aria-labelledby={`${idPrefix}-google-title`}
        style={{ ...styles.card, marginTop: 10 }}
      >
        <h2
          id={`${idPrefix}-google-title`}
          className="ih-display"
          style={styles.cardTitle}
        >
          {copy.copy.googleTitle}
        </h2>
        <p style={styles.body}>{copy.copy.googleBody}</p>
        <button type="button" style={styles.primaryButton}>
          {copy.copy.googleAction} <ExternalLink aria-hidden="true" size={14} />
        </button>
        <p style={styles.hint}>{copy.copy.googleHint}</p>
      </GlassSurface>
      <PreviewNoteCard
        copy={copy}
        displayName={displayName}
        note={note}
        onAction={onAction}
        idPrefix={idPrefix}
      />
    </>
  )
}

function PreviewNoteCard({
  copy,
  displayName,
  note,
  onAction,
  idPrefix,
}: Omit<Props, 'rating'>) {
  if (note === 'none') return null
  const labelId = `${idPrefix}-note-label`
  if (note === 'sent') {
    return (
      <GlassSurface
        variant="tile"
        as="section"
        style={{ ...styles.receipt, marginTop: 10 }}
      >
        <p style={styles.receiptText}>
          <Check aria-hidden="true" size={16} />
          {guestCopyText(copy, 'noteSent', { name: displayName })}
        </p>
      </GlassSurface>
    )
  }
  return (
    <GlassSurface
      variant="card"
      as="section"
      aria-labelledby={labelId}
      style={{ ...styles.card, marginTop: 10 }}
    >
      <h2 id={labelId} className="ih-display" style={styles.cardTitle}>
        {copy.copy.noteOfferTitle}
      </h2>
      <p style={styles.body}>
        {guestCopyText(copy, 'noteOfferBody', { name: displayName })}
      </p>
      {note === 'writing' ? (
        <>
          <textarea
            aria-label={copy.copy.noteLabel}
            placeholder={copy.copy.noteHint}
            style={styles.note}
          />
          <button
            type="button"
            style={styles.primaryButton}
            onClick={() => onAction?.({ type: 'sendNote' })}
          >
            {copy.copy.noteSend}
          </button>
        </>
      ) : (
        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => onAction?.({ type: 'writeNote' })}
        >
          {copy.copy.noteOfferAction}
        </button>
      )}
    </GlassSurface>
  )
}
