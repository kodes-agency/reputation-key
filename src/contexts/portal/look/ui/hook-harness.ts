// Mounts a hook on React DOM's real reconciler over a stand-in document that
// draws nothing: the unit project has no DOM.

import { act, createElement, type ReactElement } from 'react'
import { vi } from 'vitest'

const standInDocument = () => {
  const doc = {
    nodeType: 9,
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const view = {
    document: doc,
    setTimeout,
    clearTimeout,
    HTMLIFrameElement: class {},
  }
  return Object.assign(doc, { defaultView: view })
}

export type HookHarness = Readonly<{
  render: (element: ReactElement) => Promise<void>
  unmount: () => Promise<void>
  stop: () => void
}>

export async function startHookHarness(): Promise<HookHarness> {
  const doc = standInDocument()
  vi.stubGlobal('window', doc.defaultView)
  vi.stubGlobal('document', doc)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  let root: ReturnType<typeof createRoot> | undefined
  const container = {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: doc,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  return {
    render: async (element) => {
      root ??= createRoot(container as unknown as Element)
      await act(async () => root!.render(element))
    },
    unmount: async () => {
      await act(async () => root?.unmount())
      root = undefined
    },
    stop: () => vi.unstubAllGlobals(),
  }
}

export { act, createElement }
