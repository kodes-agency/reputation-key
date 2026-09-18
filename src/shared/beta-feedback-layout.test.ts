import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  MASKED_LAYOUT_MAX_BOXES,
  maskedLayoutExpiry,
  maskedLayoutSchema,
  renderMaskedLayoutSvg,
  summarizeMaskedLayout,
  type MaskedLayout,
} from './beta-feedback-layout'

const box = (role: string, overrides: Record<string, unknown> = {}) => ({
  x: 10,
  y: 20,
  w: 100,
  h: 40,
  role,
  ...overrides,
})

const layout: MaskedLayout = {
  width: 1280,
  height: 720,
  boxes: [
    { x: 0, y: 0, w: 1280, h: 64, role: 'container' },
    { x: 16, y: 80, w: 400, h: 32, role: 'heading' },
    { x: 16, y: 128, w: 600, h: 200, role: 'text' },
  ],
}

describe('masked layout schema', () => {
  it('accepts geometry with a known role', () => {
    expect(() => maskedLayoutSchema.parse(layout)).not.toThrow()
  })

  it('rejects a role outside the closed vocabulary', () => {
    expect(() =>
      maskedLayoutSchema.parse({ width: 800, height: 600, boxes: [box('sidebar')] }),
    ).toThrow(ZodError)
  })

  it('rejects any extra property, so nothing can ride along a box', () => {
    expect(() =>
      maskedLayoutSchema.parse({
        width: 800,
        height: 600,
        boxes: [box('text', { alt: 'Guest Jane Smith' })],
      }),
    ).toThrow(ZodError)
  })

  it('rejects non-integer coordinates', () => {
    expect(() =>
      maskedLayoutSchema.parse({
        width: 800,
        height: 600,
        boxes: [box('text', { x: 1.5 })],
      }),
    ).toThrow(ZodError)
  })

  it('refuses an empty capture rather than storing a meaningless row', () => {
    expect(() =>
      maskedLayoutSchema.parse({ width: 800, height: 600, boxes: [] }),
    ).toThrow(ZodError)
  })

  it('bounds the box count so a submission cannot become an upload', () => {
    const boxes = Array.from({ length: MASKED_LAYOUT_MAX_BOXES + 1 }, () => box('text'))
    expect(() => maskedLayoutSchema.parse({ width: 800, height: 600, boxes })).toThrow(
      ZodError,
    )
  })
})

describe('masked layout retention', () => {
  it('expires exactly 30 days after capture', () => {
    const capturedAt = new Date('2026-09-18T08:00:00.000Z')

    expect(maskedLayoutExpiry(capturedAt).toISOString()).toBe('2026-10-18T08:00:00.000Z')
  })
})

describe('masked layout rendering', () => {
  it('builds an SVG of rectangles only', () => {
    const svg = renderMaskedLayoutSvg(layout)

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('viewBox="0 0 1280 720"')
    expect((svg.match(/<rect /gu) ?? []).length).toBe(layout.boxes.length + 1)
  })

  it('emits nothing that could load or display foreign content', () => {
    const svg = renderMaskedLayoutSvg(layout)

    for (const forbidden of [
      '<text',
      '<image',
      '<script',
      '<foreignObject',
      'href',
      'data:',
    ]) {
      expect(svg).not.toContain(forbidden)
    }
  })

  it('summarizes shape and scale without naming anything', () => {
    expect(summarizeMaskedLayout(layout)).toBe('1280x720 text=1 heading=1 container=1')
  })
})
