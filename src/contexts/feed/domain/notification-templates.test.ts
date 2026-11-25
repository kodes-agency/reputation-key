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
import { notificationLink, renderNotification } from './notification-templates'
import { copy, type ExactCopyCase, SEAVIEW } from './notification-templates.test-fixtures'

describe('renderNotification — portal, property and integration notices', () => {
  it('renders a gentle portal responsibility recovery prompt that says where', () => {
    expect(
      renderNotification('portal.responsibility_needed', {
        propertyName: 'Riverside Hotel',
      }),
    ).toEqual({
      title: 'A portal at Riverside Hotel needs a responsible manager',
      body: 'Choose an eligible manager so portal updates reach the right people.',
      detail: '',
      actionLabel: 'Choose manager',
      summary: 'Riverside Hotel · responsible manager needed',
    })
    expect(renderNotification('portal.responsibility_needed', {}).title).toBe(
      'A portal needs a responsible manager',
    )
    expect(notificationLink('portal', 'portal-1', 'prop-1')).toEqual({
      path: '/properties/prop-1/portals/portal-1',
      // The responsible-managers card lives on the workspace's Page tab.
      search: { tab: 'page' },
    })
  })

  describe('a site waiting for approval', () => {
    const SITE_PORTAL = '61ed98fc-9cf8-44e9-b49d-cd25e744fd6c'
    const waiting = {
      propertyName: 'Riverside Hotel',
      siteHost: 'menu.example.com',
      portalName: 'Lobby',
      portalId: SITE_PORTAL,
    } as const

    it('names the site, the Portal to approve it in and the Property', () => {
      expect(renderNotification('portal.link_approval', waiting)).toEqual({
        title: 'A Linktree link at Riverside Hotel is waiting for approval',
        body: 'Guests will not see links to menu.example.com until an account admin approves it. Approve it in the Linktree of the Lobby portal.',
        detail:
          'Guests will not see links to menu.example.com until an account admin approves it. Approve it in the Linktree of the Lobby portal.',
        actionLabel: 'Review link',
        summary: 'Riverside Hotel · Linktree link waiting for approval',
      })
    })

    it('says how many other Portals open the same site', () => {
      const bodyFor = (otherPortalCount: number) =>
        renderNotification('portal.link_approval', { ...waiting, otherPortalCount }).body

      expect(bodyFor(2)).toContain('of the Lobby portal and 2 other portals.')
      expect(bodyFor(1)).toContain('of the Lobby portal and 1 other portal.')
      expect(bodyFor(0)).not.toContain('other')
    })

    it('shortens rather than guessing when the facts are missing', () => {
      expect(renderNotification('portal.link_approval', {})).toMatchObject({
        title: 'A Linktree link is waiting for approval',
        body: 'Guests will not see links to this site until an account admin approves it.',
      })
      expect(
        renderNotification('portal.link_approval', {
          siteHost: 'menu.example.com',
        }).body,
      ).toBe(
        'Guests will not see links to menu.example.com until an account admin approves it.',
      )
    })

    it('never says please, and speaks of an account admin in lower case', () => {
      const { title, body } = renderNotification('portal.link_approval', waiting)

      expect(`${title} ${body}`).not.toMatch(/please/i)
      expect(body).toContain('an account admin')
      expect(body).not.toMatch(/Account Admin|AccountAdmin/)
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
      detail: '',
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

  it('keeps the general wording when a connector left rather than Google refusing', () => {
    expect(
      renderNotification('integration.reauthorization_required', {
        reauthorizationCause: 'member_removed',
      }).title,
    ).toBe('Google connection needs attention')
  })

  it('follows the outcome for a publish failure with no named cause', () => {
    expect(
      renderNotification('reply.publish_failed', { publishOutcome: 'refused' }).body,
    ).toBe('Nothing was posted to Google. Check the Google connection, then try again.')
  })
})

// The two portal goal notices, as approved under P-8 (PROPOSAL §4.5; ADR
// 0046, amended 2026-10-17): whose goal, which month, and for a count the
// month's figure against its target. The Seaview fixtures are the deck's.
describe('renderNotification — portal goal notices', () => {
  const RECEPTION: NotificationPayload = {
    ...SEAVIEW,
    goalSubjectKind: 'portal',
    goalSubjectName: 'Reception',
    goalCount: 22,
    goalTargetCount: 20,
  }

  it.each([
    ['portal', 'Reception'],
    ['portal_group', 'Front desk'],
  ] as const)('a met portal goal names the portal (%s)', (goalSubjectKind, name) => {
    expect(
      renderNotification('goal.completed', {
        ...RECEPTION,
        goalSubjectKind,
        goalSubjectName: name,
      }),
    ).toMatchObject({
      title: `${name} met its November portal goal`,
      body: `${name} brought in 22 private ratings. The goal was 20.`,
      actionLabel: 'See the goal',
      // Email's facts line still says which Property the portal is at.
      summary: 'Seaview Hotel',
    })
  })

  it.each([
    [
      'not_met',
      39,
      'Seaview Hotel\u2019s November portal goal: no longer met',
      'A correction changed November to 39 of 40.',
    ],
    [
      'met',
      41,
      'Seaview Hotel\u2019s November portal goal: now met',
      'A correction changed November to 41 of 40.',
    ],
    [
      'unavailable',
      undefined,
      'Seaview Hotel\u2019s November portal goal: result unavailable',
      'A correction left November with no usable result.',
    ],
  ] as const)(
    'a correction says what the month changed to (%s)',
    (goalOutcome, goalCount, title, body) => {
      expect(
        renderNotification('goal.result_revised', { ...SEAVIEW, goalOutcome, goalCount }),
      ).toEqual({
        title,
        body,
        detail: body,
        actionLabel: 'See the goal',
        summary: 'Seaview Hotel',
      })
    },
  )

  it("a correction to a portal's goal names the portal", () => {
    expect(
      renderNotification('goal.result_revised', {
        ...RECEPTION,
        goalOutcome: 'not_met',
        goalCount: 19,
      }),
    ).toMatchObject({
      title: 'Reception\u2019s November portal goal: no longer met',
      body: 'A correction changed November to 19 of 20.',
    })
  })

  it('scans say scans', () => {
    const scans = { ...SEAVIEW, goalMeasure: 'qualified_scans' as const }
    expect(
      renderNotification('goal.completed', {
        ...scans,
        goalCount: 412,
        goalTargetCount: 400,
      }).body,
    ).toBe('Your portals brought in 412 scans. The goal was 400.')
    expect(
      renderNotification('goal.completed', { ...scans, goalCount: 1, goalTargetCount: 1 })
        .body,
    ).toBe('Your portals brought in 1 scan. The goal was 1.')
  })

  it('one private rating is singular', () => {
    expect(
      renderNotification('goal.completed', {
        ...RECEPTION,
        goalCount: 1,
        goalTargetCount: 1,
      }).body,
    ).toBe('Reception brought in 1 private rating. The goal was 1.')
    expect(
      renderNotification('goal.result_revised', {
        ...SEAVIEW,
        goalOutcome: 'not_met',
        goalCount: 0,
      }).body,
    ).toBe('A correction changed November to 0 of 40.')
  })

  it.each([
    ['an average', { goalMeasure: 'portal_rating_average' } as const],
    ['no measure', { goalMeasure: undefined }],
    ['no count', { goalCount: undefined }],
    ['no target', { goalTargetCount: undefined }],
  ])('an average or missing figures fall back to see the numbers (%s)', (_case, gap) => {
    const payload = { ...SEAVIEW, ...gap }
    // Same title; the body sends the reader to the goal, and the row under
    // the title has nothing to add.
    expect(renderNotification('goal.completed', payload)).toMatchObject({
      title: 'Seaview Hotel met its November portal goal',
      body: 'Open the goal to see the numbers.',
      detail: '',
    })
    expect(
      renderNotification('goal.result_revised', { ...payload, goalOutcome: 'met' }),
    ).toMatchObject({
      title: 'Seaview Hotel\u2019s November portal goal: now met',
      body: 'Open the goal to see the numbers.',
      detail: '',
    })
  })

  it('a portal goal whose portal has no name falls back to the goal', () => {
    expect(
      renderNotification('goal.completed', { ...RECEPTION, goalSubjectName: undefined }),
    ).toMatchObject({
      title: 'November portal goal met',
      body: 'Open the goal to see the numbers.',
    })
  })

  it.each([
    ['set_in_month', 'The goal was set during the month.'],
    ['target_changed', 'The target was changed during the month.'],
  ] as const)(
    'appends the %s marker unchanged, after the figures',
    (goalMarker, clause) => {
      const met = renderNotification('goal.completed', { ...SEAVIEW, goalMarker })
      expect(met.body).toBe(
        `Your portals brought in 41 private ratings. The goal was 40. ${clause}`,
      )
      // The marker sentence stays (P-8), in the row under the title too:
      // "met" against a goal set on the 20th would overstate it.
      expect(met.detail).toBe(met.body)
      const revised = renderNotification('goal.result_revised', {
        ...SEAVIEW,
        goalOutcome: 'not_met',
        goalCount: 39,
        goalMarker,
      })
      expect(revised.body).toBe(`A correction changed November to 39 of 40. ${clause}`)
      expect(revised.detail).toBe(revised.body)
    },
  )

  it.each([
    ['set_in_month', 'The goal was set during the month.'],
    ['target_changed', 'The target was changed during the month.'],
  ] as const)(
    'keeps the %s marker in the row when no figure is known',
    (goalMarker, clause) => {
      const gap = { goalMarker, goalSubjectKind: 'property' } as const
      // The body sends the reader to the goal; the row says only the marker.
      expect(renderNotification('goal.completed', gap)).toMatchObject({
        body: `${clause} Open the goal to see the numbers.`,
        detail: clause,
      })
      expect(
        renderNotification('goal.result_revised', { ...gap, goalOutcome: 'met' }),
      ).toMatchObject({
        body: `${clause} Open the goal to see the numbers.`,
        detail: clause,
      })
    },
  )

  it.each([
    ['no subject name or month', {}, 'Portal goal met', 'Portal goal result updated'],
    [
      'a name but no month',
      { propertyName: 'Seaview Hotel', goalSubjectKind: 'property' },
      'Seaview Hotel met its portal goal',
      'Seaview Hotel\u2019s portal goal: no longer met',
    ],
    [
      'a month but no name',
      { goalMonth: '2026-11', goalSubjectKind: 'property' },
      'November portal goal met',
      'November portal goal: no longer met',
    ],
  ] as const)('titles with %s', (_case, payload, completed, revised) => {
    expect(renderNotification('goal.completed', payload).title).toBe(completed)
    expect(
      renderNotification('goal.result_revised', { ...payload, goalOutcome: 'not_met' })
        .title,
    ).toBe(revised)
  })

  // The in-app row names the Property in its facts line and shows the title
  // without it. A Property goal's title then still says which month.
  it("the row's title without the Property keeps the month", () => {
    const withoutProperty = { ...SEAVIEW, propertyName: undefined }
    expect(renderNotification('goal.completed', withoutProperty).title).toBe(
      'November portal goal met',
    )
    expect(
      renderNotification('goal.result_revised', {
        ...withoutProperty,
        goalOutcome: 'not_met',
      }).title,
    ).toBe('November portal goal: no longer met')
  })

  it('never calls a portal goal a Google rating goal or a review', () => {
    for (const type of ['goal.completed', 'goal.result_revised'] as const) {
      for (const goalOutcome of ['met', 'not_met', 'unavailable'] as const) {
        const r = renderNotification(type, { ...SEAVIEW, goalOutcome })
        expect([r.title, r.body, r.summary].join(' ')).not.toMatch(
          /google|review|rating goal/i,
        )
      }
    }
  })
})

const RECONNECT_BODY =
  'Google needs reconnecting first. An account admin can reconnect it in Settings, then retry — the draft is saved.'
const RECONNECT_COPY = copy({
  title: 'Reply not published at Riverside Hotel',
  body: RECONNECT_BODY,
  detailMirrorsBody: true,
  actionLabel: 'Open reply',
  summary: 'Riverside Hotel · review · reconnect Google',
})
const GOOGLE_ENDED_BODY =
  'Google no longer accepts RepKey’s access, so review updates and replies are paused.'

const EXACT_COPY: ReadonlyArray<ExactCopyCase> = [
  // Google refused the grant for good: sync and replies have already stopped,
  // so the notice leads with the one action that restores them. The
  // connection is the Organization's, so its delivery Property is not named.
  [
    'asks admins to reconnect a Google grant that stopped working, and says why',
    'integration.reauthorization_required',
    { propertyName: 'Riverside Hotel', reauthorizationCause: 'provider_revoked' },
    undefined,
    copy({
      title: 'Reconnect Google',
      body: GOOGLE_ENDED_BODY,
      detailMirrorsBody: true,
      actionLabel: 'Reconnect Google',
      summary: 'Google access ended',
    }),
  ],
  // Retrying cannot publish the reply until Google is reconnected, and the
  // author may not be the one who can reconnect it.
  [
    'tells a reply author Google must be reconnected before a retry can publish',
    'reply.publish_failed',
    {
      propertyName: 'Riverside Hotel',
      publishFailureCause: 'google_reauthorization_required',
    },
    undefined,
    RECONNECT_COPY,
  ],
  // The outcome says what happened; the cause names the only remedy that works.
  [
    'names the reconnect remedy over the outcome when Google must be reconnected',
    'reply.publish_failed',
    {
      propertyName: 'Riverside Hotel',
      publishOutcome: 'refused',
      publishFailureCause: 'google_reauthorization_required',
    },
    undefined,
    RECONNECT_COPY,
  ],
  [
    'a met property goal names the property and its count',
    'goal.completed',
    SEAVIEW,
    undefined,
    copy({
      title: 'Seaview Hotel met its November portal goal',
      body: 'Your portals brought in 41 private ratings. The goal was 40.',
      detailMirrorsBody: true,
      actionLabel: 'See the goal',
      summary: 'Seaview Hotel',
    }),
  ],
  [
    'a correction that does not say which way it went is an update',
    'goal.result_revised',
    SEAVIEW,
    undefined,
    copy({
      title: 'Portal goal result updated',
      body: 'Open the goal to see the numbers.',
      actionLabel: 'See the goal',
      summary: 'Seaview Hotel',
    }),
  ],
]

describe('renderNotification — exact copy of portal, property and integration notices', () => {
  it.each(EXACT_COPY)('%s', (_name, type, payload, options, expected) => {
    expect(renderNotification(type, payload, options)).toEqual(expected)
  })
})
