import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortalWorkspaceShell } from './portal-workspace-shell'

describe('PortalWorkspaceShell', () => {
  it('marks its scrolling body for TanStack Router scroll restoration', () => {
    const html = renderToStaticMarkup(
      createElement(PortalWorkspaceShell, {
        header: 'Header',
        tabs: 'Tabs',
        children: 'Body',
      }),
    )

    expect(html).toContain('data-scroll-restoration-id="portal-workspace-body"')
    expect(html).toContain('overflow-y-auto')
  })
})
