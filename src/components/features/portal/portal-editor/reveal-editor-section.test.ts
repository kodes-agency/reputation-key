import { describe, expect, it } from 'vitest'
import { needsReveal } from './reveal-editor-section'

const AREA = { top: 100, height: 800 }

describe('needsReveal — whether an opened section is out of sight', () => {
  it('leaves a section whose top is already in the upper half of the area', () => {
    expect(needsReveal(100, AREA)).toBe(false)
    expect(needsReveal(480, AREA)).toBe(false)
  })

  it('reveals a section scrolled above the area', () => {
    expect(needsReveal(-1200, AREA)).toBe(true)
    expect(needsReveal(99, AREA)).toBe(true)
  })

  it('reveals a section that starts in the lower half or below', () => {
    expect(needsReveal(501, AREA)).toBe(true)
    expect(needsReveal(2400, AREA)).toBe(true)
  })
})
