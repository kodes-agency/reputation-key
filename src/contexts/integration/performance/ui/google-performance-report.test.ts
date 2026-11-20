import { describe, expect, it } from 'vitest'
import { formatGoogleFreshness } from './google-performance-report'

const NOW = new Date('2026-09-11T16:00:00.000Z')

describe('formatGoogleFreshness', () => {
  it.each([
    ['2026-09-11T15:59:30.000Z', 'just now'],
    ['2026-09-11T15:56:00.000Z', '4 min ago'],
    ['2026-09-11T14:00:00.000Z', '2 hours ago'],
    ['2026-09-10T16:00:00.000Z', '1 day ago'],
  ])('keeps the retrieval age relative for %s', (retrievedAt, expected) => {
    expect(formatGoogleFreshness(retrievedAt, NOW)).toBe(expected)
  })

  it('does not describe a future-skewed retrieval as a negative age', () => {
    expect(formatGoogleFreshness('2026-09-11T16:01:00.000Z', NOW)).toBe('just now')
  })
})
