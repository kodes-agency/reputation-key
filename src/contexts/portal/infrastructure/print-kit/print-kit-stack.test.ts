import { describe, expect, it } from 'vitest'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { printKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { fitStack, layoutStack, type Stack } from './print-kit-stack'

const palette = printKitPalette('#EAD6A8', '#15110D')
const english: PrintTextBlock = {
  locale: 'en',
  kicker: 'Pool & Terrace',
  headline: 'Rate your visit',
  subline: 'Private, about 30 seconds',
}
const bulgarian: PrintTextBlock = {
  locale: 'bg',
  kicker: 'Басейн и тераса',
  headline: 'Оценете посещението си',
  subline: 'Поверително, около 30 секунди',
}
/** Every character is `size` wide: text breaks by length, not by a font. */
const measure = (text: string, style: { size: number }) => text.length * style.size

const lines = (stack: Stack) =>
  stack.items.flatMap((item) => (item.kind === 'line' ? [item.text] : []))

describe('layoutStack', () => {
  it('sets the title in capitals, then the call to action and the line under it', () => {
    const stack = layoutStack([english], palette, 1, 10_000, measure)
    expect(lines(stack)).toEqual([
      'POOL & TERRACE',
      'Rate your visit',
      'Private, about 30 seconds',
    ])
    expect(stack.items.some((item) => item.kind === 'rule')).toBe(false)
  })

  it('adds a rule and the second language, without a second title, for two languages', () => {
    const stack = layoutStack([english, bulgarian], palette, 1, 10_000, measure)
    expect(lines(stack)).toEqual([
      'POOL & TERRACE',
      'Rate your visit',
      'Private, about 30 seconds',
      'Оценете посещението си',
      'Поверително, около 30 секунди',
    ])
    expect(stack.items.filter((item) => item.kind === 'rule')).toHaveLength(1)
  })

  it('wraps a long title to two lines, never wider than the line, and counts them in the height', () => {
    const long: PrintTextBlock = {
      ...english,
      kicker: 'Spa & Wellness Centre Reception Desk and Lobby East Wing',
    }
    const stack = layoutStack([long], palette, 1, 300, measure)
    const kicker = stack.items.filter(
      (item) => item.kind === 'line' && item.style.face === 'bodyStrong',
    )
    expect(kicker).toHaveLength(2)
    for (const item of kicker) {
      if (item.kind !== 'line') continue
      expect(measure(item.text, item.style)).toBeLessThanOrEqual(300)
    }
    const short = layoutStack([english], palette, 1, 300, measure)
    expect(stack.heightMm).toBeGreaterThan(short.heightMm)
  })

  it('shrinks a long title toward its floor before it wraps it', () => {
    const medium: PrintTextBlock = { ...english, kicker: 'Spa & Wellness Reception' }
    const stack = layoutStack([medium], palette, 1, 7.9 * 22, measure)
    const kicker = stack.items.filter(
      (item) => item.kind === 'line' && item.style.face === 'bodyStrong',
    )
    expect(kicker).toHaveLength(1)
    const [item] = kicker
    if (item?.kind !== 'line') throw new Error('a line')
    expect(item.style.size).toBeLessThan(7.9)
    expect(item.style.size).toBeGreaterThanOrEqual(6)
  })

  it('places each line below the one before it', () => {
    const middles = layoutStack(
      [english, bulgarian],
      palette,
      1,
      10_000,
      measure,
    ).items.flatMap((item) => (item.kind === 'line' ? [item.middleMm] : []))
    expect([...middles].sort((a, b) => a - b)).toEqual(middles)
  })

  it('breaks a headline that is wider than the line', () => {
    const narrow = layoutStack([bulgarian], palette, 1, 28.5 * 14, measure)
    const wide = layoutStack([bulgarian], palette, 1, 10_000, measure)
    expect(lines(narrow)).toHaveLength(lines(wide).length + 1)
    expect(lines(narrow).join(' ')).toContain('Оценете')
  })

  it('is smaller at a smaller scale', () => {
    const full = layoutStack([english], palette, 1, 10_000, measure)
    const half = layoutStack([english], palette, 0.5, 10_000, measure)
    expect(half.heightMm).toBeLessThan(full.heightMm)
  })
})

describe('fitStack', () => {
  const layout = (scale: number) =>
    layoutStack([english, bulgarian], palette, scale, 10_000, measure)

  it('keeps the largest scale when the stack fits the room', () => {
    expect(fitStack(layout, 1000, 1).heightMm).toBeCloseTo(layout(1).heightMm, 6)
  })

  it('shrinks the stack until it fits', () => {
    const room = layout(1).heightMm * 0.8
    const stack = fitStack(layout, room, 1)
    expect(stack.heightMm).toBeLessThanOrEqual(room)
    expect(stack.heightMm).toBeGreaterThan(layout(0.6).heightMm)
  })

  it('stops at the smallest scale for a room that is too small', () => {
    expect(fitStack(layout, 1, 1).heightMm).toBeCloseTo(layout(0.6).heightMm, 6)
  })

  it('may enlarge a single language up to the scale it is given', () => {
    const single = (scale: number) =>
      layoutStack([english], palette, scale, 10_000, measure)
    expect(fitStack(single, 1000, 1.22).heightMm).toBeCloseTo(single(1.22).heightMm, 6)
  })
})
