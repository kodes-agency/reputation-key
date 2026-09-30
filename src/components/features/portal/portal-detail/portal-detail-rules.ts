// Every decision the portal workspace shell makes, with no JSX and no hooks:
// which tab the URL really asks for, which tabs are offered, whether that tab
// has a preview, what the quiet status line says, and whether the theme draft
// diverges from what is saved. The shell reads as a flat description of what is
// on screen because the answers are derived here — the same split
// portal-share-state.ts makes for the Share tab.

import type { PortalPublicationHistory } from '#/contexts/portal/application/public-api'
import type { PortalPublicationState, PortalThemeDraft } from '../shared/types'

export const PORTAL_DETAIL_TABS = ['page', 'share', 'results', 'history'] as const
export type PortalDetailTab = (typeof PORTAL_DETAIL_TABS)[number]

/**
 * The tab names the workspace replaced. Bookmarks, notification rows already
 * delivered and the e2e journeys still carry them, so they resolve to the tab
 * that now holds what they used to show: Settings and Links are both sections
 * of the Page tab, and Analytics became Results.
 */
const LEGACY_TABS: Readonly<Record<string, PortalDetailTab>> = {
  settings: 'page',
  links: 'page',
  analytics: 'results',
}

const isPortalDetailTab = (value: string): value is PortalDetailTab =>
  (PORTAL_DETAIL_TABS as readonly string[]).includes(value)

/**
 * The workspace's route search: only `tab`, always one of the four current
 * tabs. Anything else — an unknown name, a non-string, a missing key, other
 * keys — resolves to the Page tab rather than an error page, because a stale
 * link should still open the portal.
 */
export function normalizePortalWorkspaceSearch(search: unknown): {
  tab: PortalDetailTab
} {
  const raw =
    typeof search === 'object' && search !== null && 'tab' in search
      ? (search as { tab: unknown }).tab
      : undefined
  if (typeof raw !== 'string') return { tab: 'page' }
  if (isPortalDetailTab(raw)) return { tab: raw }
  return { tab: LEGACY_TABS[raw] ?? 'page' }
}

// getPortalAnalyticsFn authorizes on the `dashboard.read` permission, which maps
// to the `dashboard.use` capability (shared/auth/capability-for-permission.ts) —
// independent of `portal.read`. With portals enabled and the dashboard
// capability off, opening the Results tab rendered the raw policy-denial reason
// in destructive red, so the tab is not offered at all. The route gate and the
// server assert are unchanged; this only prevents a dead end.
//
// Module-level singletons: `PortalWorkspaceTabs` re-filters its link list
// whenever this value changes identity.
const RESULTS_HIDDEN: ReadonlyArray<PortalDetailTab> = ['results']
const NONE_HIDDEN: ReadonlyArray<PortalDetailTab> = []

/**
 * The live preview mirrors the theme draft and the link tree, so it only means
 * anything on the tab that edits them; Share, Results and History get neither
 * the toggle nor the panel.
 */
const TABS_WITH_PREVIEW: ReadonlyArray<PortalDetailTab> = ['page']

export type PortalDetailView = Readonly<{
  /** The tab actually rendered — not always the one the URL asked for. */
  tab: PortalDetailTab
  hiddenTabs: ReadonlyArray<PortalDetailTab>
  showPreview: boolean
}>

export function derivePortalDetailView(
  requestedTab: PortalDetailTab,
  resultsAvailable: boolean,
): PortalDetailView {
  // A `?tab=results` deep link must not resurrect the withheld tab: its panel
  // would render with no link to leave by.
  const resultsWithheld = requestedTab === 'results' && !resultsAvailable
  const tab = resultsWithheld ? 'page' : requestedTab
  return {
    tab,
    hiddenTabs: resultsAvailable ? NONE_HIDDEN : RESULTS_HIDDEN,
    showPreview: TABS_WITH_PREVIEW.includes(tab),
  }
}

/**
 * The one quiet line under the portal name. Status is not the point of this
 * page, so it is a phrase, not a panel: what guests can open right now, and
 * which version that is when there is one.
 */
export function describePortalStatus(
  state: PortalPublicationState,
  liveVersion: number | null,
): string {
  switch (state) {
    case 'published':
      return liveVersion === null ? 'Live' : `Live · version ${liveVersion}`
    case 'draft':
      return 'Draft · not published'
    case 'disabled':
      return 'Disabled'
    case 'archived':
      return 'Archived'
  }
}

/**
 * Whether the header offers "Review & publish". Archival is terminal in this
 * UI (see PUBLICATION_TOGGLES), so there is nothing left to publish. The review
 * route needs both the role's `portal.update` permission and the organisation's
 * `portal.write` capability (a separate controlled-beta switch from reading), and
 * the server refuses the write without either — this only keeps a button off the
 * page that would lead to a denial.
 */
export function canReviewAndPublish(
  access: Readonly<{ canUpdate: boolean; portalWriteEnabled: boolean }>,
  state: PortalPublicationState,
): boolean {
  return access.canUpdate && access.portalWriteEnabled && state !== 'archived'
}

/**
 * The header's "N changes not live" note, or null when the saved draft matches
 * what guests see. The count is the read's own list when it gives one; without
 * it the note still says something is waiting, which is all the flag knows.
 */
export function describePendingChanges(history: PortalPublicationHistory): string | null {
  if (!history.hasPendingChanges) return null
  const count = history.pendingChanges?.length ?? 0
  if (count === 0) return 'Changes not live'
  return count === 1 ? '1 change not live' : `${count} changes not live`
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
