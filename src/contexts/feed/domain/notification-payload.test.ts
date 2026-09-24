// Payload parsing is a governance boundary, not a convenience: it is the gate
// that keeps Google source content out of a durable 90-day table and out of
// outbound email (ADR 0046 r.8, ADR 0031, BQC-1.2). These tests assert the
// allowlist drops everything it does not recognise, and that malformed input
// degrades the copy instead of losing the notification.

import { describe, it, expect } from 'vitest'
import {
  isEmptyNotificationPayload,
  parseNotificationPayload,
  type NotificationPayload,
} from './notification-payload'

describe('parseNotificationPayload', () => {
  it('keeps every allowlisted field', () => {
    expect(
      parseNotificationPayload({
        propertyName: 'Riverside Hotel',
        guestRating: 2,
        platform: 'portal',
        waitingHours: 27,
        actorRole: 'property_manager',
        moderationReason: 'Tone is too defensive.',
        goalName: 'Q3 response time',
        occurrences: 3,
        itemCount: 4,
      }),
    ).toEqual({
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      platform: 'portal',
      waitingHours: 27,
      actorRole: 'property_manager',
      moderationReason: 'Tone is too defensive.',
      goalName: 'Q3 response time',
      occurrences: 3,
      itemCount: 4,
    })
  })

  it('keeps a reopen reason only while it is one of the governed causes', () => {
    expect(parseNotificationPayload({ reopenReason: 'provider_reply_deleted' })).toEqual({
      reopenReason: 'provider_reply_deleted',
    })
    expect(
      parseNotificationPayload({ reopenReason: 'the guest phoned reception' }),
    ).toEqual({})
  })

  it('keeps the Portal health facts only for the states that raise a notice', () => {
    expect(
      parseNotificationPayload({
        portalHealthStatus: 'unavailable',
        portalHealthReason: 'public_address_unavailable',
      }),
    ).toEqual({
      portalHealthStatus: 'unavailable',
      portalHealthReason: 'public_address_unavailable',
    })
    // `healthy`/`operational` never notify, so they are not admitted either.
    expect(
      parseNotificationPayload({
        portalHealthStatus: 'healthy',
        portalHealthReason: 'operational',
      }),
    ).toEqual({})
  })

  /**
   * Both directions of the allowlist in one fixture. `Required<…>` makes the
   * compiler name any field added to the payload type, and the round trip
   * proves the parser admits it: a field declared but never `set()` is
   * dropped at the boundary and its copy silently degrades everywhere. That
   * is exactly how `portalHealthStatus` shipped unparsed once.
   */
  it('parses every field the payload type declares', () => {
    const everyField: Required<NotificationPayload> = {
      propertyName: 'Riverside Hotel',
      organizationName: 'Riverside Group',
      guestRating: 2,
      platform: 'portal',
      waitingHours: 27,
      waitingSince: '2026-09-20T08:00:00.000Z',
      waitedHours: 4,
      actorRole: 'property_manager',
      moderationReason: 'Tone is too defensive.',
      hasModerationReason: true,
      publishOutcome: 'refused',
      goalName: 'Lobby QR scans',
      occurrences: 3,
      itemCount: 4,
      reportOutcome: 'accepted',
      reauthorizationCause: 'provider_revoked',
      publishFailureCause: 'google_reauthorization_required',
      reopenReason: 'provider_reply_deleted',
      publicationCancellationCause: 'source_changed',
      portalHealthStatus: 'unavailable',
      portalHealthReason: 'public_address_unavailable',
      targetDueAt: '2026-09-29T12:00:00.000Z',
      goalMonth: '2026-10',
      goalSubjectKind: 'portal',
      goalOutcome: 'met',
    }

    const parsed = parseNotificationPayload(everyField)

    // `waitedHours` is projected at read time, never parsed from storage.
    expect(Object.keys(parsed).sort()).toEqual(
      Object.keys(everyField)
        .filter((key) => key !== 'waitedHours')
        .sort(),
    )
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

  // The reason a Google connection needs reauthorization is a closed fact from
  // the integration.google_account.reauthorization_required event, never text.
  it('keeps a known Google reauthorization cause and drops anything else', () => {
    expect(
      parseNotificationPayload({ reauthorizationCause: 'provider_revoked' }),
    ).toEqual({ reauthorizationCause: 'provider_revoked' })
    expect(parseNotificationPayload({ reauthorizationCause: 'member_removed' })).toEqual({
      reauthorizationCause: 'member_removed',
    })
    expect(
      parseNotificationPayload({ reauthorizationCause: 'Token has been revoked.' }),
    ).toEqual({})
  })

  it('keeps the reconnect cause of a failed publication and drops anything else', () => {
    expect(
      parseNotificationPayload({
        publishFailureCause: 'google_reauthorization_required',
      }),
    ).toEqual({ publishFailureCause: 'google_reauthorization_required' })
    expect(
      parseNotificationPayload({ publishFailureCause: 'rejected by Google' }),
    ).toEqual({})
  })

  it('returns an empty payload for non-object input', () => {
    for (const input of [null, undefined, 'x', 7, true, ['a']]) {
      expect(parseNotificationPayload(input)).toEqual({})
    }
  })

  describe('guestRating', () => {
    it.each([1, 2, 3, 4, 5])('accepts local Portal rating %i', (guestRating) => {
      expect(
        parseNotificationPayload({ guestRating, platform: 'portal' }).guestRating,
      ).toBe(guestRating)
    })

    it.each([0, 6, -1, 2.5, '3', null])('rejects %p', (guestRating) => {
      expect(
        parseNotificationPayload({ guestRating, platform: 'portal' }).guestRating,
      ).toBeUndefined()
    })

    it('drops legacy/provider rating fields and rejects guestRating outside Portal', () => {
      expect(
        parseNotificationPayload({ rating: 1, guestRating: 2, platform: 'google' }),
      ).toEqual({ platform: 'google' })
    })
  })

  describe('enums', () => {
    it('rejects a value outside the union', () => {
      const parsed = parseNotificationPayload({
        platform: 'tripadvisor',
        actorRole: 'superuser',
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

    it('keeps only a non-negative integer grouped item count', () => {
      expect(parseNotificationPayload({ itemCount: 12 }).itemCount).toBe(12)
      expect(parseNotificationPayload({ itemCount: -1 }).itemCount).toBeUndefined()
    })
  })

  describe('flags', () => {
    it.each([true, false])('keeps whether a rejection came with a reason: %s', (flag) => {
      expect(
        parseNotificationPayload({ hasModerationReason: flag }).hasModerationReason,
      ).toBe(flag)
    })

    it.each(['true', 1, null, 'Too defensive'])('rejects %p', (flag) => {
      expect(
        parseNotificationPayload({ hasModerationReason: flag }).hasModerationReason,
      ).toBeUndefined()
    })
  })

  it('keeps the organization display name as a trimmed name', () => {
    expect(
      parseNotificationPayload({ organizationName: '  Riverside Group  ' })
        .organizationName,
    ).toBe('Riverside Group')
  })

  describe('when a wait began', () => {
    it('keeps a valid instant in ISO form', () => {
      expect(
        parseNotificationPayload({ waitingSince: '2026-09-20T11:00:00+02:00' })
          .waitingSince,
      ).toBe('2026-09-20T09:00:00.000Z')
    })

    it.each(['yesterday', '', 1_790_000_000_000, null])('drops %p', (waitingSince) => {
      expect(parseNotificationPayload({ waitingSince }).waitingSince).toBeUndefined()
    })
  })

  describe('publication outcome', () => {
    it.each(['not_sent', 'refused', 'unconfirmed'] as const)('keeps %s', (outcome) => {
      expect(parseNotificationPayload({ publishOutcome: outcome }).publishOutcome).toBe(
        outcome,
      )
    })

    it.each(['rejected', 'Google said no', 1, null])('drops %p', (outcome) => {
      expect(
        parseNotificationPayload({ publishOutcome: outcome }).publishOutcome,
      ).toBeUndefined()
    })
  })

  describe('text', () => {
    it('trims and drops whitespace-only values', () => {
      expect(
        parseNotificationPayload({ propertyName: '  Riverside  ' }).propertyName,
      ).toBe('Riverside')
      expect(
        parseNotificationPayload({ propertyName: '   ' }).propertyName,
      ).toBeUndefined()
    })

    it('truncates a name past the 120-char cap', () => {
      const name = 'a'.repeat(200)
      expect(parseNotificationPayload({ propertyName: name }).propertyName).toHaveLength(
        120,
      )
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
    expect(isEmptyNotificationPayload({ guestRating: 4, platform: 'portal' })).toBe(false)
  })
})
