// These tests are the copy contract. They exist because the shipped copy was
// unusable — raw identifiers reached user-visible copy. The same renderer now
// feeds the in-app row, urgent email and digest line, so a regression here
// regresses every channel at once.
//
// The invariants worth defending, in priority order:
//   1. No identifier ever reaches user-visible copy.
//   2. Copy is complete and grammatical with an EMPTY payload.
//   3. Metadata sharpens the copy; it never produces "undefined" or a dangling
//      preposition.
//   4. Every type has an imperative action label.

import { describe, it, expect } from 'vitest'
import type { NotificationPayload } from './notification-payload'
import { parseNotificationPayload } from './notification-payload'
import {
  formatWaitingAge,
  notificationLink,
  renderNotification,
} from './notification-templates'
import { NOTIFICATION_TYPES, type NotificationType } from './types'

const UUID = '61ed98fc-9cf8-44e9-b49d-cd25e744fd6c'

const FULL: NotificationPayload = {
  propertyName: 'Riverside Hotel',
  guestRating: 2,
  platform: 'portal',
  waitingHours: 27,
  actorRole: 'property_manager',
  moderationReason: 'Tone is too defensive.',
  goalName: 'Q3 response time',
}

describe('renderNotification — invariants across every type', () => {
  it.each(NOTIFICATION_TYPES)('%s renders completely with an empty payload', (type) => {
    const r = renderNotification(type, {})

    expect(r.title.trim()).not.toBe('')
    // The per-field sweep below is a per-template invariant check: it.each runs
    // it for every NotificationType, and it is written out again for the full
    // payload because the two shapes do not share the same invariants — only an
    // empty-payload render can be asserted to carry no dangling punctuation from
    // a dropped optional clause. A shared helper would need a flag selecting
    // which invariants apply and would report failures at the helper's line
    // instead of the template shape under test. Revisit if the sets converge.
    // fallow-ignore-next-line code-duplication
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

    const visibleCopy = [r.title, r.body, r.summary].join(' ')
    // Recovery alerts are deliberately content-free: even if an unexpected
    // producer supplies render metadata, this template must ignore it. Other
    // types use the property name to sharpen their operational context.
    if (
      type.startsWith('account.organization_') ||
      type === 'portal.responsibility_needed' ||
      type === 'property.responsibility_needed'
    ) {
      expect(visibleCopy).not.toContain('Riverside Hotel')
    } else {
      expect(visibleCopy).toContain('Riverside Hotel')
    }
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
      guestRating: 2,
      platform: 'portal',
      waitingHours: 27,
    })

    expect(r.title).toBe('Escalated: 2-star feedback at Riverside Hotel')
    expect(r.body).toContain('Waiting 1d')
    expect(r.actionLabel).toBe('Respond now')
    expect(r.title).not.toContain('Inbox item')
  })

  it('describes an escalation resolution without alarming or blaming managers', () => {
    expect(
      renderNotification('inbox.escalation_resolved', {
        propertyName: 'Riverside Hotel',
      }),
    ).toEqual({
      title: 'Follow-up updated at Riverside Hotel',
      body: 'This item is no longer marked for extra attention. You can open it to review the latest status.',
      actionLabel: 'View item',
      summary: 'Riverside Hotel · follow-up updated',
    })
  })

  it('describes a material Review revision as a calm follow-up', () => {
    expect(
      renderNotification('review.updated', { propertyName: 'Riverside Hotel' }),
    ).toEqual({
      title: 'Review updated at Riverside Hotel',
      body: 'The guest changed their review. Open it to check the latest details.',
      actionLabel: 'Review update',
      summary: 'Riverside Hotel · updated review',
    })
  })

  it('describes reopened private feedback without blame or alarm language', () => {
    expect(
      renderNotification('inbox.reopened', {
        propertyName: 'Riverside Hotel',
        platform: 'portal',
        guestRating: 2,
      }),
    ).toEqual({
      title: 'Follow-up reopened at Riverside Hotel',
      body: 'This 2-star feedback needs another look. Open it to review the latest status.',
      actionLabel: 'View item',
      summary: 'Riverside Hotel · 2-star feedback · follow-up reopened',
    })
  })

  it('reply.pending_approval leads with the decision and says who and how long', () => {
    const r = renderNotification('reply.pending_approval', {
      propertyName: 'Riverside Hotel',
      waitingHours: 5,
      actorRole: 'staff',
    })

    expect(r.title).toBe('Approve a reply at Riverside Hotel')
    expect(r.body).toContain('A team member drafted a reply to a review')
    expect(r.body).toContain('Waiting 5h')
    expect(r.actionLabel).toBe('Review reply')
  })

  it('review.created remains useful after provider ratings are rejected', () => {
    const payload = parseNotificationPayload({
      propertyName: 'Riverside',
      rating: 1,
      platform: 'google',
    })
    const rendered = renderNotification('review.created', payload)

    expect(rendered.title).toBe('New review at Riverside')
    expect(rendered.body).toBe('Open it to read the review and reply.')
    expect(JSON.stringify(payload)).not.toContain('rating')
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

  it('renders a provider review without any source rating clause', () => {
    const r = renderNotification('review.created', { propertyName: 'Riverside' })
    expect(r.title).toBe('New review at Riverside')
  })

  it('renders a grouped assignment from a content-free count', () => {
    const rendered = renderNotification('inbox.bulk_assigned', {
      propertyName: 'Riverside Hotel',
      actorRole: 'account_admin',
      itemCount: 7,
    })

    expect(rendered.title).toBe('7 inbox items assigned to you at Riverside Hotel')
    expect(rendered.body).toBe(
      'An account admin assigned 7 items to you. Open the Inbox to review your work.',
    )
    expect(rendered.actionLabel).toBe('Open Inbox')
  })

  it('omits the property clause entirely when no name is known', () => {
    const r = renderNotification('review.created', {})
    expect(r.title).toBe('New review')
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
  it('uses a neutral account page for Organization-scoped notices', () => {
    expect(notificationLink('organization', 'org-1', null)).toEqual({
      path: '/settings/profile',
      search: {},
    })
  })

  it('renders calm, actionable account-access copy', () => {
    expect(renderNotification('account.organization_access_granted', {})).toEqual({
      title: 'Organization access added',
      body: 'Your account can now access this organization.',
      actionLabel: 'Review account',
      summary: 'organization access added',
    })
    expect(renderNotification('account.organization_role_changed', {})).toEqual({
      title: 'Organization role updated',
      body: 'Your account permissions for this organization were updated.',
      actionLabel: 'Review account',
      summary: 'organization role updated',
    })
    expect(renderNotification('account.organization_access_removed', {})).toEqual({
      title: 'Organization access removed',
      body: 'Your account no longer has access to this organization. If this seems unexpected, contact an account administrator.',
      actionLabel: 'Review account',
      summary: 'organization access removed',
    })
  })

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

  it('renders a gentle portal responsibility recovery prompt without content', () => {
    expect(renderNotification('portal.responsibility_needed', {})).toEqual({
      title: 'Portal needs a responsible manager',
      body: 'Choose an eligible manager so portal updates reach the right people.',
      actionLabel: 'Choose manager',
      summary: 'responsible manager needed',
    })
    expect(notificationLink('portal', 'portal-1', 'prop-1')).toEqual({
      path: '/properties/prop-1/portals/portal-1',
      search: { tab: 'settings' },
    })
  })

  it('renders a gentle Property responsibility recovery prompt without content', () => {
    expect(renderNotification('property.responsibility_needed', {})).toEqual({
      title: 'Property needs a responsible manager',
      body: 'Choose an eligible manager so property-wide updates reach the right people.',
      actionLabel: 'Choose manager',
      summary: 'Property responsible manager needed',
    })
    expect(notificationLink('property', 'prop-1', 'prop-1')).toEqual({
      path: '/properties/prop-1/settings',
      search: {},
    })
  })

  it('describes a revised Goal result without claiming it was achieved', () => {
    expect(
      renderNotification('goal.result_revised', {
        goalName: 'Monthly guest engagement',
      }),
    ).toEqual({
      title: 'Goal result updated: Monthly guest engagement',
      body: 'A monthly result changed. Open the property to see the current metrics.',
      actionLabel: 'View result',
      summary: 'Monthly guest engagement',
    })
  })

  it('covers every resource type', () => {
    const types: ReadonlyArray<Parameters<typeof notificationLink>[0]> = [
      'inbox_item',
      'reply',
      'goal',
      'badge',
      'portal',
      'property',
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
