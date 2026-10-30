import { describe, expect, it } from 'vitest'
import { renderNotification } from './notification-templates'

describe('the Urgent alert copy', () => {
  it('says that an urgent review needs the reader, and where', () => {
    const rendered = renderNotification('review.ai_urgent_detected', {
      propertyName: 'Seaview Hotel',
    })

    expect(rendered.title).toBe('An urgent review needs you at Seaview Hotel')
    expect(rendered.body).toBe('Open it to read the review and decide what to do.')
    expect(rendered.actionLabel).toBe('Open review')
    expect(rendered.summary).toBe('Seaview Hotel · urgent review')
  })

  it('reads correctly with an empty payload', () => {
    const rendered = renderNotification('review.ai_urgent_detected', {})

    expect(rendered.title).toBe('An urgent review needs you')
    expect(rendered.summary).toBe('urgent review')
  })

  it('names no reason, topic, rating or word of the review, whatever the payload holds', () => {
    // ADR 0046 r.8: the reason is read in the app, never carried by a notice or an email.
    const rendered = renderNotification('review.ai_urgent_detected', {
      propertyName: 'Seaview Hotel',
      waitingSince: '2026-10-30T05:00:00.000Z',
      waitedHours: 3,
    })

    expect(JSON.stringify(rendered)).not.toMatch(
      /safety|health|discriminat|legal|threat|rating|star|reason/i,
    )
  })

  it('says so when a later revision’s alert met the same unread row', () => {
    const rendered = renderNotification('review.ai_urgent_detected', {
      propertyName: 'Seaview Hotel',
      occurrences: 3,
    })

    expect(rendered.body).toContain('This happened 3 times.')
  })
})
