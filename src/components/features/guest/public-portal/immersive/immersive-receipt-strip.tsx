import type { RefObject } from 'react'
import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { ReceiptStars, ratingWord } from './immersive-stars'

/**
 * The strip that opens the after-rating page (boards G04, G05): "Thank you.",
 * the stars the guest gave, the word for them and that it was sent privately,
 * and Change. It reads the same at every rating, and what it says is about the
 * private rating alone; Google is the card below it.
 */
export function ImmersiveReceiptStrip({
  pack,
  rating,
  onChange,
  headingRef,
}: Readonly<{
  pack: GuestPortalCopyV2
  rating: number
  /** Where Change leads. Without a destination the page shows no Change. */
  onChange?: () => void
  /** The heading, so the view can move focus to it when a rating has just been sent. */
  headingRef?: RefObject<HTMLHeadingElement | null>
}>) {
  return (
    <div className="ih-receipt">
      <h2 ref={headingRef} tabIndex={-1} className="ih-display ih-receipt__thanks">
        {pack.copy.ratingThanks}
      </h2>
      <p className="ih-receipt__line">
        <ReceiptStars pack={pack} rating={rating} />
        <span>
          {guestCopyText(pack, 'ratingSentSummary', { word: ratingWord(pack, rating) })}
        </span>
        {onChange && (
          <button
            type="button"
            className="ih-text-button"
            aria-label={pack.copy.responseChangeTitle}
            onClick={onChange}
          >
            {pack.copy.ratingChange}
          </button>
        )}
      </p>
    </div>
  )
}
