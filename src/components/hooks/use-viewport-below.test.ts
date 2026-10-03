// The server render is the first paint on a hard load, and hydration must
// render the same thing. The server has no window, so these hooks answer from
// the request's viewport hint there. Rendered with react-dom/server, which
// takes the server-snapshot path exactly as SSR does.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useInboxCompactLayout } from '#/components/inbox/use-inbox-compact-layout'
import { useIsMobile } from './use-mobile'
import { ViewportHintContext } from './use-viewport-below'
import { UNKNOWN_VIEWPORT, type ViewportHint } from './viewport-hint'

function Probe(): ReactNode {
  return `mobile=${useIsMobile()} compact=${useInboxCompactLayout()}`
}

function serverRender(hint?: ViewportHint): string {
  const probe = createElement(Probe)
  return renderToStaticMarkup(
    hint ? createElement(ViewportHintContext.Provider, { value: hint }, probe) : probe,
  )
}

describe('layout hooks on the server', () => {
  it('render a phone as a phone when the browser reported its width', () => {
    expect(serverRender({ width: 390, mobile: false })).toBe('mobile=true compact=true')
  })

  it('render a tablet as the compact Inbox but not the phone controls', () => {
    expect(serverRender({ width: 820, mobile: false })).toBe('mobile=false compact=true')
  })

  it('render a desktop as a desktop', () => {
    expect(serverRender({ width: 1440, mobile: false })).toBe(
      'mobile=false compact=false',
    )
  })

  it('render a phone that has not reported a width yet from its user agent', () => {
    expect(serverRender({ width: null, mobile: true })).toBe('mobile=true compact=true')
  })

  it('keep the wide layout when nothing is known', () => {
    expect(serverRender(UNKNOWN_VIEWPORT)).toBe('mobile=false compact=false')
    expect(serverRender()).toBe('mobile=false compact=false')
  })
})
