import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'

/** Every text the Immersive Hub footer shows, filled in and ready to render. */
export type ImmersiveFooterCopy = Readonly<{
  /** The one-line visit-counting notice. */
  visitNotice: string
  /** The accessible name of the notice. */
  noticeLabel: string
  acknowledge: string
  /**
   * What the privacy link says. The notice it opens is the English closed-beta
   * document (ADR 0044), so on a page in any other language the link says so,
   * in that language, instead of promising a text the guest cannot read.
   */
  privacyLink: string
  /** Read out after the link, which opens the notice in a tab of its own. */
  privacyLinkOpensNewTab: string
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
    privacyLink:
      pack.locale === 'en'
        ? pack.copy.privacyNoticeLink
        : pack.copy.privacyNoticeLinkInEnglish,
    privacyLinkOpensNewTab: pack.copy.linkOpensNewTab,
    madeWith: pack.copy.footerMadeWith,
  }
}
