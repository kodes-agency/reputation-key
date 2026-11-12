import { describe, expect, it } from 'vitest'
import { captureMaskedLayout } from './beta-feedback-capture'

// There is no DOM in the unit project by design, and that is useful here: a
// hand-built stub proves something jsdom could not. Every element refuses any
// property the walk is not supposed to touch, so "it reads no content" is
// enforced by the test rather than asserted about the output afterwards.

const ALLOWED_ELEMENT_READS = new Set([
  'tagName',
  'getBoundingClientRect',
  'closest',
  'ownerDocument',
])

type ElementSpec = Readonly<{
  tag: string
  rect?: Readonly<{ x: number; y: number; width: number; height: number }>
  excluded?: boolean
  hidden?: boolean
}>

const DEFAULT_RECT = { x: 12, y: 40, width: 300, height: 44 }

function fakeElement(spec: ElementSpec, index: number): Element {
  const rect = spec.rect ?? { ...DEFAULT_RECT, y: DEFAULT_RECT.y + index * 60 }
  const target = {
    tagName: spec.tag.toUpperCase(),
    getBoundingClientRect: () => ({
      ...rect,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    }),
    closest: (selector: string) =>
      selector === '[data-beta-feedback-capture-exclude]' && spec.excluded
        ? target
        : null,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          visibility: spec.hidden ? 'hidden' : 'visible',
          display: spec.hidden ? 'none' : 'block',
        }),
      },
    },
  }

  return new Proxy(target, {
    get(object, property) {
      if (typeof property === 'string' && !ALLOWED_ELEMENT_READS.has(property)) {
        throw new Error(`capture read a forbidden element property: ${property}`)
      }
      return Reflect.get(object, property)
    },
  }) as unknown as Element
}

function capture(
  specs: ReadonlyArray<ElementSpec>,
  viewport: Readonly<{ width: number; height: number }> = { width: 1280, height: 800 },
) {
  const elements = specs.map(fakeElement)
  const document = {
    body: { querySelectorAll: () => elements },
  } as unknown as Document

  return captureMaskedLayout({
    document,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  })
}

describe('masked layout capture', () => {
  it('records where blocks are and what kind they are', () => {
    const layout = capture([{ tag: 'h1' }, { tag: 'p' }, { tag: 'button' }])

    expect(layout?.width).toBe(1280)
    expect(layout?.height).toBe(800)
    expect(layout?.boxes.map((b) => b.role)).toEqual(['heading', 'text', 'button'])
    expect(layout?.boxes[0]).toMatchObject({ x: 12, w: 300, h: 44 })
  })

  it('reads nothing but the tag, the rectangle and whether it is rendered', () => {
    // The stub throws on any other property, so reaching textContent, src,
    // alt, value, id, className or a dataset entry fails this outright.
    expect(() => capture([{ tag: 'img' }, { tag: 'a' }, { tag: 'input' }])).not.toThrow()
  })

  it('maps every element to a role from the closed vocabulary', () => {
    const layout = capture([
      { tag: 'img' },
      { tag: 'video' },
      { tag: 'textarea' },
      { tag: 'a' },
      { tag: 'article' },
    ])

    expect(layout?.boxes.map((b) => b.role)).toEqual([
      'image',
      'media',
      'input',
      'link',
      'container',
    ])
  })

  it('maps an unknown element to a plain container rather than inventing a role', () => {
    expect(capture([{ tag: 'rk-widget' }])?.boxes.map((b) => b.role)).toEqual([
      'container',
    ])
  })

  it('leaves the feedback dialog itself out of the picture', () => {
    const layout = capture([{ tag: 'p' }, { tag: 'textarea', excluded: true }])

    expect(layout?.boxes.map((b) => b.role)).toEqual(['text'])
  })

  it('drops a hidden element', () => {
    expect(capture([{ tag: 'p', hidden: true }])).toBeNull()
  })

  it('drops boxes too small to mean anything', () => {
    expect(capture([{ tag: 'p', rect: { x: 0, y: 0, width: 2, height: 2 } }])).toBeNull()
  })

  it('drops a block scrolled out of the viewport', () => {
    expect(
      capture([{ tag: 'p', rect: { x: 0, y: 4_000, width: 300, height: 44 } }]),
    ).toBeNull()
  })

  it('returns null for a page with nothing rendered', () => {
    expect(capture([])).toBeNull()
  })

  it('snaps to a coarse grid rather than pinning an exact viewport', () => {
    const layout = capture(
      [{ tag: 'p', rect: { x: 13.7, y: 41.2, width: 301.6, height: 43.9 } }],
      { width: 1281, height: 801 },
    )

    expect(layout?.boxes[0]).toMatchObject({ x: 12, y: 40, w: 300, h: 44 })
    expect(layout?.width).toBe(1280)
    expect(layout?.height).toBe(800)
  })

  it('stops at the box budget instead of growing without bound', () => {
    // All in-viewport, so the budget is what stops the walk rather than the
    // off-screen filter.
    const layout = capture(
      Array.from({ length: 400 }, () => ({
        tag: 'p' as const,
        rect: { x: 0, y: 100, width: 300, height: 44 },
      })),
    )

    expect(layout?.boxes.length).toBe(240)
  })

  it('leaves out page shells that span the whole viewport', () => {
    const layout = capture([
      { tag: 'div', rect: { x: 0, y: 0, width: 1280, height: 800 } },
      { tag: 'main', rect: { x: 0, y: 0, width: 1276, height: 792 } },
      { tag: 'p', rect: { x: 16, y: 80, width: 400, height: 44 } },
    ])

    // Both shells go; the paragraph that actually shows the layout stays.
    expect(layout?.boxes.map((b) => b.role)).toEqual(['text'])
  })
})
