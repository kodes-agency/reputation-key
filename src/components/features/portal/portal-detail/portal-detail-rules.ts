// Every decision the portal workspace shell makes, with no JSX and no hooks:
// which tab the URL really asks for, which tabs are offered, what the quiet status line says, and whether the theme draft
// diverges from what is saved. The shell reads as a flat description of what is
// on screen because the answers are derived here — the same split
// portal-share-state.ts makes for the Share tab.

import type { PortalPublicationHistory } from '#/contexts/portal/application/public-api'
import type { PortalPublicationState } from '../shared/types'
import {
  isPortalEditorSection,
  type PortalEditorSection,
} from '../portal-editor/portal-editor-sections'

export const PORTAL_DETAIL_TABS = ['page', 'share', 'results', 'history'] as const
export type PortalDetailTab = (typeof PORTAL_DETAIL_TABS)[number]

/**
 * The tab names the workspace replaced. Bookmarks, notification rows already
 * delivered and the e2e journeys still carry them, so they resolve to the tab
 * that now holds what they used to show: Settings and Links are both parts of
 * the Page tab (Links is its Linktree section), and Analytics became Results.
 */
const LEGACY_TABS: Readonly<
  Record<string, Readonly<{ tab: PortalDetailTab; section?: PortalEditorSection }>>
> = {
  settings: { tab: 'page' },
  links: { tab: 'page', section: 'linktree' },
  analytics: { tab: 'results' },
}

const isPortalDetailTab = (value: string): value is PortalDetailTab =>
  (PORTAL_DETAIL_TABS as readonly string[]).includes(value)

/** The workspace's route search after normalization. */
export type PortalWorkspaceSearch = Readonly<{
  tab: PortalDetailTab
  /** Only ever set on the Page tab, the only tab that has sections. */
  section?: PortalEditorSection
}>

const searchValue = (search: unknown, key: string): unknown =>
  typeof search === 'object' && search !== null && key in search
    ? (search as Record<string, unknown>)[key]
    : undefined

/**
 * The workspace's route search: `tab`, always one of the four current tabs, and
 * on the Page tab an optional `section`. Anything else — an unknown name, a
 * non-string, a missing key, other keys — resolves to the Page tab (and its
 * default section) rather than an error page, because a stale link should still
 * open the portal.
 */
export function normalizePortalWorkspaceSearch(search: unknown): PortalWorkspaceSearch {
  const rawTab = searchValue(search, 'tab')
  const rawSection = searchValue(search, 'section')
  const resolved = resolveTab(rawTab)
  if (resolved.tab !== 'page') return { tab: resolved.tab }
  const section = isPortalEditorSection(rawSection) ? rawSection : resolved.section
  return section === undefined ? { tab: 'page' } : { tab: 'page', section }
}

function resolveTab(raw: unknown): Readonly<{
  tab: PortalDetailTab
  section?: PortalEditorSection
}> {
  if (typeof raw !== 'string') return { tab: 'page' }
  if (isPortalDetailTab(raw)) return { tab: raw }
  return LEGACY_TABS[raw] ?? { tab: 'page' }
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

export type PortalDetailView = Readonly<{
  /** The tab actually rendered — not always the one the URL asked for. */
  tab: PortalDetailTab
  hiddenTabs: ReadonlyArray<PortalDetailTab>
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
  }
}

/**
 * The one quiet line under the portal name. Status is not the point of this
 * page, so it is a phrase, not a panel: what guests can open right now, which
 * version that is when there is one, and "up to date" when `upToDate` says the
 * live page matches its draft and nothing stops guests opening it (the header
 * then offers no publish step). A problem that stops guests follows the line
 * itself (`workspaceStatusProblem`), so it is never "up to date" beside it.
 */
export function describePortalStatus(
  state: PortalPublicationState,
  liveVersion: number | null,
  upToDate = false,
): string {
  switch (state) {
    case 'published':
      if (liveVersion === null) return 'Live'
      return upToDate
        ? `Live · version ${liveVersion} · up to date`
        : `Live · version ${liveVersion}`
    case 'draft':
      return 'Draft · not published'
    case 'disabled':
      return 'Disabled'
    case 'archived':
      return 'Archived'
  }
}

/**
 * Whether the header offers "Review & publish". An archived portal is restored
 * from the Portals list first, so there is nothing to publish here. The review
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
 * Whether Review & publish has anything to put live: a draft that was never
 * published, a disabled page (it comes back through review, like a first
 * publish), or a live page with saved changes waiting. The Portals list's row
 * menu offers the step by the same rule. A live page that matches its draft has
 * nothing to publish, so the header does not make the step its loudest control.
 */
export function hasSomethingToPublish(
  state: PortalPublicationState,
  hasPendingChanges: boolean,
): boolean {
  if (state === 'archived') return false
  return state !== 'published' || hasPendingChanges
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
 * How many changes the draft holds, for the History tab's rail. The read's own
 * list when it gives one; a draft the flag knows differs but cannot list counts
 * as one, so the rail never says "no changes" about a draft that has some.
 */
export function countPendingChanges(history: PortalPublicationHistory): number {
  if (!history.hasPendingChanges) return 0
  return Math.max(1, history.pendingChanges?.length ?? 0)
}

/**
 * The browser tab's title for one portal's workspace, before the product name
 * (`documentTitle`): the portal's own name, so two open portals, and the
 * history, can be told apart. The review step says it is a review. Here rather
 * than beside the workspace's route checks because the routes' `head` reads it,
 * and these rules are already in first paint (`normalizePortalWorkspaceSearch`).
 */
export function portalWorkspaceTitle(
  portalName: string,
  mode: 'edit' | 'review',
): string {
  const name = portalName.trim() === '' ? 'Untitled portal' : portalName.trim()
  return mode === 'review' ? `Review: ${name}` : `${name} · Portal`
}
