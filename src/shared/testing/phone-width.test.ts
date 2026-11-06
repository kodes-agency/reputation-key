import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkPhoneWidths,
  measurePhoneWidths,
  provideViewportSetter,
} from './phone-width'

afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for('repkey.phone-width.set-viewport'))
})

function browserDocument() {
  const view = {
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }),
    getComputedStyle: vi.fn(() => ({ display: 'block', content: 'none' })),
  }
  const doc = {
    defaultView: view,
    documentElement: { scrollWidth: 0 },
    body: { querySelectorAll: () => [] },
    querySelectorAll: vi.fn(() => [] as Element[]),
    fonts: { ready: Promise.resolve() },
  }
  Object.assign(view, { document: doc })
  const setViewport = vi.fn(async (width: number, height: number) => {
    view.innerWidth = width
    view.innerHeight = height
  })
  provideViewportSetter(setViewport)
  return { doc: doc as unknown as Document, view, setViewport }
}

describe('phone-width measurements', () => {
  it('measures both phone widths and restores the original viewport', async () => {
    const { doc, setViewport, view } = browserDocument()
    await expect(measurePhoneWidths(doc)).resolves.toEqual([
      { width: 320, overflow: [], targets: [] },
      { width: 390, overflow: [], targets: [] },
    ])
    expect(setViewport.mock.calls).toEqual([
      [320, 900],
      [390, 900],
      [1200, 800],
    ])
    expect(view.innerWidth).toBe(1200)
    expect(view.innerHeight).toBe(800)
    expect(view.requestAnimationFrame).toHaveBeenCalledTimes(4)
  })

  it('keeps narrow-only overflow separate from undersized targets', async () => {
    const { doc } = browserDocument()
    Object.defineProperty(doc.documentElement, 'scrollWidth', { value: 340 })
    const control = {
      tagName: 'BUTTON',
      textContent: 'Save',
      getAttribute: () => null,
      closest: () => null,
      checkVisibility: () => true,
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({ width: 60, height: 36 }),
    }
    vi.mocked(doc.querySelectorAll).mockReturnValue([
      control as unknown as Element,
    ] as unknown as NodeListOf<Element>)

    await expect(measurePhoneWidths(doc)).resolves.toEqual([
      {
        width: 320,
        overflow: ['the page scrolls sideways: 340 px wide in 320 px'],
        targets: ['Save is 60x36; a target is at least 44 px'],
      },
      {
        width: 390,
        overflow: [],
        targets: ['Save is 60x36; a target is at least 44 px'],
      },
    ])
  })

  it('restores the viewport when measurement throws', async () => {
    const { doc, setViewport } = browserDocument()
    vi.mocked(doc.querySelectorAll).mockImplementation(() => {
      throw new Error('measurement failed')
    })
    await expect(measurePhoneWidths(doc)).rejects.toThrow('measurement failed')
    expect(setViewport).toHaveBeenLastCalledWith(1200, 800)
  })

  it('restores the viewport when resizing fails', async () => {
    const { doc, setViewport } = browserDocument()
    setViewport.mockRejectedValueOnce(new Error('resize failed'))
    await expect(measurePhoneWidths(doc)).rejects.toThrow('resize failed')
    expect(setViewport).toHaveBeenLastCalledWith(1200, 800)
  })

  it('refuses to report both widths when no runner can resize the viewport', async () => {
    const { doc } = browserDocument()
    Reflect.deleteProperty(globalThis, Symbol.for('repkey.phone-width.set-viewport'))
    await expect(measurePhoneWidths(doc)).rejects.toThrow(/viewport setter/i)
  })

  it('preserves the strict check and its width-prefixed findings', async () => {
    const { doc, setViewport } = browserDocument()
    Object.defineProperty(doc.documentElement, 'scrollWidth', { value: 340 })
    await expect(checkPhoneWidths(doc)).rejects.toThrow(
      '320 px: the page scrolls sideways: 340 px wide in 320 px',
    )
    expect(setViewport).toHaveBeenLastCalledWith(1200, 800)
  })

  it('preserves the Storybook UI fallback at the current phone width', async () => {
    const { doc, view } = browserDocument()
    Reflect.deleteProperty(globalThis, Symbol.for('repkey.phone-width.set-viewport'))
    view.innerWidth = 390
    await expect(checkPhoneWidths(doc)).resolves.toBeUndefined()
    view.innerWidth = 1200
    await expect(checkPhoneWidths(doc)).rejects.toThrow(/Expected a phone-width window/)
  })
})
