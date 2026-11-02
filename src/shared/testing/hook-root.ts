import { act, type ReactNode } from 'react'
import { environmentManager } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

/** React's client lifecycle for hooks and providers that draw no host elements. */
export function setupHookRoot() {
  let createRoot: typeof import('react-dom/client').createRoot
  let root: ReturnType<typeof createRoot> | undefined
  const page = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    activeElement: null,
  })
  beforeAll(async () => {
    const view = Object.assign(new EventTarget(), {
      document: page,
      setTimeout,
      clearTimeout,
      HTMLIFrameElement: class {},
    })
    Object.assign(page, { defaultView: view })
    vi.stubGlobal('window', view)
    vi.stubGlobal('document', page)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    environmentManager.setIsServer(() => false)
    ;({ createRoot } = await import('react-dom/client'))
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
  })
  afterAll(() => {
    vi.unstubAllGlobals()
    environmentManager.setIsServer(() => typeof window === 'undefined')
  })
  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  return {
    flush,
    async render(node: ReactNode) {
      const container = Object.assign(new EventTarget(), {
        nodeType: 1,
        nodeName: 'DIV',
        tagName: 'DIV',
        namespaceURI: 'http://www.w3.org/1999/xhtml',
        ownerDocument: page,
      })
      root ??= createRoot(container as unknown as Element)
      await act(async () => root!.render(node))
      await flush()
    },
  }
}
