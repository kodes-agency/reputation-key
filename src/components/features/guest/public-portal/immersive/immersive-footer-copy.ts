import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'

/** Every text the Immersive Hub footer shows, filled in and ready to render. */
export type ImmersiveFooterCopy = Readonly<{
  /** The visit-counting disclosure. */
  visitNotice: string
  /** The accessible name of the notice. */
  noticeLabel: string
  acknowledge: string
  privacyLink: string
  madeWith: string
}>

/**
 * The footer's texts from one v2 pack. The notice is the FULL disclosure
 * (`visitNoticeDetail`: the essential session cookie, the network marker, no
 * ads or trackers), not the shorter `visitNotice`. ADR 0044 requires the
 * notice to disclose the cookie and the marker, and the owner has not yet
 * approved shorter copy. When they do, this is the one line that changes.
 */
export function immersiveFooterCopy(
  pack: GuestPortalCopyV2,
  displayName: string,
): ImmersiveFooterCopy {
  return {
    visitNotice: guestCopyText(pack, 'visitNoticeDetail', { name: displayName }),
    noticeLabel: pack.copy.visitNoticeLabel,
    acknowledge: pack.copy.visitNoticeAcknowledge,
    privacyLink: pack.copy.privacyNoticeLink,
    madeWith: pack.copy.footerMadeWith,
  }
}
