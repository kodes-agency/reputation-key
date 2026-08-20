// These tests are the copy contract. They exist because the shipped copy was
// unusable — "Inbox item 61ed98fc-9cf8-44e9-b49d-cd25e744fd6c has been
// escalated and requires attention" and "Badge definition: <uuid>" — and
// because the same renderer now feeds the in-app row, the urgent email and the
// digest line, so a regression here regresses every channel at once.
//
// The invariants worth defending, in priority order:
//   1. No identifier ever reaches user-visible copy.
//   2. Copy is complete and grammatical with an EMPTY payload.
//   3. Metadata sharpens the copy; it never produces "undefined" or a dangling
//      preposition.
//   4. Every type has an imperative action label.

import { describe, it, expect } from 'vitest'
import type { NotificationPayload } from './notification-payload'
import {
  formatWaitingAge,
  notificationLink,
  renderNotification,
} from './notification-templates'
import { NOTIFICATION_TYPES, type NotificationType } from './types'

const UUID = '61ed98fc-9cf8-44e9-b49d-cd25e744fd6c'

const FULL: NotificationPayload = {
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
}

describe('renderNotification — invariants across every type', () => {
  it.each(NOTIFICATION_TYPES)('%s renders completely with an empty payload', (type) => {
    const r = renderNotification(type, {})

    expect(r.title.trim()).not.toBe('')
    expect(r.actionLabel.trim()).not.toBe('')
    // A missing-metadata render must not leak the template's seams.
    for (const field of [r.title, r.body, r.actionLabel, r.summary]) {
      expect(field).not.toMatch(/undefined|null|NaN/)
      expect(field).not.toMatch(/\s{2,}/)
      // Dangling punctuation is the tell-tale of a dropped optional clause.
      // `·` is excluded: the summary line legitimately joins facts with " · ".
      expect(field).not.toMatch(/\s+\./)
    }
  })

  it.each(NOTIFICATION_TYPES)('%s renders completely with a full payload', (type) => {
    const r = renderNotification(type, FULL)

    // Where the property name lands is per-type: review/reply copy leads with
    // the property, while goal/badge copy leads with the goal or badge name and
    // carries the property in the body. Assert it surfaces SOMEWHERE.
    expect([r.title, r.body, r.summary].join(' ')).toContain('Riverside Hotel')
    for (const field of [r.title, r.body, r.actionLabel, r.summary]) {
      expect(field).not.toMatch(/undefined|null|NaN/)
      expect(field).not.toMatch(/\s{2,}/)
    }
  })

  // The user's actual complaint. Payload has no id-shaped field, so the only
  // way a UUID could appear is if someone reintroduces string interpolation.
  it.each(NOTIFICATION_TYPES)('%s never emits an identifier', (type) => {
    const withIds = { ...FULL, propertyName: UUID } as NotificationPayload
    const r = renderNotification(type, withIds)
    const all = [r.title, r.body, r.summary].join(' ')

    // The only UUID present is the one we deliberately fed in as a name.
    expect(all.replace(new RegExp(UUID, 'g'), '')).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )
  })

  it.each(NOTIFICATION_TYPES)('%s action label is short and imperative', (type) => {
    const label = renderNotification(type, FULL).actionLabel
    expect(label.split(' ').length).toBeLessThanOrEqual(3)
    expect(label[0]).toBe(label[0].toUpperCase())
  })
})

describe('renderNotification — the copy that was broken', () => {
  it('inbox.escalated names the property and the wait instead of the item id', () => {
    const r = renderNotification('inbox.escalated', {
      propertyName: 'Riverside Hotel',
      rating: 2,
      waitingHours: 27,
    })

    expect(r.title).toBe('Escalated: 2-star review at Riverside Hotel')
    expect(r.body).toContain('Waiting 1d')
    expect(r.actionLabel).toBe('Respond now')
    expect(r.title).not.toContain('Inbox item')
  })

  it('badge.awarded names the badge instead of its definition id', () => {
    const r = renderNotification('badge.awarded', {
      badgeName: 'Fast Responder',
      recipientName: 'Front Desk',
      targetKind: 'portal_group',
      propertyName: 'Riverside Hotel',
    })

    expect(r.title).toBe('Front Desk earned Fast Responder')
    expect(r.body).toContain('Riverside Hotel')
    expect(r.summary).toContain('Fast Responder')
  })

  it('reply.pending_approval leads with the decision and says who and how long', () => {
    const r = renderNotification('reply.pending_approval', {
      propertyName: 'Riverside Hotel',
      rating: 2,
      waitingHours: 5,
      actorRole: 'staff',
    })

    expect(r.title).toBe('Approve a reply at Riverside Hotel')
    expect(r.body).toContain('A team member drafted a reply to a 2-star review')
    expect(r.body).toContain('Waiting 5h')
    expect(r.actionLabel).toBe('Review reply')
  })

  it('review.created escalates its own guidance for a low rating', () => {
    const bad = renderNotification('review.created', { propertyName: 'Riverside', rating: 1 })
    const good = renderNotification('review.created', { propertyName: 'Riverside', rating: 5 })

    expect(bad.title).toBe('New 1-star review at Riverside')
    expect(bad.body).toContain('low rating')
    expect(good.body).not.toContain('low rating')
  })

  it('reply.rejected surfaces the moderation reason', () => {
    const withReason = renderNotification('reply.rejected', {
      moderationReason: 'Tone is too defensive.',
    })
    const without = renderNotification('reply.rejected', {})

    expect(withReason.body).toContain('Reason: Tone is too defensive.')
    // The old copy prefixed the title verbatim: "Rejected: <reason>".
    expect(withReason.title).not.toContain('Rejected:')
    expect(without.body).toContain('without a reason')
  })

  it('omits the rating clause entirely when no rating is known', () => {
    const r = renderNotification('review.created', { propertyName: 'Riverside' })
    expect(r.title).toBe('New review at Riverside')
  })

  it('omits the property clause entirely when no name is known', () => {
    const r = renderNotification('review.created', { rating: 4 })
    expect(r.title).toBe('New 4-star review')
  })
})

describe('renderNotification — coalescing (ADR 0046 r.2)', () => {
  it('marks a row that absorbed repeat events', () => {
    const once = renderNotification('inbox.escalated', { occurrences: 1 })
    const thrice = renderNotification('inbox.escalated', { occurrences: 3 })

    expect(once.body).not.toContain('Updated')
    expect(thrice.body).toContain('Updated 3 times.')
    expect(thrice.summary).toContain('3x')
  })
})

describe('formatWaitingAge', () => {
  it.each([
    [undefined, ''],
    [0, ''],
    [1, '1h'],
    [23, '23h'],
    [24, '1d'],
    [49, '2d'],
  ])('%p -> %p', (hours, expected) => {
    expect(formatWaitingAge(hours)).toBe(expected)
  })
})

describe('notificationLink', () => {
  it('deep-links an inbox item through typed search params', () => {
    expect(notificationLink('inbox_item', UUID, 'prop-1')).toEqual({
      path: '/inbox',
      search: { itemId: UUID },
    })
  })

  // Regression: the previous builder used the goal's resourceId as a
  // propertyId, producing a dead /properties/<goalId> route.
  it('links a goal to its property, not to its own id', () => {
    expect(notificationLink('goal', 'goal-9', 'prop-1')).toEqual({
      path: '/properties/prop-1',
      search: {},
    })
  })

  it('lands legacy reply rows on the inbox list rather than a stale reply', () => {
    expect(notificationLink('reply', 'reply-1', 'prop-1')).toEqual({
      path: '/inbox',
      search: {},
    })
  })

  it('sends badges to recognition', () => {
    expect(notificationLink('badge', 'badge-1', 'prop-1')).toEqual({
      path: '/settings/recognition',
      search: {},
    })
  })

  it('covers every resource type', () => {
    const types: ReadonlyArray<Parameters<typeof notificationLink>[0]> = [
      'inbox_item',
      'reply',
      'goal',
      'badge',
    ]
    for (const t of types) {
      expect(notificationLink(t, 'r', 'p').path).toMatch(/^\//)
    }
  })
})

// Guards the RENDERERS map: a new NotificationType with no renderer would
// throw at runtime rather than fail a build, so pin it here.
describe('renderer coverage', () => {
  it('has a renderer for every declared type', () => {
    for (const type of NOTIFICATION_TYPES as ReadonlyArray<NotificationType>) {
      expect(() => renderNotification(type, {})).not.toThrow()
    }
  })
})
