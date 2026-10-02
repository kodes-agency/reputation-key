import { describe, expect, it } from 'vitest'
import { scrollEdges } from './use-scroll-edges'

describe('scrollEdges', () => {
  it('has nothing hidden when everything fits', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({
      before: false,
      after: false,
    })
  })

  it('has more after the end while it starts at the left', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 })).toEqual({
      before: false,
      after: true,
    })
  })

  it('has more on both sides in the middle', () => {
    expect(scrollEdges({ scrollLeft: 150, scrollWidth: 600, clientWidth: 300 })).toEqual({
      before: true,
      after: true,
    })
  })

  it('has more before the start once scrolled to the end', () => {
    expect(scrollEdges({ scrollLeft: 300, scrollWidth: 600, clientWidth: 300 })).toEqual({
      before: true,
      after: false,
    })
  })

  it('ignores the half pixel a fractional width leaves', () => {
    expect(
      scrollEdges({ scrollLeft: 0.5, scrollWidth: 300.5, clientWidth: 300 }),
    ).toEqual({ before: false, after: false })
  })
})
