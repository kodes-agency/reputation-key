// Payload parsing is a governance boundary, not a convenience: it is the gate
// that keeps Google source content out of a durable 90-day table and out of
// outbound email (ADR 0046 r.8, ADR 0031, BQC-1.2). These tests assert the
// allowlist drops everything it does not recognise, and that malformed input
// degrades the copy instead of losing the notification.

import { describe, it, expect } from 'vitest'
import {
  isEmptyNotificationPayload,
  parseNotificationPayload,
} from './notification-payload'

describe('parseNotificationPayload', () => {
  it('keeps every allowlisted field', () => {
    expect(
      parseNotificationPayload({
        propertyName: 'Riverside Hotel',
        rating: 2,
        platform: 'google',
        waitingHours: 27,
        actorRole: 'property_manager',
        moderationReason: 'Tone is too defensive.',
        goalName: 'Q3 response time',
        badgeName: 'Fast Responder',
        recipientName: 'Front Desk',
        targetKind: 'portal_group',
        occurrences: 3,
      }),
    ).toEqual({
      propertyName: 'Riverside Hotel',
      rating: 2,
      platform: 'google',
      waitingHours: 27,
      actorRole: 'property_manager',
      moderationReason: 'Tone is too defensive.',
      goalName: 'Q3 response time',
      badgeName: 'Fast Responder',
      recipientName: 'Front Desk',
      targetKind: 'portal_group',
      occurrences: 3,
    })
  })

  // The whole point of the allowlist. If this test ever goes green with
  // reviewText present, source content is reaching email.
  it('drops forbidden source-content fields', () => {
    const parsed = parseNotificationPayload({
      propertyName: 'Riverside Hotel',
      reviewText: 'The room was filthy and the staff were rude.',
      reviewerName: 'Maria K.',
      guestEmail: 'maria@example.com',
      replyText: 'We are sorry to hear this.',
      snippet: 'The room was filthy',
      sentimentScore: -0.82,
      mediaUrl: 'https://lh3.googleusercontent.com/x',
      actorName: 'Dave from reception',
    })

    expect(parsed).toEqual({ propertyName: 'Riverside Hotel' })
  })

  it('returns an empty payload for non-object input', () => {
    for (const input of [null, undefined, 'x', 7, true, ['a']]) {
      expect(parseNotificationPayload(input)).toEqual({})
    }
  })

  describe('rating', () => {
    it.each([1, 2, 3, 4, 5])('accepts %i', (rating) => {
      expect(parseNotificationPayload({ rating }).rating).toBe(rating)
    })

    it.each([0, 6, -1, 2.5, '3', null])('rejects %p', (rating) => {
      expect(parseNotificationPayload({ rating }).rating).toBeUndefined()
    })
  })

  describe('enums', () => {
    it('rejects a value outside the union', () => {
      const parsed = parseNotificationPayload({
        platform: 'tripadvisor',
        actorRole: 'superuser',
        targetKind: 'organization',
      })
      expect(parsed).toEqual({})
    })
  })

  describe('counts', () => {
    it.each([0, 1, 999])('accepts non-negative integer %i', (waitingHours) => {
      expect(parseNotificationPayload({ waitingHours }).waitingHours).toBe(waitingHours)
    })

    it.each([-1, 1.5, Number.NaN, '4'])('rejects %p', (waitingHours) => {
      expect(parseNotificationPayload({ waitingHours }).waitingHours).toBeUndefined()
    })
  })

  describe('text', () => {
    it('trims and drops whitespace-only values', () => {
      expect(parseNotificationPayload({ propertyName: '  Riverside  ' }).propertyName).toBe(
        'Riverside',
      )
      expect(parseNotificationPayload({ propertyName: '   ' }).propertyName).toBeUndefined()
    })

    it('truncates a name past the 120-char cap', () => {
      const name = 'a'.repeat(200)
      expect(parseNotificationPayload({ propertyName: name }).propertyName).toHaveLength(120)
    })

    it('truncates a moderation reason past the 500-char cap', () => {
      const reason = 'b'.repeat(900)
      expect(
        parseNotificationPayload({ moderationReason: reason }).moderationReason,
      ).toHaveLength(500)
    })

    // Escaping is the renderer's job; the payload must not silently mangle
    // input, or a property genuinely named "Ben & Jerry's" would break.
    it('preserves markup characters verbatim', () => {
      expect(
        parseNotificationPayload({ propertyName: "<b>Ben & Jerry's</b>" }).propertyName,
      ).toBe("<b>Ben & Jerry's</b>")
    })
  })
})

describe('isEmptyNotificationPayload', () => {
  it('is true only when nothing survived parsing', () => {
    expect(isEmptyNotificationPayload({})).toBe(true)
    expect(isEmptyNotificationPayload({ rating: 4 })).toBe(false)
  })
})
