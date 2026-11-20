import { describe, expect, it } from 'vitest'
import { scrollTopForPart } from './portal-review-scroll'

describe('scrollTopForPart', () => {
  it('measures a part on screen and converts it to the page’s own pixels', () => {
    // The part is 280 screen pixels below the frame; at 0.7 that is 400 page pixels.
    expect(scrollTopForPart({ top: 100, scrollTop: 0 }, { top: 380 }, 0.7)).toBe(400)
  })

  it('adds what the frame has already scrolled', () => {
    expect(scrollTopForPart({ top: 100, scrollTop: 200 }, { top: 100 }, 0.5)).toBe(200)
  })

  it('goes to the top for a part that has no place of its own', () => {
    expect(scrollTopForPart({ top: 100, scrollTop: 300 }, null, 0.7)).toBe(0)
  })

  it('never scrolls above the top', () => {
    expect(scrollTopForPart({ top: 100, scrollTop: 0 }, { top: 40 }, 0.7)).toBe(0)
  })
})
