import { describe, expect, it } from 'vitest'
import {
  STRIP_FADE_PX,
  stripEdgesFor,
  stripFadeStyle,
  stripScrollLeftFor,
} from './strip-scroll'

// A 320 px strip whose 16 px scroll padding is where a snapped pill starts.
const VIEW = { clientWidth: 320, padding: 16 }

describe('stripScrollLeftFor', () => {
  it('returns null when the pill and its breathing room are already in view', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 16, pillWidth: 90, scrollLeft: 0 }),
    ).toBeNull()
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 216, pillWidth: 88, scrollLeft: 0 }),
    ).toBeNull()
  })

  it('puts a pill clipped on the left on the start edge, minus its padding', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 100, pillWidth: 90, scrollLeft: 200 }),
    ).toBe(84)
  })

  it('never asks for a negative scroll position', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 8, pillWidth: 90, scrollLeft: 40 }),
    ).toBe(0)
  })

  // The strip snaps pills to their start: any other position is pulled to the
  // nearest pill start, and at 320 px that left a pill half off the edge. So a
  // pill clipped on the right goes to the start edge too, which is where the
  // browser would put it, not to the smallest scroll that shows it.
  it('puts a pill clipped on the right on the start edge, not just inside the end edge', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 400, pillWidth: 70, scrollLeft: 0 }),
    ).toBe(384)
  })

  it('treats a pill whose breathing room spills past the edge as clipped', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 230, pillWidth: 80, scrollLeft: 0 }),
    ).toBe(214)
  })

  it('lines a pill wider than the view up on its left edge', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 500, pillWidth: 400, scrollLeft: 0 }),
    ).toBe(484)
  })

  it('returns null for a wider-than-view pill that already sits on the left edge', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 500, pillWidth: 400, scrollLeft: 484 }),
    ).toBeNull()
  })

  it('returns null for a pill already on its start edge', () => {
    expect(
      stripScrollLeftFor({ ...VIEW, pillLeft: 300, pillWidth: 90, scrollLeft: 284 }),
    ).toBeNull()
  })
})

describe('stripEdgesFor', () => {
  it('reports both edges when everything fits', () => {
    expect(stripEdgesFor({ scrollLeft: 0, clientWidth: 390, scrollWidth: 390 })).toEqual({
      atStart: true,
      atEnd: true,
    })
  })

  it('reports the start edge only while scrolled to zero', () => {
    expect(stripEdgesFor({ scrollLeft: 0, clientWidth: 390, scrollWidth: 700 })).toEqual({
      atStart: true,
      atEnd: false,
    })
  })

  it('reports neither edge in the middle', () => {
    expect(
      stripEdgesFor({ scrollLeft: 120, clientWidth: 390, scrollWidth: 700 }),
    ).toEqual({ atStart: false, atEnd: false })
  })

  it('reports the end edge within a pixel of the maximum scroll', () => {
    expect(
      stripEdgesFor({ scrollLeft: 309.4, clientWidth: 390, scrollWidth: 700 }),
    ).toEqual({ atStart: false, atEnd: true })
  })
})

describe('stripFadeStyle', () => {
  const FADE = `${STRIP_FADE_PX}px`

  it('draws no mask when everything fits', () => {
    expect(stripFadeStyle({ atStart: true, atEnd: true })).toBeUndefined()
  })

  it('fades only the right edge at the start', () => {
    const style = stripFadeStyle({ atStart: true, atEnd: false })
    expect(style?.maskImage).toContain(`#000 calc(100% - ${FADE}), transparent)`)
    expect(style?.maskImage).not.toContain(`transparent, #000 ${FADE}`)
  })

  it('fades only the left edge at the end', () => {
    const style = stripFadeStyle({ atStart: false, atEnd: true })
    expect(style?.maskImage).toContain(`transparent, #000 ${FADE}`)
    expect(style?.maskImage).not.toContain('transparent)')
  })

  it('fades both edges in the middle', () => {
    const style = stripFadeStyle({ atStart: false, atEnd: false })
    expect(style?.maskImage).toContain(
      `linear-gradient(to right, transparent, #000 ${FADE}, #000 calc(100% - ${FADE}), transparent)`,
    )
  })

  it('mirrors the mask for WebKit', () => {
    const style = stripFadeStyle({ atStart: false, atEnd: false })
    expect(style?.WebkitMaskImage).toBe(style?.maskImage)
  })

  it('keeps the strip divider out of the fade', () => {
    const style = stripFadeStyle({ atStart: false, atEnd: false })
    expect(style?.maskSize).toContain('1px')
    expect(style?.maskImage).toContain('linear-gradient(#000, #000)')
  })
})
