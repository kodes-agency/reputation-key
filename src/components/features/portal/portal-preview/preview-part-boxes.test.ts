import { describe, expect, it } from 'vitest'
import {
  padBox,
  pageScale,
  sameBoxes,
  toPageBox,
  unionBox,
  type PartBox,
} from './preview-part-boxes'

const box = (top: number, left: number, width: number, height: number) => ({
  top,
  left,
  width,
  height,
})

describe('unionBox', () => {
  it('is nothing for nothing', () => {
    expect(unionBox([])).toBeNull()
  })

  it('is the box itself for one box', () => {
    expect(unionBox([box(10, 20, 30, 40)])).toEqual(box(10, 20, 30, 40))
  })

  it('spans every box, as the receipt and the Google card are one part', () => {
    expect(unionBox([box(100, 16, 358, 40), box(150, 16, 358, 200)])).toEqual(
      box(100, 16, 358, 250),
    )
  })
})

describe('pageScale', () => {
  it('is the drawn width over the layout width', () => {
    expect(pageScale(273, 390)).toBeCloseTo(0.7)
  })

  it('is 1 when nothing has a width yet', () => {
    expect(pageScale(0, 0)).toBe(1)
    expect(pageScale(100, 0)).toBe(1)
  })
})

describe('toPageBox', () => {
  it('takes a box seen on screen to the page’s own pixels, measured from the frame', () => {
    const onScreen = box(200 + 70, 50 + 14, 140, 70)
    const frame = box(200, 50, 273, 590)
    expect(toPageBox(onScreen, frame, 0.7)).toEqual(box(100, 20, 200, 100))
  })
})

describe('padBox', () => {
  it('grows a box on every side', () => {
    expect(padBox(box(100, 20, 200, 100), 4, 390)).toEqual(box(96, 16, 208, 108))
  })

  it('stays inside the page’s width, which clips whatever sticks out', () => {
    expect(padBox(box(100, 2, 388, 100), 4, 390)).toEqual(box(96, 0, 390, 108))
  })

  it('does not climb above the page', () => {
    expect(padBox(box(2, 20, 100, 100), 4, 390).top).toBe(0)
  })
})

describe('sameBoxes', () => {
  const a: PartBox = { section: 'linktree', box: box(1, 2, 3, 4) }
  const b: PartBox = { section: 'welcome', box: box(5, 6, 7, 8) }

  it('is true for the same boxes in the same order', () => {
    expect(sameBoxes([a, b], [{ ...a }, { ...b }])).toBe(true)
  })

  it('is false when a box moved, a part came or went, or the order changed', () => {
    expect(sameBoxes([a], [{ ...a, box: box(1, 2, 3, 5) }])).toBe(false)
    expect(sameBoxes([a, b], [a])).toBe(false)
    expect(sameBoxes([a, b], [b, a])).toBe(false)
  })
})
