// Contract tests for the notification email renderers.
//
// These pin the two things the email jobs depend on (subject shape and the
// `{ subject, html, text }` twin) and the one thing governance depends on: that
// nothing beyond a `RenderedNotification` can reach the wire.
import { describe, expect, it } from 'vitest'
import { renderNotification } from '../../domain/notification-templates'
import type { RenderedNotification } from '../../domain/notification-templates'
import { splitFacts, toPlainFacts } from './notification-facts'
import { renderDigestEmail, renderNotificationEmail } from './render'
import type { DigestEmailGroup } from './digest-email'

const ACTION_URL = 'https://app.test/inbox?itemId=itm-1'
const PREFERENCES_URL = 'https://app.test/settings/notifications'

const urgent = (rendered: RenderedNotification) =>
  renderNotificationEmail({
    rendered,
    actionUrl: ACTION_URL,
    preferencesUrl: PREFERENCES_URL,
    priority: 'urgent',
  })

const pendingApproval = renderNotification('reply.pending_approval', {
  propertyName: 'Riverside Hotel',
  rating: 2,
  waitingHours: 3,
  actorRole: 'staff',
})

const digestGroup = (
  propertyName: string,
  ids: ReadonlyArray<string>,
): DigestEmailGroup => ({
  propertyName,
  items: ids.map((id) => ({
    rendered: renderNotification('review.created', { propertyName, rating: 4 }),
    actionUrl: `https://app.test/inbox?itemId=${id}`,
  })),
})

describe('renderNotificationEmail — subject', () => {
  it('is the rendered title: the action and the property, nothing else', () => {
    expect(urgent(pendingApproval).subject).toBe('Approve a reply at Riverside Hotel')
  })

  it('never exceeds 60 characters and clips on a word boundary', () => {
    const long = renderNotification('reply.pending_approval', {
      propertyName: 'The Grand Riverside Metropolitan Hotel and Conference Centre',
    })
    const { subject } = urgent(long)
    expect(subject.length).toBeLessThanOrEqual(60)
    expect(subject.endsWith('…')).toBe(true)
    expect(subject).not.toMatch(/ …$/)
  })
})

describe('renderNotificationEmail — parts', () => {
  const email = urgent(pendingApproval)

  it('puts the CTA href in BOTH the html and the text', () => {
    expect(email.html).toContain(`href="${ACTION_URL}"`)
    expect(email.text).toContain(`${pendingApproval.actionLabel}: ${ACTION_URL}`)
  })

  it('puts the preferences URL in BOTH parts', () => {
    expect(email.html).toContain(`href="${PREFERENCES_URL}"`)
    expect(email.html).toContain('Manage notification preferences')
    expect(email.text).toContain(`Manage notification preferences: ${PREFERENCES_URL}`)
  })

  it('emits the summary as the preheader', () => {
    expect(email.html).toContain('data-skip-in-text="true"')
    expect(email.html).toContain('Riverside Hotel · 2-star review · waiting 3h')
  })

  it('marks urgency with a pill rather than a red banner', () => {
    expect(email.html).toContain('Needs attention')
    expect(email.html).not.toContain('#D45346')
  })

  it('omits the pill for normal-priority mail', () => {
    const normal = renderNotificationEmail({
      rendered: pendingApproval,
      actionUrl: ACTION_URL,
      preferencesUrl: PREFERENCES_URL,
      priority: 'normal',
    })
    expect(normal.html).not.toContain('Needs attention')
  })

  it('never emits the literal two-character sequence \\n', () => {
    expect(email.html).not.toContain('\\n')
    expect(email.text).not.toContain('\\n')
  })
})

describe('renderNotificationEmail — star rating', () => {
  const email = urgent(pendingApproval)

  it('draws glyphs as aria-hidden decoration beside the wording', () => {
    expect(email.html).toContain('★★☆☆☆')
    expect(email.html).toContain('aria-hidden="true"')
    expect(email.html).toContain('2-star review')
  })

  it('gives the plain-text twin the numeric equivalent, not glyphs', () => {
    expect(email.text).toContain('2/5 review')
    expect(email.text).not.toContain('★')
  })
})

describe('renderNotificationEmail — degradation', () => {
  const bare = renderNotification('review.created', {})
  const email = urgent(bare)

  it('still produces a titled, actionable email with no metadata at all', () => {
    expect(email.subject).toBe('New review')
    expect(email.html).toContain('New review')
    expect(email.html).toContain('Read review')
    expect(email.text).toContain(`Read review: ${ACTION_URL}`)
  })

  it('leaks no placeholder text and no orphan separator', () => {
    expect(email.html).not.toContain('undefined')
    expect(email.text).not.toContain('undefined')
    expect(email.text).not.toMatch(/(^|\n)\s*·/)
  })
})

describe('renderNotificationEmail — escaping', () => {
  it('escapes markup arriving through a property name', () => {
    const hostile = renderNotification('review.created', {
      propertyName: '<script>alert(1)</script>',
    })
    const email = urgent(hostile)
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('renderNotificationEmail — ADR 0046 r.8 content boundary', () => {
  // Google-sourced content has no route into this renderer: the input is a
  // RenderedNotification, which the domain builds from governed payload fields
  // only. This test is the regression fence for anyone widening that input.
  const FORBIDDEN = [
    'The room smelled of smoke and the shower was cold',
    'Jane Q. Guest',
    'https://lh3.googleusercontent.com/review-photo.jpg',
    'sentiment',
  ] as const

  it('emits none of review text, reviewer identity, media URLs or derived scores', () => {
    const email = urgent(pendingApproval)
    for (const marker of FORBIDDEN) {
      expect(email.html).not.toContain(marker)
      expect(email.text).not.toContain(marker)
    }
  })

  it('carries only the facts the domain summary already published', () => {
    const email = urgent(pendingApproval)
    for (const fact of splitFacts(pendingApproval.summary)) {
      expect(email.html).toContain(fact)
    }
  })
})

describe('renderDigestEmail', () => {
  const groups = [
    digestGroup('Riverside Hotel', ['a', 'b']),
    digestGroup('Harbour Lodge', ['c', 'd']),
  ]
  const email = renderDigestEmail({
    recipientName: 'Ada',
    dateLabel: 'Thursday, 21 August',
    groups,
    preferencesUrl: PREFERENCES_URL,
  })

  it('puts a count and a date in the subject, under 60 characters', () => {
    expect(email.subject).toBe('4 updates across 2 properties — Thursday, 21 August')
    expect(email.subject.length).toBeLessThanOrEqual(60)
  })

  it('names the property when there is only one', () => {
    const single = renderDigestEmail({
      recipientName: null,
      dateLabel: '21 Aug',
      groups: [digestGroup('Riverside Hotel', ['a'])],
      preferencesUrl: PREFERENCES_URL,
    })
    expect(single.subject).toBe('1 update at Riverside Hotel — 21 Aug')
    expect(single.text.startsWith('Hi there,')).toBe(true)
  })

  it('renders one row per item — 2 properties x 2 items = 4 rows', () => {
    expect(email.html.match(/<h3\b/g)).toHaveLength(4)
    expect(email.html.match(/<h2\b/g)).toHaveLength(3) // 2 property groups + the footer heading
  })

  it('gives every row its own deep link, in both parts', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      const url = `https://app.test/inbox?itemId=${id}`
      expect(email.html).toContain(`href="${url}"`)
      expect(email.text).toContain(url)
    }
  })

  it('never emits the literal two-character sequence \\n — the old digest joiner', () => {
    expect(email.html).not.toContain('\\n')
    expect(email.text).not.toContain('\\n')
    expect(email.text.split('\n').length).toBeGreaterThan(10)
  })

  it('derives the inbox button from the preferences origin', () => {
    expect(email.html).toContain('href="https://app.test/inbox"')
    expect(email.text).toContain('Open inbox: https://app.test/inbox')
  })

  it('puts the preferences URL in both parts', () => {
    expect(email.html).toContain(`href="${PREFERENCES_URL}"`)
    expect(email.text).toContain(`Manage notification preferences: ${PREFERENCES_URL}`)
  })

  it('greets the recipient and emits the headline as the preheader', () => {
    expect(email.html).toContain('Hi Ada,')
    expect(email.html).toContain('data-skip-in-text="true"')
    expect(email.html).toContain('4 updates across 2 properties — Thursday, 21 August')
  })

  it('degrades to a coherent email when there is nothing to report', () => {
    const empty = renderDigestEmail({
      recipientName: null,
      dateLabel: '21 Aug',
      groups: [],
      preferencesUrl: PREFERENCES_URL,
    })
    expect(empty.subject).toBe('No new updates — 21 Aug')
    expect(empty.html).not.toContain('undefined')
    expect(empty.text).not.toContain('undefined')
  })
})

describe('toPlainFacts', () => {
  it('rewrites the rating token and leaves everything else alone', () => {
    expect(toPlainFacts('Riverside Hotel · 2-star review · waiting 3h')).toBe(
      'Riverside Hotel · 2/5 review · waiting 3h',
    )
    expect(toPlainFacts('Harbour Lodge · Q3 rating lift')).toBe(
      'Harbour Lodge · Q3 rating lift',
    )
  })

  it('splits a summary back into its facts and drops the empties', () => {
    expect(splitFacts('Riverside Hotel · 2-star review')).toEqual([
      'Riverside Hotel',
      '2-star review',
    ])
    expect(splitFacts('')).toEqual([])
  })
})
