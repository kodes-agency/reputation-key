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
import { parseNotificationPayload } from './notification-payload'
import { renderNotification } from './notification-templates'
import { copy, type ExactCopyCase, FULL } from './notification-templates.test-fixtures'
import { NOTIFICATION_TYPES } from './notification-types'

describe('renderNotification — the import summary that replaced a flood', () => {
  it('says what was imported and how much of it is still waiting', () => {
    const r = renderNotification('property.review_import_finished', {
      propertyName: 'Riverside Hotel',
      importOutcome: 'completed',
      importedCount: 260,
      unansweredCount: 254,
    })

    expect(r.body).toContain('260')
    expect(r.body).toContain('254')
    expect(r.title).toContain('Riverside Hotel')
  })

  it('does not ask for a reply when nothing is waiting', () => {
    const r = renderNotification('property.review_import_finished', {
      propertyName: 'Riverside Hotel',
      importOutcome: 'completed',
      importedCount: 12,
      unansweredCount: 0,
    })

    expect(r.body).toContain('12')
    expect(r.body).not.toMatch(/still need/u)
  })

  // The unanswered count is left out of the payload exactly when it is
  // unknown: the Inbox never settled within the summary's wait, or a read
  // failed. ADR 0046: that costs the sentence its second number, never the
  // notice — and "unknown" must not read as "none", which after a large import
  // is when the most reviews are waiting.
  const importedBody = (unansweredCount?: number): string =>
    renderNotification('property.review_import_finished', {
      importOutcome: 'completed',
      importedCount: 260,
      ...(unansweredCount === undefined ? {} : { unansweredCount }),
    }).body

  it('says nothing is waiting only when it counted none', () => {
    expect(importedBody(0)).toBe(
      'We imported 260 reviews. Nothing is waiting for a reply.',
    )
  })

  it('drops the second number, and claims nothing, when the count is unknown', () => {
    expect(importedBody()).toBe('We imported 260 reviews.')
  })

  it('names how many still need a reply when it counted them', () => {
    expect(importedBody(14)).toBe('We imported 260 reviews; 14 still need a reply.')
  })

  it('keeps a sentence a reader can act on when the counts never arrived', () => {
    const r = renderNotification('property.review_import_finished', {
      propertyName: 'Riverside Hotel',
      importOutcome: 'completed',
    })

    expect(r.body.trim()).not.toBe('')
    expect(r.body).not.toMatch(/undefined|NaN/u)
  })

  it('tells a stopped import what to do next, per closed reason', () => {
    const reconnect = renderNotification('property.review_import_finished', {
      propertyName: 'Riverside Hotel',
      importOutcome: 'failed',
      importFailureReason: 'google_authorization',
    })
    const relink = renderNotification('property.review_import_finished', {
      propertyName: 'Riverside Hotel',
      importOutcome: 'failed',
      importFailureReason: 'property_source_changed',
    })
    const tooLarge = renderNotification('property.review_import_finished', {
      propertyName: 'Riverside Hotel',
      importOutcome: 'failed',
      importFailureReason: 'location_too_large',
    })

    expect(reconnect.body).toMatch(/Reconnect Google/u)
    expect(relink.body).toMatch(/link/iu)
    expect(tooLarge.body).toMatch(/support/iu)
    for (const r of [reconnect, relink, tooLarge]) {
      expect(r.title).not.toMatch(/imported/iu)
    }
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

describe('renderNotification — account notices', () => {
  describe('account notices that name the organization and the role (ADR 0046 r.8)', () => {
    const ORG = 'Riverside Group'

    it.each([
      ['property_manager', 'You are now a Property Manager.'],
      ['account_admin', 'You are now an Account Admin.'],
    ] as const)('names the %s role a member now holds', (memberRole, body) => {
      const rendered = renderNotification('account.organization_role_changed', {
        organizationName: ORG,
        memberRole,
      })

      expect(rendered).toMatchObject({
        title: 'Your role at Riverside Group changed',
        body,
        // The role is news the title does not carry, so the row shows it.
        detail: body,
        summary: 'Riverside Group · role changed',
        whyReceived:
          'You received this because what your account may do in an organization on Reputation Key changed.',
      })
    })

    it('falls back to the plain role-change sentence when the role is unknown', () => {
      expect(
        renderNotification('account.organization_role_changed', {
          organizationName: ORG,
        }),
      ).toMatchObject({
        title: 'Your role at Riverside Group changed',
        body: 'Your account permissions for this organization were updated.',
        detail: '',
      })
      expect(
        renderNotification('account.organization_role_changed', {
          memberRole: 'account_admin',
        }),
      ).toMatchObject({
        title: 'Organization role updated',
        body: 'You are now an Account Admin.',
      })
    })

    it('names the organization a member left or was removed from', () => {
      expect(
        renderNotification('account.organization_access_removed', {
          organizationName: ORG,
          leftOrganization: true,
        }),
      ).toMatchObject({
        title: 'You left Riverside Group',
        summary: 'Riverside Group · left',
      })
      expect(
        renderNotification('account.organization_access_removed', {
          organizationName: ORG,
        }),
      ).toMatchObject({
        title: 'Your access to Riverside Group was removed',
        summary: 'Riverside Group · access removed',
      })
    })

    it('tells a member their property access changed, naming the organization', () => {
      expect(
        renderNotification('account.organization_property_access_changed', {
          organizationName: ORG,
        }),
      ).toEqual({
        title: 'Your property access changed',
        body: 'Your property access at Riverside Group changed. Open Properties to see what you can work.',
        detail: '',
        actionLabel: 'Open Properties',
        summary: 'Riverside Group · property access changed',
        whyReceived:
          'You received this because an Account Admin changed which properties you can work.',
      })
      expect(
        renderNotification('account.organization_property_access_changed', {}),
      ).toMatchObject({
        title: 'Your property access changed',
        body: 'Open Properties to see what you can work.',
        summary: 'property access changed',
      })
    })

    it('tells an inviter their invitation was accepted without naming who accepted it', () => {
      expect(
        renderNotification('account.invitation_accepted', { organizationName: ORG }),
      ).toEqual({
        title: 'An invitation you sent was accepted',
        body: 'Someone you invited joined Riverside Group. Review their properties in Members.',
        detail: '',
        actionLabel: 'Open Members',
        summary: 'Riverside Group · invitation accepted',
        whyReceived:
          'You received this because an invitation you sent on Reputation Key was accepted.',
      })
      expect(renderNotification('account.invitation_accepted', {})).toMatchObject({
        title: 'An invitation you sent was accepted',
        body: 'Someone you invited joined. Review their properties in Members.',
        summary: 'invitation accepted',
      })
    })

    it('never renders an identifier or a repeat count into an account notice', () => {
      const types = [
        'account.organization_access_granted',
        'account.organization_role_changed',
        'account.organization_access_removed',
        'account.organization_property_access_changed',
        'account.invitation_accepted',
      ] as const
      for (const type of types) {
        const rendered = renderNotification(type, {
          organizationName: ORG,
          memberRole: 'property_manager',
          occurrences: 1,
        })
        expect(
          [rendered.title, rendered.body, rendered.detail, rendered.summary].join(' '),
        ).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|undefined/)
      }
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
      detail:
        'The recovery window has ended. Deletion can start at any time and permanently erases its properties, portals, reviews, replies and Inbox history. Only Reputation Key support can stop it, before it starts. To stop it, answer this email or write to denev@kodes.agency now.',
      actionLabel: 'Open profile',
      summary: 'Riverside Group · permanent deletion pending',
      whyReceived:
        'You received this because you administer an organization that is scheduled for permanent deletion. It cannot be turned off.',
    })
    expect(renderNotification('account.organization_purge_pending', {}).title).toBe(
      'Final notice: permanent deletion of this organization',
    )
  })
})

const ACCESS_GRANTED_WHY =
  'You received this because your account was given access to an organization on Reputation Key.'
const ROLE_CHANGED_WHY =
  'You received this because what your account may do in an organization on Reputation Key changed.'
const ACCESS_REMOVED_BODY =
  'Your account no longer has access to this organization. If this seems unexpected, contact an account administrator.'

const EXACT_COPY: ReadonlyArray<ExactCopyCase> = [
  // The Inbox thread says "Escalation resolved"; the notice for the same event
  // says the same, not "Follow-up updated", which the Inbox uses for a
  // feedback outcome.
  [
    'describes an escalation resolution in the Inbox words, without alarm or blame',
    'inbox.escalation_resolved',
    { propertyName: 'Riverside Hotel' },
    undefined,
    copy({
      title: 'Escalation resolved at Riverside Hotel',
      body: 'This item is no longer escalated. Open it to see where it stands.',
      actionLabel: 'View item',
      summary: 'Riverside Hotel · escalation resolved',
    }),
  ],
  [
    'describes a material Review revision as a calm follow-up',
    'review.updated',
    { propertyName: 'Riverside Hotel' },
    undefined,
    copy({
      title: 'Review updated at Riverside Hotel',
      body: 'The guest changed their review. Open it to check the latest details.',
      actionLabel: 'Review update',
      summary: 'Riverside Hotel · updated review',
    }),
  ],
  [
    'describes reopened private feedback without blame or alarm language',
    'inbox.reopened',
    { propertyName: 'Riverside Hotel', platform: 'portal', guestRating: 2 },
    undefined,
    copy({
      title: 'Reopened: feedback at Riverside Hotel',
      body: 'This feedback needs another look. Open it to see where it stands.',
      actionLabel: 'View item',
      summary: 'Riverside Hotel · 2-star feedback · reopened',
    }),
  ],
  // Rows recorded before the fact carried an outcome, including replies that
  // may be live on Google.
  [
    'reply.publish_failed claims no cause and offers no retry when the outcome is unknown',
    'reply.publish_failed',
    {},
    undefined,
    copy({
      title: 'Reply not published',
      body: 'Open the reply to see where it stands.',
      actionLabel: 'View reply',
      summary: 'review · not published',
    }),
  ],
  [
    'renders calm, actionable account-access copy',
    'account.organization_access_granted',
    {},
    undefined,
    copy({
      title: 'Organization access added',
      body: 'Your account can now access this organization.',
      actionLabel: 'Review account',
      summary: 'organization access added',
      whyReceived: ACCESS_GRANTED_WHY,
    }),
  ],
  [
    'renders calm, actionable account-access copy',
    'account.organization_role_changed',
    {},
    undefined,
    copy({
      title: 'Organization role updated',
      body: 'Your account permissions for this organization were updated.',
      actionLabel: 'Review account',
      summary: 'organization role updated',
      whyReceived: ROLE_CHANGED_WHY,
    }),
  ],
  [
    'renders calm, actionable account-access copy',
    'account.organization_access_removed',
    {},
    undefined,
    copy({
      title: 'Organization access removed',
      body: ACCESS_REMOVED_BODY,
      detailMirrorsBody: true,
      actionLabel: 'Review account',
      summary: 'organization access removed',
      whyReceived:
        'You received this because your access to an organization on Reputation Key ended.',
    }),
  ],
  [
    'says which organization the member joined',
    'account.organization_access_granted',
    { organizationName: 'Riverside Group' },
    undefined,
    copy({
      title: 'You joined Riverside Group',
      body: 'Your account can now access this organization.',
      actionLabel: 'Review account',
      summary: 'Riverside Group · access added',
      whyReceived: ACCESS_GRANTED_WHY,
    }),
  ],
]

describe('renderNotification — exact copy', () => {
  it.each(EXACT_COPY)('%s', (_name, type, payload, options, expected) => {
    expect(renderNotification(type, payload, options)).toEqual(expected)
  })
})
