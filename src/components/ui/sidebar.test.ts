// One collapse mode for the app. ManagerSidebar and SettingsSidebar share the
// shell's single open state, so both must collapse the same way: to the icon
// rail. When Settings used `offcanvas`, collapsing the app sidebar on any page
// and then opening Settings slid the settings navigation fully off-screen with
// no rail to bring it back, 'Back to app' included.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  isSidebarShortcut,
  Sidebar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from './sidebar'

const OPEN = { open: true, onOpenChange: () => {} }

function render(open: boolean): string {
  return renderToStaticMarkup(
    createElement(
      SidebarProvider,
      { open, onOpenChange: () => {} },
      createElement(Sidebar, null, 'nav'),
    ),
  )
}

describe('Sidebar collapse mode', () => {
  it('collapses to the icon rail', () => {
    const html = render(false)

    expect(html).toContain('data-state="collapsed"')
    expect(html).toContain('data-collapsible="icon"')
  })

  it('names no collapse mode while expanded', () => {
    const html = render(true)

    expect(html).toContain('data-state="expanded"')
    expect(html).toContain('data-collapsible=""')
  })
})

describe('Sidebar rows on a phone', () => {
  // The drawer's rows were 32px and its sub-rows 28px with no phone bump, against
  // the 44px a tap target is everywhere else (UI consistency scan: NAV-07).
  const rows = renderToStaticMarkup(
    createElement(
      SidebarProvider,
      OPEN,
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
      OPEN,
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

describe('the sidebar look', () => {
  // It lives in the primitive, not in global CSS (UI consistency scan: FRAME-06).
  const html = renderToStaticMarkup(
    createElement(
      SidebarProvider,
      OPEN,
      createElement(
        SidebarMenu,
        null,
        createElement(
          SidebarMenuItem,
          null,
          createElement(SidebarMenuButton, { isActive: true }, 'Dashboard'),
        ),
      ),
    ),
  )
  const row = /<button [^>]*data-slot="sidebar-menu-button"[^>]*>/u.exec(html)?.[0]

  it('marks the current row with the accent-muted fill, a semibold label and an accent icon', () => {
    for (const className of [
      'data-[active=true]:bg-sidebar-accent',
      'data-[active=true]:font-semibold',
      '[&amp;_svg]:text-(--accent)',
      'text-sidebar-foreground',
    ]) {
      expect(row).toContain(className)
    }
    expect(row).toContain('data-active="true"')
  })
})

describe('the sidebar shortcut', () => {
  const press = (over: Partial<Parameters<typeof isSidebarShortcut>[0]> = {}) =>
    isSidebarShortcut({
      key: 'b',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      isComposing: false,
      ...over,
    })

  it('is Cmd+B and Ctrl+B', () => {
    expect(press()).toBe(true)
    expect(press({ metaKey: false, ctrlKey: true })).toBe(true)
  })

  it('is not B without Cmd or Ctrl, or another key', () => {
    expect(press({ metaKey: false })).toBe(false)
    expect(press({ key: 'k' })).toBe(false)
  })

  it('leaves a held key, a composition and chords with Shift or Alt alone', () => {
    expect(press({ repeat: true })).toBe(false)
    expect(press({ isComposing: true })).toBe(false)
    expect(press({ shiftKey: true })).toBe(false)
    expect(press({ altKey: true })).toBe(false)
  })

  it('leaves a contentEditable field alone, where the chord is Bold', () => {
    const editable = { isContentEditable: true } as unknown as EventTarget
    const plain = { isContentEditable: false } as unknown as EventTarget

    expect(press({ target: editable })).toBe(false)
    expect(press({ target: plain })).toBe(true)
  })
})

describe('the sidebar trigger', () => {
  const html = renderToStaticMarkup(
    createElement(
      SidebarProvider,
      { open: false, onOpenChange: () => {} },
      createElement(Sidebar, null, 'nav'),
      createElement(SidebarTrigger),
    ),
  )

  it('says whether the sidebar is open, and which element it controls', () => {
    const trigger = /<button [^>]*data-slot="sidebar-trigger"[^>]*>/u.exec(html)?.[0]
    const container = /<div [^>]*data-slot="sidebar-container"[^>]*>/u.exec(html)?.[0]
    const controls = /aria-controls="([^"]+)"/u.exec(trigger ?? '')?.[1]

    expect(trigger).toContain('aria-expanded="false"')
    expect(controls).toBeDefined()
    expect(container).toContain(`id="${controls}"`)
  })

  it('stops every sidebar transition under reduced motion', () => {
    const slots = ['sidebar-gap', 'sidebar-container']
    for (const slot of slots) {
      const element = new RegExp(`<div [^>]*data-slot="${slot}"[^>]*>`, 'u').exec(
        html,
      )?.[0]
      expect(element).toContain('motion-reduce:transition-none')
    }
  })
})
