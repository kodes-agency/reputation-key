import { describe, expect, it } from 'vitest'
import { smallTouchTargets } from './phone-layout'

describe('smallTouchTargets', () => {
  it('names controls under 44 px in either direction', () => {
    expect(
      smallTouchTargets([
        { label: 'button "Send"', width: 120, height: 44 },
        { label: 'button "x"', width: 32, height: 44 },
        { label: 'a "Terms"', width: 80, height: 20 },
      ]),
    ).toEqual(['button "x" (32×44)', 'a "Terms" (80×20)'])
  })

  it('accepts a control that rounds to 44 px', () => {
    expect(smallTouchTargets([{ label: 'button', width: 43.8, height: 44 }])).toEqual([])
  })

  it('takes another minimum', () => {
    expect(smallTouchTargets([{ label: 'button', width: 30, height: 30 }], 24)).toEqual(
      [],
    )
  })
})
