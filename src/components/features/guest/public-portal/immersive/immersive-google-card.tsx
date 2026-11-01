import { useId } from 'react'
import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { GlassSurface } from './glass-surface'
import { ImmersiveBanner } from './immersive-banner'
import { ArrowUpRightIcon, InfoIcon } from './immersive-icons'

/**
 * The Google card (boards G04, G05; G08 when Google cannot be offered).
 *
 * ADR 0044, anti-gating: it takes no rating, no threshold and no note state,
 * so the card is the same markup, in the same place, with the same words and
 * the same prominence after every rating. A published direct Portal also
 * shows it from arrival, with its optional direct body line.
 */
export function ImmersiveGoogleCard({
  pack,
  displayName,
  available,
  pending,
  openFailed,
  onOpen,
  direct = false,
}: Readonly<{
  direct?: boolean
  pack: GuestPortalCopyV2
  displayName: string
  available: boolean
  pending: boolean
  openFailed: boolean
  onOpen: () => void
}>) {
  const id = useId()
  if (!available) {
    return (
      <GlassSurface
        variant="card"
        as="section"
        role="status"
        className="ih-google-card ih-google-card--unavailable"
        aria-labelledby={`${id}-title`}
      >
        <span className="ih-disc">
          <InfoIcon size={22} />
        </span>
        <div>
          <h2 id={`${id}-title`} className="ih-display ih-card-title">
            {pack.copy.googleUnavailableTitle}
          </h2>
          <p className="ih-card-body">
            {guestCopyText(pack, 'googleUnavailableBody', { name: displayName })}
          </p>
        </div>
      </GlassSurface>
    )
  }
  return (
    <GlassSurface
      variant="card"
      as="section"
      className="ih-google-card"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="ih-display ih-card-title">
        {pack.copy.googleTitle}
      </h2>
      <p className="ih-card-body">
        {direct ? pack.copy.googleDirectBody : pack.copy.googleBody}
      </p>
      <button
        type="button"
        className="ih-button ih-button--primary"
        disabled={pending}
        aria-describedby={`${id}-hint`}
        onClick={onOpen}
      >
        {pack.copy.googleAction}
        <ArrowUpRightIcon size={20} />
        <span className="ih-sr-only"> {pack.copy.googleOpensLabel}</span>
      </button>
      <p id={`${id}-hint`} className="ih-hint">
        {pack.copy.googleHint}
      </p>
      {openFailed && <ImmersiveBanner message={pack.copy.googleOpenFailed} />}
    </GlassSurface>
  )
}
