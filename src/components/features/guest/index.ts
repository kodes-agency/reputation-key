// Guest feature — public API.
export { PublicPortalContent } from './public-portal/public-portal-content'
export type {
  PortalCategory,
  PortalLinkItem,
} from './public-portal/public-portal-content'
export { PortalUnavailable } from './portal-unavailable'
export { ImmersivePublicPortal } from './public-portal/immersive/immersive-public-portal'
export { GuestAnalyticsNotice } from './guest-analytics-notice'
// What the admin's live preview draws the Immersive Hub from: the page frame
// and its glass, the header, the title block, the response area the guest
// answers in (the same view, driven by a controlled state), the Linktree and
// the footer (each in its inert mode: nothing opens, follows or is recorded),
// and the generation 2 copy packs (loaded one language at a time).
export { ImmersiveShell } from './public-portal/immersive/immersive-shell'
export { glassClassName } from './public-portal/immersive/glass-surface'
export { loadGuestPortalCopyV2 } from './public-portal/language-packs/load-guest-copy-v2'
export type { GuestPortalCopyV2 } from './public-portal/language-packs/guest-copy-v2'
export { guestCopyText } from './public-portal/guest-copy-format'
export { GuestHeader } from './public-portal/immersive/guest-header'
export { GuestTitleBlock } from './public-portal/immersive/guest-title-block'
export { InertLanguageChip } from './public-portal/immersive/guest-language-switcher'
export { InertImmersiveLinktree } from './public-portal/immersive/immersive-linktree'
export type { ImmersiveLinktreeLink } from './public-portal/immersive/immersive-linktree'
export { InertImmersiveFooterView } from './public-portal/immersive/immersive-footer'
export { immersiveFooterCopy } from './public-portal/immersive/immersive-footer-copy'
export { ImmersiveResponseView } from './public-portal/immersive/immersive-response-view'
export { immersiveResponseProps } from './public-portal/immersive/immersive-response-preview'
export type { GuestPagePreviewState } from './public-portal/guest-page-preview-state'
