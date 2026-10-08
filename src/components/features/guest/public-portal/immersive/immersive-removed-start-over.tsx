import { useId } from 'react'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { ImmersiveBanner } from './immersive-banner'
import { RestartIcon } from './immersive-icons'

/**
 * What follows "Your response was removed": a way on. The removal ended the
 * session's response for good (a session takes one), so a fresh page needs a
 * fresh session, which is what "Start over" issues. The same words as the
 * shared-device block of "Your response", because it is the same act: the next
 * rating on this device, whether it is the next guest's or the same guest's
 * second thoughts.
 */
export function ImmersiveRemovedStartOver({
  pack,
  pending,
  failed,
  onStartOver,
}: Readonly<{
  pack: GuestPortalCopyV2
  pending: boolean
  /** The last start over did not go through. */
  failed: boolean
  onStartOver: () => void
}>) {
  const titleId = useId()
  return (
    <section className="ih-removed" aria-labelledby={titleId}>
      {failed && <ImmersiveBanner message={pack.copy.startOverFailed} />}
      <p id={titleId} className="ih-yr__row-title">
        {pack.copy.sharedDeviceTitle}
      </p>
      <p className="ih-yr__detail">{pack.copy.sharedDeviceBody}</p>
      <button
        type="button"
        className="ih-button ih-button--outline ih-removed__start-over"
        disabled={pending}
        onClick={onStartOver}
      >
        <RestartIcon size={16} />
        {pack.copy.startOverAction}
      </button>
    </section>
  )
}
