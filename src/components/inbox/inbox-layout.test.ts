import { describe, expect, it } from 'vitest'
import { inboxUsesCompactLayout } from './use-inbox-compact-layout'

describe('inboxUsesCompactLayout', () => {
  it('keeps the strip and sheet until all three desktop columns can fit', () => {
    expect(inboxUsesCompactLayout(820)).toBe(true)
    expect(inboxUsesCompactLayout(1077)).toBe(true)
    expect(inboxUsesCompactLayout(1078)).toBe(false)
    expect(inboxUsesCompactLayout(1440)).toBe(false)
  })
})
