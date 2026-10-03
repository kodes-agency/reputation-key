// One collapse mode for the app. ManagerSidebar and SettingsSidebar share the
// shell's single open state, so both must collapse the same way: to the icon
// rail. When Settings used `offcanvas`, collapsing the app sidebar on any page
// and then opening Settings slid the settings navigation fully off-screen with
// no rail to bring it back, 'Back to app' included.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  Sidebar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from './sidebar'

function render(open: boolean, collapsible?: 'offcanvas' | 'icon' | 'none'): string {
  return renderToStaticMarkup(
    createElement(
      SidebarProvider,
      { open },
      createElement(Sidebar, collapsible === undefined ? null : { collapsible }, 'nav'),
    ),
  )
}

describe('Sidebar collapse mode', () => {
  it('collapses to the icon rail unless a caller says otherwise', () => {
    const html = render(false)

    expect(html).toContain('data-state="collapsed"')
    expect(html).toContain('data-collapsible="icon"')
  })

  it('names no collapse mode while expanded', () => {
    const html = render(true)

    expect(html).toContain('data-state="expanded"')
    expect(html).toContain('data-collapsible=""')
  })

  it('still lets a caller ask for another mode explicitly', () => {
    expect(render(false, 'offcanvas')).toContain('data-collapsible="offcanvas"')
  })
})

const SRC = join(__dirname, '..', '..')
const PRIMITIVE = join(__dirname, 'sidebar.tsx')

function sourceFiles(dir: string): ReadonlyArray<string> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx$/u.test(entry.name) ? [path] : []
  })
}

describe('the app sidebars', () => {
  it('none opts out of the icon rail', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== PRIMITIVE)
      .filter((path) => /collapsible=["{'`]+offcanvas/u.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path).split(sep).join('/'))

    expect(offenders).toEqual([])
  })
})

describe('Sidebar rows on a phone', () => {
  // The drawer's rows were 32px and its sub-rows 28px with no phone bump, against
  // the 44px a tap target is everywhere else (UI consistency scan: NAV-07).
  const rows = renderToStaticMarkup(
    createElement(
      SidebarProvider,
      null,
      createElement(
        SidebarMenu,
        null,
        createElement(
          SidebarMenuItem,
          null,
          createElement(SidebarMenuButton, null, 'Dashboard'),
          createElement(
            SidebarMenuSub,
            null,
            createElement(
              SidebarMenuSubItem,
              null,
              createElement(SidebarMenuSubButton, null, 'Ratings'),
            ),
          ),
        ),
      ),
    ),
  )

  it('keeps a menu row at the touch height below md', () => {
    const row = /<button [^>]*data-slot="sidebar-menu-button"[^>]*>/u.exec(rows)?.[0]

    expect(row).toContain('max-md:min-h-(--control-touch)')
  })

  it('keeps a sub-row at the touch height below md', () => {
    const row = /<a [^>]*data-slot="sidebar-menu-sub-button"[^>]*>/u.exec(rows)?.[0]

    expect(row).toContain('max-md:min-h-(--control-touch)')
  })
})

describe('Sidebar rows share the focus ring', () => {
  // The sidebar drew its own 2px ring in its own token while every other control wore
  // the Button's (UI consistency scan: NAV-05).
  const html = renderToStaticMarkup(
    createElement(
      SidebarProvider,
      null,
      createElement(
        SidebarMenu,
        null,
        createElement(
          SidebarMenuItem,
          null,
          createElement(SidebarMenuButton, null, 'Dashboard'),
          createElement(
            SidebarMenuSub,
            null,
            createElement(
              SidebarMenuSubItem,
              null,
              createElement(SidebarMenuSubButton, null, 'Ratings'),
            ),
          ),
        ),
      ),
    ),
  )
  const button = /<button [^>]*data-slot="sidebar-menu-button"[^>]*>/u.exec(html)?.[0]
  const sub = /<a [^>]*data-slot="sidebar-menu-sub-button"[^>]*>/u.exec(html)?.[0]
  const OLD_RING = ['focus-visible', 'ring-2'].join(':')

  it.each([
    ['a menu row', button],
    ['a sub-row', sub],
  ])('is the shared ring on %s, not a ring of its own', (_name, row) => {
    expect(row).toContain('focus-ring')
    expect(row).not.toContain(OLD_RING)
    expect(row).not.toContain('ring-sidebar-ring')
  })
})
