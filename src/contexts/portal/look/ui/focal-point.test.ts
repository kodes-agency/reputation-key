import { describe, expect, it } from 'vitest'
import {
  CENTRE_FOCAL,
  FOCAL_LARGE_STEP,
  FOCAL_STEP,
  describeFocal,
  focalFromPointer,
  nudgeFocal,
  pickerWidth,
  sameFocal,
} from './focal-point'

const BOX = { left: 100, top: 50, width: 200, height: 100 }

describe('focalFromPointer', () => {
  it('maps a pointer over the box to a point from 0 to 1', () => {
    expect(focalFromPointer({ clientX: 200, clientY: 75 }, BOX)).toEqual({
      x: 0.5,
      y: 0.25,
    })
  })

  it('stops at the edge for a pointer dragged past the box', () => {
    expect(focalFromPointer({ clientX: 0, clientY: 400 }, BOX)).toEqual({ x: 0, y: 1 })
    expect(focalFromPointer({ clientX: 900, clientY: -20 }, BOX)).toEqual({ x: 1, y: 0 })
  })

  it('keeps three decimals, so the database reads back what was saved', () => {
    expect(focalFromPointer({ clientX: 100 + 200 / 3, clientY: 100 }, BOX)).toEqual({
      x: 0.333,
      y: 0.5,
    })
  })

  it('has no answer for a box with no size', () => {
    expect(focalFromPointer({ clientX: 1, clientY: 1 }, { ...BOX, width: 0 })).toBeNull()
    expect(focalFromPointer({ clientX: 1, clientY: 1 }, { ...BOX, height: 0 })).toBeNull()
  })
})

describe('nudgeFocal', () => {
  it.each([
    ['ArrowLeft', { x: 0.48, y: 0.5 }],
    ['ArrowRight', { x: 0.52, y: 0.5 }],
    ['ArrowUp', { x: 0.5, y: 0.48 }],
    ['ArrowDown', { x: 0.5, y: 0.52 }],
  ])('moves one step on %s', (key, expected) => {
    expect(nudgeFocal(CENTRE_FOCAL, key, false)).toEqual(expected)
    expect(FOCAL_STEP).toBe(0.02)
  })

  it('moves five times as far with Shift held', () => {
    expect(nudgeFocal(CENTRE_FOCAL, 'ArrowRight', true)).toEqual({ x: 0.6, y: 0.5 })
    expect(FOCAL_LARGE_STEP / FOCAL_STEP).toBe(5)
  })

  it('stops at the edge of the photograph', () => {
    expect(nudgeFocal({ x: 0.99, y: 0 }, 'ArrowRight', false)).toEqual({ x: 1, y: 0 })
    expect(nudgeFocal({ x: 0.99, y: 0 }, 'ArrowUp', false)).toEqual({ x: 0.99, y: 0 })
  })

  it('leaves any other key to the browser', () => {
    expect(nudgeFocal(CENTRE_FOCAL, 'Tab', false)).toBeNull()
    expect(nudgeFocal(CENTRE_FOCAL, 'Enter', false)).toBeNull()
  })

  it('does not drift from float error over many steps', () => {
    let focal = CENTRE_FOCAL
    for (let i = 0; i < 10; i += 1)
      focal = nudgeFocal(focal, 'ArrowRight', false) ?? focal
    expect(focal.x).toBe(0.7)
  })
})

describe('describing a focal point', () => {
  it('reads it out in percent', () => {
    expect(describeFocal({ x: 0.5, y: 0.42 })).toBe('50% across, 42% down')
    expect(describeFocal({ x: 0, y: 1 })).toBe('0% across, 100% down')
  })

  it('compares two points', () => {
    expect(sameFocal({ x: 0.5, y: 0.5 }, CENTRE_FOCAL)).toBe(true)
    expect(sameFocal({ x: 0.5, y: 0.51 }, CENTRE_FOCAL)).toBe(false)
  })
})

describe('pickerWidth', () => {
  it('is as wide as the container allows, but no wider than keeps the photograph under the height', () => {
    expect(pickerWidth(1.5, 20)).toBe('min(100%, 30rem)')
    expect(pickerWidth(0.75, 20)).toBe('min(100%, 15rem)')
  })

  it('is also held to a width limit', () => {
    expect(pickerWidth(2, 7.5, 11)).toBe('min(100%, 11rem)')
    expect(pickerWidth(1.2, 7.5, 11)).toBe('min(100%, 9rem)')
  })

  it('rounds to a hundredth of a rem', () => {
    expect(pickerWidth(1.333, 7.5)).toBe('min(100%, 10rem)')
    expect(pickerWidth(1.3333, 7.5)).toBe('min(100%, 10rem)')
  })
})
