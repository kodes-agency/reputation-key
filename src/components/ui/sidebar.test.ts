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
import { Sidebar, SidebarProvider } from './sidebar'

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
