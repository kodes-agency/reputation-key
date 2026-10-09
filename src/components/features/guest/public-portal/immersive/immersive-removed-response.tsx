import { useId, type RefObject } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { GlassSurface } from './glass-surface'
import { ImmersiveBanner } from './immersive-banner'
import { RestartIcon } from './immersive-icons'

export type ImmersiveRemovedResponseProps = Readonly<{
  pack: GuestPortalCopyV2
  response: GuestResponseView
  pending: boolean
  /** The last start over did not go through. */
  failed: boolean
  /** Focus lands on the notice's heading when the removal has just happened. */
  headingRef: RefObject<HTMLHeadingElement | null>
  /** Without it (a preview, a story) the notice stands alone: nothing to press. */
  onStartOver?: () => void
}>

/**
 * What the response area shows once the guest removed their rating, or never had
 * one: the notice that it was removed and, for a response the guest withdrew, a
 * way on. A withdrawn response ends its session's chance to rate (a session
 * takes one response), so without "Start over", which issues a fresh session,
 * the page was a dead end, including on a shared device. Only a withdrawn
 * response may start over: that is the server's rule (`canStartNewGuestResponse`),
 * and a button the server would refuse is not shown.
 */
export function ImmersiveRemovedResponse({
  pack,
  response,
  pending,
  failed,
  headingRef,
  onStartOver,
}: ImmersiveRemovedResponseProps) {
  return (
    <>
      <GlassSurface variant="card" as="section" role="status" className="ih-notice">
        <h2 ref={headingRef} tabIndex={-1} className="ih-display ih-card-title">
          {pack.copy.responseRemoveAllDoneTitle}
        </h2>
        <p className="ih-card-body">{pack.copy.responseRemoveAllDoneBody}</p>
      </GlassSurface>
      {response.status === 'deleted' && onStartOver && (
        <StartOver
          pack={pack}
          pending={pending}
          failed={failed}
          onStartOver={onStartOver}
        />
      )}
    </>
  )
}

/**
 * The same words as the shared-device block of "Your response", because it is the
 * same act: the next rating on this device, whether it is the next guest's or
 * the same guest's second thoughts.
 */
function StartOver({
  pack,
  pending,
  failed,
  onStartOver,
}: Readonly<{
  pack: GuestPortalCopyV2
  pending: boolean
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
