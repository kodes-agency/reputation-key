import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'

/** Every text the Immersive Hub footer shows, filled in and ready to render. */
export type ImmersiveFooterCopy = Readonly<{
  /** The one-line visit-counting notice. */
  visitNotice: string
  /** The accessible name of the notice. */
  noticeLabel: string
  acknowledge: string
  privacyLink: string
  madeWith: string
}>

/**
 * The footer's texts from one v2 pack. The notice is the pack's one line
 * (`visitNotice`): the essential cookie, the privacy-protected marker, no ads
 * or trackers. ADR 0044 requires the notice to disclose the cookie and the
 * marker, and that one line does; the owner approved it for every language.
 */
export function immersiveFooterCopy(
  pack: GuestPortalCopyV2,
  displayName: string,
): ImmersiveFooterCopy {
  return {
    visitNotice: guestCopyText(pack, 'visitNotice', { name: displayName }),
    noticeLabel: pack.copy.visitNoticeLabel,
    acknowledge: pack.copy.visitNoticeAcknowledge,
    privacyLink: pack.copy.privacyNoticeLink,
    madeWith: pack.copy.footerMadeWith,
  }
}
