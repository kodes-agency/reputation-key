import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatInboxListDate,
  formatReviewLanguage,
} from './utils'

describe('inbox date formatting', () => {
  const utcBoundary = new Date('2026-08-09T01:15:00.000Z')

  it('renders source dates in a server/client-stable timezone', () => {
    expect(formatDate(utcBoundary)).toBe('Aug 9, 2026')
  })

  it('renders source timestamps in a server/client-stable timezone', () => {
    expect(formatDateTime(utcBoundary)).toBe('Aug 9, 2026, 1:15 AM')
  })

  it('renders compact list dates in day-month order', () => {
    expect(formatInboxListDate(utcBoundary)).toBe('9 Aug')
  })

  it('renders a safe English language label from BCP-47 metadata', () => {
    expect(formatReviewLanguage('tr-TR')).toBe('Turkish')
    expect(formatReviewLanguage('not_a_tag')).toBeNull()
    expect(formatReviewLanguage(null)).toBeNull()
  })
})
