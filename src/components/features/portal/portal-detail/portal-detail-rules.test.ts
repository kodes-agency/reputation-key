// Portal detail shell rules — the decisions the page used to make inline in
// JSX. The types cannot catch a wrong *value*: a withheld tab reappearing
// through a deep link, the preview following a tab that cannot show one, or a
// dirty check that reports every refetch as an unsaved edit.

import { describe, expect, it } from 'vitest'
import {
  PORTAL_DETAIL_TABS,
  derivePortalDetailView,
  isThemeDraftDirty,
} from './portal-detail-rules'

describe('derivePortalDetailView — which tab is really active', () => {
  it('takes every tab as requested when analytics is available', () => {
    for (const tab of PORTAL_DETAIL_TABS) {
      expect(derivePortalDetailView(tab, true).tab).toBe(tab)
    }
  })

  it('refuses a ?tab=analytics deep link once the capability is absent', () => {
    expect(derivePortalDetailView('analytics', false).tab).toBe('settings')
  })

  it('withholds only the analytics tab, and only for that capability', () => {
    for (const tab of PORTAL_DETAIL_TABS.filter((t) => t !== 'analytics')) {
      expect(derivePortalDetailView(tab, false).tab).toBe(tab)
    }
  })
})

describe('derivePortalDetailView — which tabs are offered', () => {
  it('hides the analytics tab exactly when the capability is absent', () => {
    expect(derivePortalDetailView('settings', false).hiddenTabs).toEqual(['analytics'])
    expect(derivePortalDetailView('settings', true).hiddenTabs).toEqual([])
  })

  it('returns the same array identity for the same answer', () => {
    // The tab strip re-filters its triggers whenever this value changes
    // identity, so a fresh array per render would rebuild it on every keystroke.
    expect(derivePortalDetailView('settings', false).hiddenTabs).toBe(
      derivePortalDetailView('links', false).hiddenTabs,
    )
    expect(derivePortalDetailView('settings', true).hiddenTabs).toBe(
      derivePortalDetailView('share', true).hiddenTabs,
    )
  })
})

describe('derivePortalDetailView — where the preview belongs', () => {
  it('offers the preview only on the tabs that edit what it mirrors', () => {
    expect(derivePortalDetailView('settings', true).showPreview).toBe(true)
    expect(derivePortalDetailView('links', true).showPreview).toBe(true)
    expect(derivePortalDetailView('share', true).showPreview).toBe(false)
    expect(derivePortalDetailView('analytics', true).showPreview).toBe(false)
  })

  it('follows the tab that renders, not the one the URL asked for', () => {
    // The withheld analytics deep link lands on settings, which HAS a preview.
    expect(derivePortalDetailView('analytics', false).showPreview).toBe(true)
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
