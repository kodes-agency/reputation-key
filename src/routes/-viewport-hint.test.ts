import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getRequestHeader } = vi.hoisted(() => ({ getRequestHeader: vi.fn() }))

vi.mock('@tanstack/react-start/server', () => ({ getRequestHeader }))

import { readViewportHint } from './-viewport-hint'

function requestWith(headers: Record<string, string>) {
  getRequestHeader.mockImplementation((name: string) => headers[name])
}

// Vitest runs the module uncompiled, where Start keeps the server
// implementation: this is the branch SSR takes.
describe('readViewportHint on the server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the reported width from the request cookie', () => {
    requestWith({ cookie: 'rk_viewport=390; sidebar_state=false' })

    expect(readViewportHint()).toEqual({ width: 390, mobile: false })
  })

  it('reads the mobile client hint and the user agent', () => {
    requestWith({ 'sec-ch-ua-mobile': '?1' })
    expect(readViewportHint()).toEqual({ width: null, mobile: true })

    requestWith({ 'user-agent': 'Mozilla/5.0 (iPhone) Mobile/15E148 Safari/604.1' })
    expect(readViewportHint()).toEqual({ width: null, mobile: true })
  })

  it('knows nothing when the request says nothing', () => {
    requestWith({})

    expect(readViewportHint()).toEqual({ width: null, mobile: false })
  })
})
