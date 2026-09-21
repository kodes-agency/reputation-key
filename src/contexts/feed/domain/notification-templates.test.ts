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
import { NOTIFICATION_TYPES, type NotificationType } from './notification-types'

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
    // A beta report outcome is Organization-scoped (ADR 0059): there is no
    // Property for it to name.
    if (
      type.startsWith('account.organization_') ||
      type === 'portal.responsibility_needed' ||
      type === 'property.responsibility_needed' ||
      type === 'beta_feedback.outcome'
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
  it('inbox.escalated names the property instead of the item id', () => {
    const r = renderNotification('inbox.escalated', {
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      platform: 'portal',
    })

    expect(r.title).toBe('Escalated: 2-star feedback at Riverside Hotel')
    expect(r.title).not.toContain('Inbox item')
  })

  // Escalation is a manual flag with no reason field, and it can be set on an
  // item that already has a reply or is closed. The copy may say who asked for
  // attention; it may not say why, or that anything is unanswered or overdue.
  it.each([
    { platform: 'google', guestRating: undefined },
    { platform: 'portal', guestRating: 2 },
  ] as const)(
    'inbox.escalated says who escalated a $platform item and invents no cause',
    ({ platform, guestRating }) => {
      const r = renderNotification('inbox.escalated', {
        propertyName: 'Riverside Hotel',
        platform,
        guestRating,
        waitingHours: 75,
        actorRole: 'property_manager',
      })

      expect(r.body).toBe(
        'A property manager escalated this for your attention. Open it to see where it stands.',
      )
      expect(r.actionLabel).toBe('Open item')
      expect([r.title, r.body, r.summary].join(' ')).not.toMatch(
        /unanswered|because|needs a reply|\bnow\b/i,
      )
    },
  )

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

  it('reply.rejected still quotes a reason stored on a historical row', () => {
    const withReason = renderNotification('reply.rejected', {
      moderationReason: 'Tone is too defensive.',
    })

    expect(withReason.body).toContain('Reason: Tone is too defensive.')
    // The old copy prefixed the title verbatim: "Rejected: <reason>".
    expect(withReason.title).not.toContain('Rejected:')
  })

  it('reply.rejected says whether the approver left a reason, never what it says', () => {
    const withReason = renderNotification('reply.rejected', { hasModerationReason: true })
    const withoutReason = renderNotification('reply.rejected', {
      hasModerationReason: false,
    })
    // A row recorded before the fact said either way must not guess.
    const unknown = renderNotification('reply.rejected', {})

    expect(withReason.body).toBe(
      'The approver left a reason. Open the reply to read it, then edit and resubmit.',
    )
    expect(withoutReason.body).toBe(
      'It was sent back without a reason. Edit it and resubmit.',
    )
    expect(unknown.body).toBe(
      'Open it to see any note from the approver, then edit and resubmit.',
    )
  })

  it('reply.rejected follows the latest rejection once rows coalesce', () => {
    const rendered = renderNotification('reply.rejected', {
      moderationReason: 'Tone is too defensive.',
      hasModerationReason: false,
    })

    expect(rendered.body).toBe('It was sent back without a reason. Edit it and resubmit.')
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

  it('renders a grouped bulk reopen from a content-free count', () => {
    const rendered = renderNotification('inbox.bulk_reopened', {
      propertyName: 'Riverside Hotel',
      actorRole: 'account_admin',
      itemCount: 60,
    })
    const single = renderNotification('inbox.bulk_reopened', { itemCount: 1 })

    expect(rendered.title).toBe('60 follow-ups reopened at Riverside Hotel')
    expect(rendered.body).toBe(
      'An account admin reopened 60 items. Open the Inbox to review the latest status.',
    )
    expect(rendered.actionLabel).toBe('Open Inbox')
    expect(single.title).toBe('Follow-up reopened')
    expect(single.body).toBe(
      'Someone reopened an item. Open the Inbox to review the latest status.',
    )
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

  it('renders pending-purge copy without implying self-service', () => {
    expect(renderNotification('account.organization_purge_pending', {})).toEqual({
      title: 'Final notice: this organization is scheduled for permanent deletion',
      body: 'The recovery window has ended. Data will be permanently erased and cannot be restored. No self-service action is available. Contact support immediately while deletion is still pending.',
      actionLabel: 'Open profile',
      summary: 'organization purge pending',
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

  // Google refused the grant for good: sync and replies have already stopped,
  // so the notice leads with the one action that restores them.
  it('asks admins to reconnect a Google grant that stopped working, and says why', () => {
    expect(
      renderNotification('integration.reauthorization_required', {
        propertyName: 'Riverside Hotel',
        reauthorizationCause: 'provider_revoked',
      }),
    ).toEqual({
      title: 'Reconnect Google at Riverside Hotel',
      body: 'Google no longer accepts RepKey\u2019s access, so review updates and replies are paused.',
      actionLabel: 'Reconnect Google',
      summary: 'Riverside Hotel · Google access ended',
    })
  })

  it('keeps the general wording when a connector left rather than Google refusing', () => {
    expect(
      renderNotification('integration.reauthorization_required', {
        reauthorizationCause: 'member_removed',
      }).title,
    ).toBe('Google connection needs attention')
  })

  // Retrying cannot publish the reply until Google is reconnected, and the
  // author may not be the one who can reconnect it.
  it('tells a reply author Google must be reconnected before a retry can publish', () => {
    expect(
      renderNotification('reply.publish_failed', {
        propertyName: 'Riverside Hotel',
        publishFailureCause: 'google_reauthorization_required',
      }),
    ).toEqual({
      title: 'Reply not published at Riverside Hotel',
      body: 'Google needs reconnecting first. An account admin can reconnect it in Settings, then retry \u2014 the draft is saved.',
      actionLabel: 'Open reply',
      summary: 'Riverside Hotel · review · reconnect Google',
    })
  })

  it('keeps the rejection wording for a publish failure with no named cause', () => {
    expect(renderNotification('reply.publish_failed', {}).body).toBe(
      'Google rejected the reply to a review. Open it and retry \u2014 the draft is saved.',
    )
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
