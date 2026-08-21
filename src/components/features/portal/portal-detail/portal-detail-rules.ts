// Every decision the portal detail shell makes, with no JSX and no hooks: which
// tab is really active, which tabs are offered, whether that tab has a preview,
// and whether the theme draft diverges from what is saved. The shell reads as a
// flat description of what is on screen because the answers are derived here —
// the same split portal-share-state.ts makes for the Share tab.

import type { PortalThemeDraft } from '../shared/types'

export const PORTAL_DETAIL_TABS = ['settings', 'links', 'share', 'analytics'] as const
export type PortalDetailTab = (typeof PORTAL_DETAIL_TABS)[number]

// getPortalAnalyticsFn authorizes on the `dashboard.read` permission, which maps
// to the `dashboard.use` capability (shared/auth/capability-for-permission.ts) —
// independent of `portal.read`. With portals enabled and the dashboard
// capability off, opening the tab rendered the raw policy-denial reason in
// destructive red, so the tab is not offered at all. The route gate and the
// server assert are unchanged; this only prevents a dead end.
//
// Module-level singletons: `PortalDetailTabs` re-filters its trigger list
// whenever this value changes identity.
const ANALYTICS_HIDDEN: ReadonlyArray<PortalDetailTab> = ['analytics']
const NONE_HIDDEN: ReadonlyArray<PortalDetailTab> = []

/**
 * The live preview mirrors the theme draft and the link tree, so it only means
 * anything on the two tabs that edit them; Share and Analytics get neither the
 * toggle nor the panel.
 */
const TABS_WITH_PREVIEW: ReadonlyArray<PortalDetailTab> = ['settings', 'links']

export type PortalDetailView = Readonly<{
  /** The tab actually rendered — not always the one the URL asked for. */
  tab: PortalDetailTab
  hiddenTabs: ReadonlyArray<PortalDetailTab>
  showPreview: boolean
}>

export function derivePortalDetailView(
  requestedTab: PortalDetailTab,
  analyticsAvailable: boolean,
): PortalDetailView {
  // A `?tab=analytics` deep link must not resurrect the withheld tab: its panel
  // would render with no trigger to leave by.
  const analyticsWithheld = requestedTab === 'analytics' && !analyticsAvailable
  const tab = analyticsWithheld ? 'settings' : requestedTab
  return {
    tab,
    hiddenTabs: analyticsAvailable ? NONE_HIDDEN : ANALYTICS_HIDDEN,
    showPreview: TABS_WITH_PREVIEW.includes(tab),
  }
}

/**
 * Whether the in-progress theme differs from the saved one. Compared colour by
 * colour rather than by object identity: the detail query hands back a fresh
 * theme object on every refetch, so an identity check reports every draft as
 * dirty and the unsaved-changes prompt fires on navigation that lost nothing.
 */
export function isThemeDraftDirty(
  draft: PortalThemeDraft,
  saved: PortalThemeDraft,
): boolean {
  return (
    draft.primaryColor !== saved.primaryColor ||
    draft.backgroundColor !== saved.backgroundColor ||
    draft.textColor !== saved.textColor
  )
}
