// Guest feature — public API.
export { PublicPortalContent } from './public-portal/public-portal-content'
export type {
  PortalCategory,
  PortalLinkItem,
} from './public-portal/public-portal-content'
export { PortalUnavailable } from './portal-unavailable'
export { GuestAnalyticsNotice } from './guest-analytics-notice'
// What the admin's live preview draws the Immersive Hub from: the page frame
// and its glass, and the generation 2 copy packs (loaded one language at a time).
export { ImmersiveShell } from './public-portal/immersive/immersive-shell'
export { GlassSurface, glassClassName } from './public-portal/immersive/glass-surface'
export { loadGuestPortalCopyV2 } from './public-portal/language-packs/load-guest-copy-v2'
export type { GuestPortalCopyV2 } from './public-portal/language-packs/guest-copy-v2'
export { formatGuestPlural, guestCopyText } from './public-portal/guest-copy-format'
