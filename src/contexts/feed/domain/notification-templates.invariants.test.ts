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
import {
  notificationReplyTo,
  renderNotification,
  waitingAge,
} from './notification-templates'
import { FULL, UUID } from './notification-templates.test-fixtures'
import { NOTIFICATION_TYPES, type NotificationType } from './notification-types'

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
      type.startsWith('account.') ||
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
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase())
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

// One row that absorbed repeat events says how many, once, with the verb for
// what repeated. The count covers every event, the first one included.
describe('renderNotification — coalescing (ADR 0046 r.2)', () => {
  it.each([
    ['inbox_note.added', '3 notes added.'],
    ['inbox.escalated', 'Escalated 3 times.'],
    ['review.updated', 'Updated 3 times.'],
    ['reply.pending_approval', 'This happened 3 times.'],
    ['reply.publish_failed', 'This happened 3 times.'],
    // Notices of one type for one Organization merge into one unread row.
    ['account.invitation_accepted', 'This happened 3 times.'],
    ['account.organization_property_access_changed', 'This happened 3 times.'],
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

    // A notice may still say what it is about ("waiting for approval"): that is
    // no age, so only that phrase is let through the guard.
    const copy = [r.title, r.body, r.summary]
      .join(' ')
      .replace(/waiting for approval/gi, '')
    expect(copy).not.toMatch(/waiting|waited|2d/i)
  })
})

describe('renderNotification — mandatory notice wiring', () => {
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
      'account.organization_property_access_changed',
      'account.invitation_accepted',
      'account.organization_purge_pending',
    ]
    const reasons = mandatory.map((type) => renderNotification(type, {}).whyReceived)

    expect(reasons.filter((reason) => reason !== undefined)).toHaveLength(
      mandatory.length,
    )
    expect(new Set(reasons).size).toBe(mandatory.length)
    expect(renderNotification('reply.pending_approval', {}).whyReceived).toBeUndefined()
  })
})

describe('renderNotification — payloads that never went through the allowlist', () => {
  it.each([
    ['a month key that never went through the allowlist', { goalMonth: 'last month' }],
    ['a target time that is not an instant', { targetDueAt: 'tomorrow' }],
    [
      "a goal's figures that never went through the allowlist",
      {
        goalMonth: '2026-11',
        goalSubjectKind: 'portal',
        goalSubjectName: 'Reception',
        goalMeasure: 'portal_rating_count',
        goalCount: 'forty',
        goalTargetCount: -1,
      },
    ],
    [
      'goal facts outside their enums',
      {
        goalSubjectKind: 'team',
        goalOutcome: 'maybe',
        goalMarker: 'soon',
        goalMeasure: 'stars',
      },
    ],
  ] as const)('renders rather than throwing on %s', (_case, payload) => {
    // Both facts are formatted, and both render in the bell's own paint: a
    // payload that reached a template unparsed must shorten the copy, never
    // take the feed down with a RangeError.
    for (const type of NOTIFICATION_TYPES) {
      const rendered = renderNotification(type, payload as NotificationPayload, {
        timeZone: 'UTC',
      })
      expect(rendered.title).not.toBe('')
      expect(rendered.title).not.toMatch(/undefined|NaN|Invalid/)
      expect(rendered.body).not.toMatch(/undefined|NaN|Invalid/)
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

describe('renderNotification — the in-app detail line', () => {
  it.each([
    'review.created',
    'feedback.created',
    'inbox.escalated',
    'reply.pending_approval',
    'inbox.assigned',
    'inbox_note.added',
    'goal.completed',
  ] as const)(
    'adds nothing under a %s title that the title does not already say',
    (type) => {
      const rendered = renderNotification(type, {
        propertyName: 'Riverside Hotel',
        actorRole: 'property_manager',
      })
      expect(rendered.body).not.toBe('')
      expect(rendered.detail).toBe('')
    },
  )

  it('keeps the reason a notice was reopened and leaves the repeat count to the row', () => {
    const rendered = renderNotification('inbox.reopened', {
      reopenReason: 'new_information',
      occurrences: 3,
    })
    expect(rendered.detail).toBe('New information came in.')
    expect(rendered.body).toContain('This happened 3 times.')
  })

  it("shows a passed Response Target as its target time, on the reader's clock", () => {
    const rendered = renderNotification(
      'inbox.response_target_passed',
      { targetDueAt: '2026-09-29T11:00:00.000Z' },
      { timeZone: 'Europe/Sofia' },
    )
    expect(rendered.detail).toBe('The target time was Tue, Sep 29, 14:00.')
  })

  it('says why a reply was sent back only when the notice knows whether a reason exists', () => {
    expect(
      renderNotification('reply.rejected', { hasModerationReason: true }).detail,
    ).toBe(
      'The approver left a reason. Open the reply to read it, then edit and resubmit.',
    )
    expect(renderNotification('reply.rejected', {}).detail).toBe('')
  })

  it('shows the imported counts, and nothing when the count is unknown', () => {
    expect(
      renderNotification('property.review_import_finished', {
        importOutcome: 'completed',
        importedCount: 240,
        unansweredCount: 12,
      }).detail,
    ).toBe('We imported 240 reviews; 12 still need a reply.')
    expect(
      renderNotification('property.review_import_finished', {
        importOutcome: 'completed',
      }).detail,
    ).toBe('')
  })

  it('never says anything in the detail that the email body does not', () => {
    const payload = {
      propertyName: 'Riverside Hotel',
      platform: 'portal',
      guestRating: 2,
      actorRole: 'staff',
      reopenReason: 'guest_follow_up_still_needed',
      publishOutcome: 'refused',
      publicationCancellationCause: 'policy',
      portalHealthStatus: 'unavailable',
      portalHealthReason: 'public_address_unavailable',
      reauthorizationCause: 'member_removed',
      importOutcome: 'failed',
      importFailureReason: 'location_too_large',
      hasModerationReason: false,
      targetDueAt: '2026-09-29T11:00:00.000Z',
      occurrences: 2,
    } as const
    for (const type of NOTIFICATION_TYPES) {
      const rendered = renderNotification(type, payload, { timeZone: 'UTC' })
      if (rendered.detail !== '') expect(rendered.body).toContain(rendered.detail)
    }
  })
})

// ADR 0046, amended 2026-09-30 (with ADR 0031): a Low ratings notice says so,
// and why, but never how many stars a Google review has.
describe('a Low ratings notice', () => {
  const low = {
    propertyName: 'Harbour View Suites',
    platform: 'google' as const,
    lowRating: true as const,
  }

  it('names a new review low-rated, without its stars', () => {
    const copy = renderNotification('review.created', low)

    expect(copy.title).toBe('Low-rated review at Harbour View Suites')
    expect(copy.body).toContain('at or below the rating you asked to hear about')
    expect(`${copy.title} ${copy.body}`).not.toMatch(/\d\s*(★|star)/i)
  })

  it('names an edit that brought a review down', () => {
    expect(renderNotification('review.updated', low).title).toBe(
      'Review edited to a low rating at Harbour View Suites',
    )
  })

  it("names private feedback low-rated; its Portal rating is RepKey's own", () => {
    expect(
      renderNotification('feedback.created', {
        propertyName: 'Harbour View Suites',
        platform: 'portal',
        guestRating: 2,
        lowRating: true,
      }).title,
    ).toBe('Low-rated guest feedback at Harbour View Suites')
  })

  it('keeps the plain copy without the flag', () => {
    expect(
      renderNotification('review.created', { propertyName: 'Harbour View Suites' }).title,
    ).toBe('New review at Harbour View Suites')
  })
})
