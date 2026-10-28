import { describe, expect, it } from 'vitest'
import { keptData, rangeOfLocation } from './-dashboard-range-read'

describe('rangeOfLocation', () => {
  it('reads the range the URL names', () => {
    expect(rangeOfLocation({ search: { range: '30d' } })).toBe('30d')
    expect(rangeOfLocation({ search: { range: 'all' } })).toBe('all')
  })

  it('is the default for a missing, hand-edited or old numeric range', () => {
    expect(rangeOfLocation({ search: {} })).toBe('90d')
    expect(rangeOfLocation({ search: { range: 'weekly' } })).toBe('90d')
    expect(rangeOfLocation({ search: { range: 90 } })).toBe('90d')
    expect(rangeOfLocation({ search: undefined })).toBe('90d')
    expect(rangeOfLocation({ search: null })).toBe('90d')
  })
})

describe('keptData', () => {
  it('gives the data, the previous range’s while the next is read', () => {
    expect(keptData({ data: { value: 1 }, error: null })).toEqual({ value: 1 })
  })

  it('throws a failed read for the route’s error state', () => {
    const failure = new Error('read failed')

    expect(() => keptData({ data: undefined, error: failure })).toThrow(failure)
  })

  it('is empty for a read that has neither answered nor failed', () => {
    expect(keptData({ data: undefined, error: null })).toBeNull()
  })
})
