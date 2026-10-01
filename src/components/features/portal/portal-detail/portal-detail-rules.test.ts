// Portal detail shell rules — the decisions the page used to make inline in
// JSX. The types cannot catch a wrong *value*: a withheld tab reappearing
// through a deep link, or a
// dirty check that reports every refetch as an unsaved edit.

import { describe, expect, it } from 'vitest'
import {
  PORTAL_DETAIL_TABS,
  derivePortalDetailView,
  describePendingChanges,
  canReviewAndPublish,
  describePortalStatus,
  isThemeDraftDirty,
  normalizePortalWorkspaceSearch,
} from './portal-detail-rules'

describe('normalizePortalWorkspaceSearch — which tab the URL asks for', () => {
  it('keeps every current tab as written', () => {
    for (const tab of PORTAL_DETAIL_TABS) {
      expect(normalizePortalWorkspaceSearch({ tab })).toEqual({ tab })
    }
  })

  it('opens the Page tab when the URL names no tab at all', () => {
    expect(normalizePortalWorkspaceSearch({})).toEqual({ tab: 'page' })
  })

  it('maps the legacy tab names onto the tab that now holds their content', () => {
    // Bookmarks, notification links and the e2e journeys still carry these.
    expect(normalizePortalWorkspaceSearch({ tab: 'settings' })).toEqual({ tab: 'page' })
    expect(normalizePortalWorkspaceSearch({ tab: 'links' })).toEqual({
      tab: 'page',
      section: 'linktree',
    })
    expect(normalizePortalWorkspaceSearch({ tab: 'analytics' })).toEqual({
      tab: 'results',
    })
  })

  it.each([['nonsense'], [''], [42], [null], [['share']], [{}]])(
    'falls back to the Page tab for the unknown value %j',
    (tab) => {
      expect(normalizePortalWorkspaceSearch({ tab })).toEqual({ tab: 'page' })
    },
  )

  it('keeps a valid section on the Page tab', () => {
    expect(normalizePortalWorkspaceSearch({ tab: 'page', section: 'linktree' })).toEqual({
      tab: 'page',
      section: 'linktree',
    })
  })

  it('lets a section stand alone, since the Page tab is the default', () => {
    expect(normalizePortalWorkspaceSearch({ section: 'private-note' })).toEqual({
      tab: 'page',
      section: 'private-note',
    })
  })

  it.each([['nonsense'], [''], [7], [null], [['look']]])(
    'drops the unknown section %j rather than failing the page',
    (section) => {
      expect(normalizePortalWorkspaceSearch({ tab: 'page', section })).toEqual({
        tab: 'page',
      })
    },
  )

  it('drops a section on any tab that has no sections', () => {
    expect(normalizePortalWorkspaceSearch({ tab: 'share', section: 'look' })).toEqual({
      tab: 'share',
    })
    expect(normalizePortalWorkspaceSearch({ tab: 'analytics', section: 'look' })).toEqual(
      {
        tab: 'results',
      },
    )
  })

  it('lets an explicit section beat the one a legacy tab name implies', () => {
    expect(normalizePortalWorkspaceSearch({ tab: 'links', section: 'footer' })).toEqual({
      tab: 'page',
      section: 'footer',
    })
  })

  it('drops every other search key, so a stray parameter cannot reach the page', () => {
    expect(normalizePortalWorkspaceSearch({ tab: 'share', propertyId: 'x' })).toEqual({
      tab: 'share',
    })
  })

  it('reads a non-object search as no search', () => {
    expect(normalizePortalWorkspaceSearch(undefined)).toEqual({ tab: 'page' })
    expect(normalizePortalWorkspaceSearch('tab=share')).toEqual({ tab: 'page' })
  })
})

describe('derivePortalDetailView — which tab is really active', () => {
  it('takes every tab as requested when results is available', () => {
    for (const tab of PORTAL_DETAIL_TABS) {
      expect(derivePortalDetailView(tab, true).tab).toBe(tab)
    }
  })

  it('refuses a ?tab=results deep link once the capability is absent', () => {
    expect(derivePortalDetailView('results', false).tab).toBe('page')
  })

  it('withholds only the results tab, and only for that capability', () => {
    for (const tab of PORTAL_DETAIL_TABS.filter((t) => t !== 'results')) {
      expect(derivePortalDetailView(tab, false).tab).toBe(tab)
    }
  })
})

describe('derivePortalDetailView — which tabs are offered', () => {
  it('hides the results tab exactly when the capability is absent', () => {
    expect(derivePortalDetailView('page', false).hiddenTabs).toEqual(['results'])
    expect(derivePortalDetailView('page', true).hiddenTabs).toEqual([])
  })

  it('returns the same array identity for the same answer', () => {
    // The tab strip re-filters its links whenever this value changes identity,
    // so a fresh array per render would rebuild it on every keystroke.
    expect(derivePortalDetailView('page', false).hiddenTabs).toBe(
      derivePortalDetailView('share', false).hiddenTabs,
    )
    expect(derivePortalDetailView('page', true).hiddenTabs).toBe(
      derivePortalDetailView('history', true).hiddenTabs,
    )
  })
})

describe('describePortalStatus — the quiet line under the portal name', () => {
  it('names the live version when one is live', () => {
    expect(describePortalStatus('published', 5)).toBe('Live · version 5')
  })

  it('says only Live for a published portal with no readable version', () => {
    expect(describePortalStatus('published', null)).toBe('Live')
  })

  it('says a draft is not public', () => {
    expect(describePortalStatus('draft', null)).toBe('Draft · not published')
  })

  it('does not call a disabled or archived portal live, whatever version it last had', () => {
    expect(describePortalStatus('disabled', null)).toBe('Disabled')
    expect(describePortalStatus('disabled', 4)).toBe('Disabled')
    expect(describePortalStatus('archived', 4)).toBe('Archived')
  })
})

describe('canReviewAndPublish — who is offered the publish step', () => {
  const allowed = { canUpdate: true, portalWriteEnabled: true } as const

  it('offers it to a manager who can update the portal', () => {
    expect(canReviewAndPublish(allowed, 'draft')).toBe(true)
    expect(canReviewAndPublish(allowed, 'published')).toBe(true)
    expect(canReviewAndPublish(allowed, 'disabled')).toBe(true)
  })

  it('never offers it to someone who cannot update the portal', () => {
    expect(canReviewAndPublish({ ...allowed, canUpdate: false }, 'published')).toBe(false)
  })

  it('never offers it while the organisation has portal writes switched off', () => {
    // The review route is gated on the write capability, so the button would
    // lead to the capability-denied page.
    expect(
      canReviewAndPublish({ ...allowed, portalWriteEnabled: false }, 'published'),
    ).toBe(false)
  })

  it('never offers it for an archived portal, which nothing can publish', () => {
    expect(canReviewAndPublish(allowed, 'archived')).toBe(false)
  })
})

describe('describePendingChanges — the "not live" note in the header', () => {
  const base = { current: null, priorActivations: [], nextCursor: null } as const

  it('says nothing when the draft matches what guests see', () => {
    expect(describePendingChanges({ ...base, hasPendingChanges: false })).toBeNull()
  })

  it('counts the changes when the read lists them', () => {
    const changed = (key: string) => ({
      kind: 'portal_links' as const,
      key,
      changedAt: '2026-09-30T10:00:00.000Z',
    })
    expect(
      describePendingChanges({
        ...base,
        hasPendingChanges: true,
        pendingChanges: [changed('a'), changed('b')],
      }),
    ).toBe('2 changes not live')
    expect(
      describePendingChanges({
        ...base,
        hasPendingChanges: true,
        pendingChanges: [changed('a')],
      }),
    ).toBe('1 change not live')
  })

  it('still says something is not live when the read gives no list', () => {
    expect(describePendingChanges({ ...base, hasPendingChanges: true })).toBe(
      'Changes not live',
    )
  })
})

describe('isThemeDraftDirty', () => {
  const saved = {
    primaryColor: '#112233',
    backgroundColor: '#ffffff',
    textColor: '#000000',
  }

  it('reports a fresh object with equal colours as clean', () => {
    // The detail query hands back a new theme object on every refetch; an
    // identity check here fires the unsaved-changes prompt on navigation that
    // would lose nothing.
    expect(isThemeDraftDirty({ ...saved }, saved)).toBe(false)
  })

  it('notices a change in any one of the three colours', () => {
    expect(isThemeDraftDirty({ ...saved, primaryColor: '#000001' }, saved)).toBe(true)
    expect(isThemeDraftDirty({ ...saved, backgroundColor: '#000001' }, saved)).toBe(true)
    expect(isThemeDraftDirty({ ...saved, textColor: '#000001' }, saved)).toBe(true)
  })

  it('treats an omitted optional colour as different from a set one', () => {
    // Portals created before theming was exposed store only a primary colour,
    // so undefined and a value are genuinely different drafts.
    expect(isThemeDraftDirty({ primaryColor: saved.primaryColor }, saved)).toBe(true)
    expect(isThemeDraftDirty(saved, { primaryColor: saved.primaryColor })).toBe(true)
  })
})
