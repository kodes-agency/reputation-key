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
  notificationLink,
  notificationReplyTo,
  renderNotification,
  waitingAge,
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
    // Every Property-scoped notice names its Property: a reader with several
    // cannot otherwise tell rows or urgent emails apart. Account notices, a
    // beta report outcome (ADR 0059) and a Google disconnect (ADR 0046,
    // amended 2026-09-24) are Organization-scoped, and the Google connection
    // belongs to the Organization: the Property `reauthorization_required` is
    // filed under is only a delivery anchor, so naming it would mislead.
    if (
      type.startsWith('account.organization_') ||
      type.startsWith('integration.') ||
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

// A fact is said once per surface. The in-app strip shows the Property (in
// the title), the rating (as stars) and the wait beside the copy, and email
// shows them in its facts line, so the sentences never restate the rating.
describe('renderNotification — facts beside the copy, not inside it', () => {
  it.each(NOTIFICATION_TYPES)(
    '%s never states the rating in its title or body',
    (type) => {
      const r = renderNotification(type, FULL)

      expect([r.title, r.body].join(' ')).not.toMatch(/\d-star|out of 5|rated/i)
    },
  )

  it('keeps the rating in the facts line email shows', () => {
    const r = renderNotification('feedback.created', FULL)

    expect(r.body).toBe('Open it to read the feedback.')
    expect(r.summary).toBe('Riverside Hotel · 2-star feedback')
  })

  // The item lookup can fail and leave no platform; guest feedback is still
  // feedback, never a review.
  it('calls guest feedback feedback when its source is unknown', () => {
    const r = renderNotification('feedback.created', { propertyName: 'Riverside Hotel' })

    expect(r.summary).toBe('Riverside Hotel · feedback')
  })
})

describe('renderNotification — the copy that was broken', () => {
  it('inbox.escalated names the property instead of the item id', () => {
    const r = renderNotification('inbox.escalated', {
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      platform: 'portal',
    })

    expect(r.title).toBe('Escalated: feedback at Riverside Hotel')
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

  // The Inbox thread says "Escalation resolved"; the notice for the same event
  // says the same, not "Follow-up updated", which the Inbox uses for a
  // feedback outcome.
  it('describes an escalation resolution in the Inbox words, without alarm or blame', () => {
    expect(
      renderNotification('inbox.escalation_resolved', {
        propertyName: 'Riverside Hotel',
      }),
    ).toEqual({
      title: 'Escalation resolved at Riverside Hotel',
      body: 'This item is no longer escalated. Open it to see where it stands.',
      actionLabel: 'View item',
      summary: 'Riverside Hotel · escalation resolved',
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
      title: 'Reopened: feedback at Riverside Hotel',
      body: 'This feedback needs another look. Open it to see where it stands.',
      actionLabel: 'View item',
      summary: 'Riverside Hotel · 2-star feedback · reopened',
    })
  })

  it.each([
    [
      'provider_reply_deleted',
      'The published reply was removed from Google. Open it to see where it stands.',
    ],
    [
      'guest_follow_up_still_needed',
      'The guest still needs a follow-up. Open it to see where it stands.',
    ],
    [
      'correcting_handling_status',
      'Its handling status was wrong. Open it to see where it stands.',
    ],
  ] as const)('says why an item was reopened (%s)', (reopenReason, body) => {
    expect(
      renderNotification('inbox.reopened', {
        propertyName: 'Riverside Hotel',
        reopenReason,
      }).body,
    ).toBe(body)
  })

  it.each([
    [
      'publication_snapshot_unavailable',
      'unavailable',
      'Guest portal is offline at Riverside Hotel',
      'Its published version is missing, so guests cannot load it.',
    ],
    [
      'public_address_unavailable',
      'unavailable',
      'Guest portal is offline at Riverside Hotel',
      'Its web address no longer resolves, so guests cannot reach it.',
    ],
    [
      'google_destination_unavailable',
      'degraded',
      'Guest portal needs attention at Riverside Hotel',
      'Its Google review destination is gone, so the Google step is broken.',
    ],
  ] as const)(
    'says what is actually wrong with a portal (%s)',
    (portalHealthReason, portalHealthStatus, title, opening) => {
      const rendered = renderNotification('portal.health_attention', {
        propertyName: 'Riverside Hotel',
        portalHealthStatus,
        portalHealthReason,
      })

      expect(rendered.title).toBe(title)
      expect(rendered.body.startsWith(opening)).toBe(true)
      expect(rendered.body).not.toContain('may need attention')
    },
  )

  it('states the target time of a reminder in the reader\u2019s own timezone', () => {
    const payload = {
      propertyName: 'Riverside Hotel',
      targetDueAt: '2026-09-29T12:00:00.000Z',
    }

    const inNewYork = renderNotification('inbox.response_target_halfway', payload, {
      timeZone: 'America/New_York',
    })
    const inSofia = renderNotification('inbox.response_target_halfway', payload, {
      timeZone: 'Europe/Sofia',
    })

    expect(inNewYork.body).toContain('Target time Tue, Sep 29, 08:00')
    expect(inSofia.body).toContain('Target time Tue, Sep 29, 15:00')
    // The product term is "target time"; "due" is not a word this product uses.
    expect(`${inNewYork.title} ${inNewYork.body}`).not.toMatch(/\bdue\b/i)
  })

  it('says a passed target time in the past tense', () => {
    expect(
      renderNotification(
        'inbox.response_target_passed',
        { targetDueAt: '2026-09-29T12:00:00.000Z' },
        { timeZone: 'UTC' },
      ).body,
    ).toContain('The target time was Tue, Sep 29, 12:00.')
  })

  it('omits the target time when the reader\u2019s timezone is unknown', () => {
    const rendered = renderNotification('inbox.response_target_halfway', {
      targetDueAt: '2026-09-29T12:00:00.000Z',
    })

    expect(rendered.body).toBe('This item is still open.')
  })

  it('falls back to the vague portal notice only when the health fact is missing', () => {
    expect(renderNotification('portal.health_attention', {}).title).toBe(
      'A guest portal may need attention',
    )
  })

  it('still reads correctly when the reopen fact named no usable reason', () => {
    expect(
      renderNotification('inbox.reopened', {
        propertyName: 'Riverside Hotel',
        reopenReason: 'other',
      }).body,
    ).toBe('This review needs another look. Open it to see where it stands.')
  })

  it.each([
    ['google', 'New internal note on a review at Riverside Hotel'],
    ['portal', 'New internal note on feedback at Riverside Hotel'],
  ] as const)('names a %s Internal Note the way the Inbox does', (platform, title) => {
    expect(
      renderNotification('inbox_note.added', {
        propertyName: 'Riverside Hotel',
        platform,
      }).title,
    ).toBe(title)
  })

  // Reply exists only for Reviews (glossary); private feedback is handled.
  it.each(NOTIFICATION_TYPES)('%s never offers a reply on private feedback', (type) => {
    const r = renderNotification(type, { platform: 'portal', guestRating: 2 })

    if (!type.startsWith('reply.') && !type.startsWith('review.')) {
      expect([r.title, r.body, r.actionLabel].join(' ')).not.toMatch(/\breply\b/i)
    }
  })

  it.each(NOTIFICATION_TYPES)('%s never calls its event a follow-up', (type) => {
    const r = renderNotification(type, FULL)

    expect([r.title, r.body, r.summary].join(' ')).not.toMatch(/follow-up/i)
  })

  it('names the target reminders plainly', () => {
    expect(renderNotification('inbox.response_target_halfway', {}).title).toBe(
      'Halfway to the response target',
    )
    expect(renderNotification('inbox.response_target_passed', {}).title).toBe(
      'Response target passed',
    )
  })

  it('opens a published reply without implying it leaves for Google', () => {
    expect(renderNotification('reply.published', {}).actionLabel).toBe('View reply')
  })

  it('reply.pending_approval leads with the decision and says who drafted it', () => {
    const r = renderNotification('reply.pending_approval', {
      propertyName: 'Riverside Hotel',
      actorRole: 'staff',
    })

    expect(r.title).toBe('Approve a reply at Riverside Hotel')
    expect(r.body).toBe(
      'A team member drafted a reply to a review. It stays unpublished until you approve it.',
    )
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

  // One fact covers every way a publication can end without a confirmed live
  // reply, most of which Google never saw. Each outcome gets the sentence that
  // is true for it. The notice can reach a responsible manager instead of the
  // author, so none of it says "your".
  it.each([
    [
      'not_sent',
      'Reply not published at Riverside Hotel',
      'Nothing was posted to Google, so it is safe to try again.',
      'Retry publish',
    ],
    [
      'refused',
      'Reply not published at Riverside Hotel',
      'Nothing was posted to Google. Check the Google connection, then try again.',
      'Retry publish',
    ],
    [
      'unconfirmed',
      'Reply not confirmed on Google at Riverside Hotel',
      "RepKey won't send it twice. Open it to check.",
      'View reply',
    ],
  ] as const)(
    'reply.publish_failed words a %s outcome as what happened',
    (publishOutcome, title, body, actionLabel) => {
      const r = renderNotification('reply.publish_failed', {
        propertyName: 'Riverside Hotel',
        publishOutcome,
      })

      expect(r).toMatchObject({ title, body, actionLabel })
      expect([r.title, r.body].join(' ')).not.toMatch(/rejected|your/i)
    },
  )

  // `not_sent` covers an answered 429 as well as requests that never left
  // RepKey, so, like the Inbox's "Not published" copy, it says only that
  // nothing was posted, never that nothing reached Google.
  it('reply.publish_failed never says a retryable failure missed Google', () => {
    const r = renderNotification('reply.publish_failed', { publishOutcome: 'not_sent' })

    expect(r.body).not.toMatch(/reached/i)
  })

  it('reply.publish_failed claims no cause and offers no retry when the outcome is unknown', () => {
    // Rows recorded before the fact carried an outcome, including replies
    // that may be live on Google.
    expect(renderNotification('reply.publish_failed', {})).toEqual({
      title: 'Reply not published',
      body: 'Open the reply to see where it stands.',
      actionLabel: 'View reply',
      summary: 'review · not published',
    })
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

    expect(rendered.title).toBe('7 items assigned to you at Riverside Hotel')
    expect(rendered.body).toBe(
      'An account admin assigned 7 items to you. Open the Inbox to see your work.',
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

    expect(rendered.title).toBe('60 items reopened at Riverside Hotel')
    expect(rendered.body).toBe(
      'An account admin reopened 60 items. Open the Inbox to take a look.',
    )
    expect(rendered.actionLabel).toBe('Open Inbox')
    expect(single.title).toBe('1 item reopened')
    expect(single.body).toBe('Someone reopened an item. Open the Inbox to take a look.')
  })

  it('omits the property clause entirely when no name is known', () => {
    const r = renderNotification('review.created', {})
    expect(r.title).toBe('New review')
  })
})

// One row that absorbed repeat events says how many, once, with the verb for
// what repeated. The count covers every event, the first one included.
describe('renderNotification — coalescing (ADR 0046 r.2)', () => {
  it.each([
    ['inbox_note.added', '3 notes added.'],
    ['inbox.escalated', 'Escalated 3 times.'],
    ['review.updated', 'Updated 3 times.'],
    ['reply.pending_approval', 'This happened 3 times.'],
    ['reply.publish_failed', 'This happened 3 times.'],
  ] as const)('ends a repeated %s with "%s"', (type, marker) => {
    const r = renderNotification(type, { occurrences: 3 })

    expect(r.body.endsWith(` ${marker}`)).toBe(true)
    // Said once: the facts line beside the copy does not repeat it.
    expect(r.summary).not.toMatch(/3/)
  })

  it('marks nothing on a row that fired once', () => {
    const r = renderNotification('inbox_note.added', { occurrences: 1 })

    expect(r.body).not.toMatch(/added\.$|times/)
  })
})

// A notice shows how long its item had waited when the notice was raised: the
// read projects that from when the wait began to the row's latest event. The
// copy only formats it, so no surface measures against its own clock.
describe('waiting age', () => {
  it.each([
    [0, ''],
    [1, '1h'],
    [23, '23h'],
    [24, '1d'],
    [49, '2d'],
  ])('%i whole hours read "%s"', (waitedHours, expected) => {
    expect(waitingAge({ waitedHours })).toBe(expected)
  })

  it('reads nothing when nothing was waiting, however old a frozen age is', () => {
    expect(waitingAge({ waitingHours: 48 })).toBe('')
  })

  it('reads nothing from a start instant the read has not measured', () => {
    expect(waitingAge({ waitingSince: '2026-09-20T09:00:00.000Z' })).toBe('')
  })

  it('puts the wait in the email facts, never in the sentence', () => {
    const r = renderNotification('reply.pending_approval', {
      propertyName: 'Riverside Hotel',
      waitedHours: 49,
    })

    expect(r.summary).toBe('Riverside Hotel · review · waited 2d')
    expect([r.title, r.body].join(' ')).not.toMatch(/wait/i)
  })

  it.each(NOTIFICATION_TYPES)('%s never renders the frozen age of an old row', (type) => {
    const r = renderNotification(type, { waitingHours: 48 })

    expect([r.title, r.body, r.summary].join(' ')).not.toMatch(/waiting|waited|2d/i)
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
      whyReceived:
        'You received this because your account was given access to an organization on Reputation Key.',
    })
    expect(renderNotification('account.organization_role_changed', {})).toEqual({
      title: 'Organization role updated',
      body: 'Your account permissions for this organization were updated.',
      actionLabel: 'Review account',
      summary: 'organization role updated',
      whyReceived:
        'You received this because what your account may do in an organization on Reputation Key changed.',
    })
    expect(renderNotification('account.organization_access_removed', {})).toEqual({
      title: 'Organization access removed',
      body: 'Your account no longer has access to this organization. If this seems unexpected, contact an account administrator.',
      actionLabel: 'Review account',
      summary: 'organization access removed',
      whyReceived:
        'You received this because your access to an organization on Reputation Key ended.',
    })
  })

  it('names the organization in the final deletion notice and says what, when and who can stop it', () => {
    expect(
      renderNotification('account.organization_purge_pending', {
        organizationName: 'Riverside Group',
      }),
    ).toEqual({
      title: 'Final notice: permanent deletion of Riverside Group',
      body: 'The recovery window has ended. Deletion can start at any time and permanently erases its properties, portals, reviews, replies and Inbox history. Only Reputation Key support can stop it, before it starts. To stop it, answer this email or write to denev@kodes.agency now.',
      actionLabel: 'Open profile',
      summary: 'Riverside Group · permanent deletion pending',
      whyReceived:
        'You received this because you administer an organization that is scheduled for permanent deletion. It cannot be turned off.',
    })
    expect(renderNotification('account.organization_purge_pending', {}).title).toBe(
      'Final notice: permanent deletion of this organization',
    )
  })

  it('gives the final deletion notice a reachable reply-to and leaves every other type without one', () => {
    expect(notificationReplyTo('account.organization_purge_pending')).toBe(
      'denev@kodes.agency',
    )
    expect(notificationReplyTo('account.organization_access_removed')).toBeNull()
    expect(notificationReplyTo('reply.pending_approval')).toBeNull()
  })

  it('gives every mandatory type its own footer wording and leaves optional types without one', () => {
    const mandatory: ReadonlyArray<NotificationType> = [
      'account.organization_access_granted',
      'account.organization_role_changed',
      'account.organization_access_removed',
      'account.organization_purge_pending',
    ]
    const reasons = mandatory.map((type) => renderNotification(type, {}).whyReceived)

    expect(reasons.filter((reason) => reason !== undefined)).toHaveLength(
      mandatory.length,
    )
    expect(new Set(reasons).size).toBe(mandatory.length)
    expect(renderNotification('reply.pending_approval', {}).whyReceived).toBeUndefined()
  })

  it('deep-links an inbox item through typed search params', () => {
    expect(notificationLink('inbox_item', UUID, 'prop-1')).toEqual({
      path: '/inbox',
      search: { itemId: UUID },
    })
  })

  // Regression: the previous builder used the goal's resourceId as a
  // propertyId, producing a dead /properties/<goalId> route. A goal notice's
  // resource is the monthly result it reports; the Property's Goals page
  // opens the goal that result belongs to.
  it('links a goal notice to the goal of the monthly result it reports', () => {
    expect(notificationLink('goal', 'result-9', 'prop-1')).toEqual({
      path: '/properties/prop-1/goals',
      search: { result: 'result-9' },
    })
  })

  it.each(['goal', 'badge', 'portal', 'property'] as const)(
    'never builds a %s link into a Property it does not have',
    (resourceType) => {
      expect(notificationLink(resourceType, 'r', null).path).toBe('/properties')
    },
  )

  // A grouped assignment is many items: it opens the recipient's own queue at
  // that Property, not whichever item happened to sort first.
  it("opens a grouped assignment on the recipient's queue at that Property", () => {
    expect(notificationLink('inbox_item', UUID, 'prop-1', 'inbox.bulk_assigned')).toEqual(
      { path: '/inbox', search: { queue: 'mine', propertyId: 'prop-1' } },
    )
    expect(notificationLink('inbox_item', UUID, 'prop-1', 'inbox.assigned')).toEqual({
      path: '/inbox',
      search: { itemId: UUID },
    })
  })

  // A bulk reopen is many items too, reopened for whoever is responsible, not
  // assigned to the reader: it opens that Property's Open queue.
  it("opens a grouped reopen on that Property's open items", () => {
    expect(notificationLink('inbox_item', UUID, 'prop-1', 'inbox.bulk_reopened')).toEqual(
      { path: '/inbox', search: { queue: 'open', propertyId: 'prop-1' } },
    )
    expect(notificationLink('inbox_item', UUID, null, 'inbox.bulk_reopened')).toEqual({
      path: '/inbox',
      search: { queue: 'open' },
    })
    expect(notificationLink('inbox_item', UUID, 'prop-1', 'inbox.reopened')).toEqual({
      path: '/inbox',
      search: { itemId: UUID },
    })
  })

  it('lands legacy reply rows on the inbox list rather than a stale reply', () => {
    expect(notificationLink('reply', 'reply-1', 'prop-1')).toEqual({
      path: '/inbox',
      search: {},
    })
  })

  it('renders a gentle portal responsibility recovery prompt that says where', () => {
    expect(
      renderNotification('portal.responsibility_needed', {
        propertyName: 'Riverside Hotel',
      }),
    ).toEqual({
      title: 'A portal at Riverside Hotel needs a responsible manager',
      body: 'Choose an eligible manager so portal updates reach the right people.',
      actionLabel: 'Choose manager',
      summary: 'Riverside Hotel · responsible manager needed',
    })
    expect(renderNotification('portal.responsibility_needed', {}).title).toBe(
      'A portal needs a responsible manager',
    )
    expect(notificationLink('portal', 'portal-1', 'prop-1')).toEqual({
      path: '/properties/prop-1/portals/portal-1',
      search: { tab: 'settings' },
    })
  })

  it('renders a gentle Property responsibility recovery prompt that names it', () => {
    expect(
      renderNotification('property.responsibility_needed', {
        propertyName: 'Riverside Hotel',
      }),
    ).toEqual({
      title: 'Riverside Hotel needs a responsible manager',
      body: 'Choose an eligible manager so property-wide updates reach the right people.',
      actionLabel: 'Choose manager',
      summary: 'Riverside Hotel · responsible manager needed',
    })
    expect(renderNotification('property.responsibility_needed', {}).title).toBe(
      'A property needs a responsible manager',
    )
    // "Choose manager" lands where the manager picker is, not on whichever
    // setup section the settings hub redirects to first.
    expect(notificationLink('property', 'prop-1', 'prop-1')).toEqual({
      path: '/properties/prop-1/settings/people',
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
      body: 'A monthly result changed. Open the goal to see the current metrics.',
      actionLabel: 'View result',
      summary: 'Monthly guest engagement',
    })
  })

  // Google refused the grant for good: sync and replies have already stopped,
  // so the notice leads with the one action that restores them. The
  // connection is the Organization's, so its delivery Property is not named.
  it('asks admins to reconnect a Google grant that stopped working, and says why', () => {
    expect(
      renderNotification('integration.reauthorization_required', {
        propertyName: 'Riverside Hotel',
        reauthorizationCause: 'provider_revoked',
      }),
    ).toEqual({
      title: 'Reconnect Google',
      body: 'Google no longer accepts RepKey\u2019s access, so review updates and replies are paused.',
      actionLabel: 'Reconnect Google',
      summary: 'Google access ended',
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

  it('follows the outcome for a publish failure with no named cause', () => {
    expect(
      renderNotification('reply.publish_failed', { publishOutcome: 'refused' }).body,
    ).toBe('Nothing was posted to Google. Check the Google connection, then try again.')
  })

  // The outcome says what happened; the cause names the only remedy that works.
  it('names the reconnect remedy over the outcome when Google must be reconnected', () => {
    expect(
      renderNotification('reply.publish_failed', {
        propertyName: 'Riverside Hotel',
        publishOutcome: 'refused',
        publishFailureCause: 'google_reauthorization_required',
      }),
    ).toEqual({
      title: 'Reply not published at Riverside Hotel',
      body: 'Google needs reconnecting first. An account admin can reconnect it in Settings, then retry \u2014 the draft is saved.',
      actionLabel: 'Open reply',
      summary: 'Riverside Hotel · review · reconnect Google',
    })
  })

  it('names the month, the subject and the direction of a goal result', () => {
    expect(
      renderNotification('goal.completed', {
        goalName: 'Lobby QR scans',
        propertyName: 'Riverside Hotel',
        goalMonth: '2026-10',
        goalSubjectKind: 'portal',
      }),
    ).toEqual({
      title: 'October goal met: Lobby QR scans at Riverside Hotel',
      body: 'This Portal goal hit its target. Open the goal to see the numbers.',
      actionLabel: 'View progress',
      summary: 'Riverside Hotel · Lobby QR scans · Portal',
    })
  })

  it.each([
    ['not_met', 'October goal no longer met: Lobby QR scans'],
    ['met', 'October goal met: Lobby QR scans'],
    ['unavailable', 'October goal result unavailable: Lobby QR scans'],
  ] as const)('says which way a corrected result went (%s)', (goalOutcome, title) => {
    expect(
      renderNotification('goal.result_revised', {
        goalName: 'Lobby QR scans',
        goalMonth: '2026-10',
        goalOutcome,
      }).title,
    ).toBe(title)
  })

  it('tells a Portal Group goal apart from a Portal one', () => {
    expect(
      renderNotification('goal.result_revised', {
        goalName: 'Lobby QR scans',
        goalSubjectKind: 'portal_group',
        goalOutcome: 'not_met',
      }).body,
    ).toBe(
      'This Portal Group goal no longer meets its target. Open the goal to see the current metrics.',
    )
  })

  it('goal.completed sends the reader to the goal', () => {
    expect(renderNotification('goal.completed', {}).body).toBe(
      'This goal hit its target. Open the goal to see the numbers.',
    )
  })

  it.each(['goal.completed', 'goal.result_revised'] as const)(
    '%s says which Property the goal belongs to in its title',
    (type) => {
      const title = renderNotification(type, {
        goalName: 'Reply within 24h',
        propertyName: 'Riverside Hotel',
      }).title

      expect(title).toMatch(/: Reply within 24h at Riverside Hotel$/)
    },
  )

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
