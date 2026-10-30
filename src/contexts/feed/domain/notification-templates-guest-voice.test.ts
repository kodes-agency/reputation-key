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

describe('the Guest voice summary copy', () => {
  const lines = [
    {
      kind: 'fix_first',
      topic: 'facilities_equipment',
      reviewCount: 19,
      textReviewCount: 128,
      upToHundredths: 20,
    },
    { kind: 'protect', topic: 'staff_service', reviewCount: 61, textReviewCount: 128 },
    {
      kind: 'change',
      topic: 'cleanliness',
      reviewCount: 12,
      textReviewCount: 128,
      change: 'rising',
      polarity: 'complaint',
    },
  ] as const

  it('states the three lines as topics and counts, and opens Guest voice', () => {
    const rendered = renderNotification('guest_voice.summary', {
      propertyName: 'Seaview Hotel',
      guestVoiceKind: 'weekly',
      guestVoiceWindow: '90d',
      guestVoiceLines: lines,
    })

    expect(rendered.title).toBe('Your Guest voice this week at Seaview Hotel')
    expect(rendered.lines).toEqual([
      'Fix first: Facilities and equipment, in 19 of 128 reviews, worth up to about 0.2★ on your 90-day average.',
      'Guests love: Staff and service, in 61 of 128 reviews.',
      'Cleanliness complaints are rising.',
    ])
    expect(rendered.body).toBe(rendered.lines?.join(' '))
    expect(rendered.actionLabel).toBe('Open Guest voice')
    expect(rendered.summary).toBe('Seaview Hotel · weekly summary')
  })

  it('words the first Monday of the month as a roundup', () => {
    const rendered = renderNotification('guest_voice.summary', {
      propertyName: 'Seaview Hotel',
      guestVoiceKind: 'monthly',
      guestVoiceWindow: '30d',
      guestVoiceLines: lines.slice(0, 1),
    })

    expect(rendered.title).toBe('Your Guest voice this month at Seaview Hotel')
    expect(rendered.summary).toBe('Seaview Hotel · monthly roundup')
  })

  it('says a month with nothing to name has nothing, and is still sent', () => {
    const rendered = renderNotification('guest_voice.summary', {
      guestVoiceKind: 'monthly',
      guestVoiceLines: [],
    })

    expect(rendered.title).toBe('Your Guest voice this month')
    expect(rendered.body).toBe('Nothing stands out. Open it for every topic.')
    expect(rendered.lines).toBeUndefined()
  })

  it('words praise that moves as praise, and a fall as a fall', () => {
    const rendered = renderNotification('guest_voice.summary', {
      guestVoiceLines: [
        {
          kind: 'change',
          topic: 'staff_service',
          reviewCount: 40,
          textReviewCount: 100,
          change: 'falling',
          polarity: 'praise',
        },
      ],
    })

    expect(rendered.lines).toEqual(['Praise for Staff and service is falling.'])
  })

  it('shows 0.15 and 0.05 as the engine rounds them, and nothing for no worth', () => {
    const render = (upToHundredths: number) =>
      renderNotification('guest_voice.summary', {
        guestVoiceWindow: '30d',
        guestVoiceLines: [{ ...lines[0], upToHundredths }],
      }).lines?.[0]

    expect(render(15)).toContain('about 0.15★ on your 30-day average')
    expect(render(5)).toContain('about 0.05★ on your 30-day average')
    expect(render(0)).toBe('Fix first: Facilities and equipment, in 19 of 128 reviews.')
  })

  it('carries no word of a review: only fixed topic labels, counts and a window', () => {
    const rendered = renderNotification('guest_voice.summary', {
      propertyName: 'Seaview Hotel',
      guestVoiceKind: 'weekly',
      guestVoiceWindow: '90d',
      guestVoiceLines: lines,
    })

    expect(JSON.stringify(rendered)).not.toMatch(
      /air conditioning|not working|rude|dirty|quote|said|wrote/i,
    )
  })
})
