import { describe, expect, it } from 'vitest'
import { inboxUsesCompactLayout, sidebarWidthPx } from './use-inbox-compact-layout'

const PHONE = { isMobile: true, open: true }
const RAIL = { isMobile: false, open: false }
const OPEN = { isMobile: false, open: true }

describe('sidebarWidthPx', () => {
  it('takes no room on a phone, where the sidebar is a sheet', () => {
    expect(sidebarWidthPx(PHONE)).toBe(0)
  })

  it('takes the rail or the open width on a desktop', () => {
    expect(sidebarWidthPx(RAIL)).toBe(48)
    expect(sidebarWidthPx(OPEN)).toBe(256)
  })

  it('assumes the rail when there is no shell around the page', () => {
    expect(sidebarWidthPx(null)).toBe(48)
  })
})

describe('inboxUsesCompactLayout', () => {
  const compactAt = (viewport: number, sidebar: Parameters<typeof sidebarWidthPx>[0]) =>
    inboxUsesCompactLayout(viewport, sidebarWidthPx(sidebar))

  it.each([
    [1024, PHONE, false],
    [1024, RAIL, true],
    [1024, OPEN, true],
    [1280, RAIL, false],
    [1280, OPEN, false],
    [1366, RAIL, false],
    [1366, OPEN, false],
    [1440, RAIL, false],
    [1440, OPEN, false],
  ] as const)('at %i px with %o is compact: %s', (viewport, sidebar, compact) => {
    expect(compactAt(viewport, sidebar)).toBe(compact)
  })

  it('switches at the room the three panes need beside the sidebar', () => {
    expect(compactAt(1069, RAIL)).toBe(true)
    expect(compactAt(1070, RAIL)).toBe(false)
    expect(compactAt(1277, OPEN)).toBe(true)
    expect(compactAt(1278, OPEN)).toBe(false)
  })
})
