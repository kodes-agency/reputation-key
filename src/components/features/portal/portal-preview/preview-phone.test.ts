import { describe, expect, it } from 'vitest'
import { phoneFrameSize, scaleToFitWidth } from './preview-phone'

describe('scaleToFitWidth', () => {
  it('keeps the wanted scale where the frame already fits', () => {
    expect(scaleToFitWidth(phoneFrameSize(0.7).width, 0.7)).toBe(0.7)
    expect(scaleToFitWidth(600, 0.7)).toBe(0.7)
  })

  it('shrinks the page until the frame, bezel included, fits the room', () => {
    const scale = scaleToFitWidth(240, 0.7)

    expect(scale).toBeLessThan(0.7)
    expect(phoneFrameSize(scale).width).toBeCloseTo(240, 5)
  })

  it('never draws a page smaller than the smallest legible scale', () => {
    expect(scaleToFitWidth(0, 0.7)).toBeGreaterThan(0)
    expect(scaleToFitWidth(40, 0.7)).toBeGreaterThanOrEqual(0.3)
  })
})
