// Browser previews of the notification emails.
//
// The renderers return a complete HTML document, so the only faithful preview
// is a document: the story mounts the rendered HTML in a same-origin iframe via
// `srcDoc`. Rendering the fragment into a <div> instead would silently drop the
// <head>, and with it the dark-mode media query and the preheader — the two
// parts most likely to regress unnoticed.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { renderNotification } from '../../domain/notification-templates'
import type { NotificationPayload } from '../../domain/notification-payload'
import type { NotificationType } from '../../domain/notification-types'
import { splitFacts } from './notification-facts'
import { renderDigestEmail, renderNotificationEmail } from './render'

const ACTION_URL = 'https://app.reputationkey.app/inbox?itemId=itm-2f9c'
const PREFERENCES_URL = 'https://app.reputationkey.app/settings/notifications'

// Payloads below are as the email jobs read them: a wait is `waitedHours`, how
// long the item had waited when its notice was raised, projected by the read.

// The preview shell below — subject card, `srcDoc` iframe, plain-text
// disclosure — is duplicated in src/shared/email/transactional-email.stories.tsx.
// Both story sets need the same three panes, and the two copies are already
// tuned apart (780px frame for digests, the tallest document we render, against
// 680px for the short account emails).
//
// Sharing it would move Storybook-only JSX into src/shared/email, where the
// changed-code gate treats every module as product code and demands a test
// that imports it — and a rendering shell can only be asserted through JSX,
// which the unit project (node, *.test.ts only) cannot run. A hole in a shared
// gate is a worse trade than duplicated preview chrome: this markup cannot
// change a delivered email, only how two story pages look.
//
// Revisit if a third surface needs the same preview, or if the shell grows
// behaviour rather than markup — then it earns a Storybook-only home.
// fallow-ignore-next-line code-duplication
type PreviewProps = Readonly<{ subject: string; html: string; text: string }>

const EmailPreview = ({ subject, html, text }: PreviewProps) => (
  <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Subject ({subject.length} chars)
      </p>
      <p className="text-sm text-foreground">{subject}</p>
    </div>
    <iframe
      title={`Email preview: ${subject}`}
      srcDoc={html}
      className="h-[780px] w-full rounded-xl border border-border"
    />
    <details className="rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Plain-text part
      </summary>
      <pre className="mt-3 text-xs whitespace-pre-wrap text-foreground">{text}</pre>
    </details>
  </div>
)

/**
 * The recipient's zone, as the urgent-email job passes it: the one fact the
 * copy renders on the reader's clock rather than the server's.
 */
const RECIPIENT_ZONE = { timeZone: 'America/New_York' } as const

const single = (
  type: NotificationType,
  payload: NotificationPayload,
  priority: 'urgent' | 'normal' = 'urgent',
) =>
  renderNotificationEmail({
    rendered: renderNotification(type, payload, RECIPIENT_ZONE),
    actionUrl: ACTION_URL,
    preferencesUrl: PREFERENCES_URL,
    priority,
  })

/**
 * A line under its Property's heading. Like the digest job, it leaves the
 * group's Property out of the line's facts: the heading and title name it.
 */
const digestItem = (type: NotificationType, payload: NotificationPayload, id: string) => {
  const rendered = renderNotification(type, payload, RECIPIENT_ZONE)
  return {
    rendered: {
      ...rendered,
      summary: splitFacts(rendered.summary)
        .filter((fact) => fact !== payload.propertyName)
        .join(' · '),
    },
    actionUrl: `https://app.reputationkey.app/inbox?itemId=${id}`,
  }
}

const meta: Meta<typeof EmailPreview> = {
  title: 'Email/Notification',
  component: EmailPreview,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen', theme: 'light' },
}

export default meta
type Story = StoryObj<typeof EmailPreview>

/** The reply-approval alert: pill, waiting age, one CTA. */
export const UrgentReplyApproval: Story = {
  args: single('reply.pending_approval', {
    propertyName: 'Riverside Hotel',
    waitedHours: 3,
    actorRole: 'staff',
  }),
}

/**
 * A manual escalation: who asked for attention and how long the guest has
 * waited, never a reason the escalation does not record.
 */
export const UrgentEscalation: Story = {
  args: single('inbox.escalated', {
    propertyName: 'Harbour Lodge',
    guestRating: 1,
    platform: 'portal',
    waitedHours: 52,
    actorRole: 'property_manager',
  }),
}

/** Normal priority drops the attention pill; everything else is identical. */
export const NormalPriority: Story = {
  args: single('reply.published', { propertyName: 'Riverside Hotel' }, 'normal'),
}

/**
 * A Response Target reminder says by when, on the RECIPIENT's clock — the zone
 * the job already resolved for quiet hours. The product's term is "target
 * time"; no notice says "due".
 */
export const ResponseTargetReminder: Story = {
  args: single(
    'inbox.response_target_passed',
    {
      propertyName: 'Riverside Hotel',
      waitedHours: 50,
      targetDueAt: '2026-09-29T12:00:00.000Z',
    },
    'normal',
  ),
}

/** A portal guests cannot reach at all, and the one thing to check. */
export const PortalOffline: Story = {
  args: single('portal.health_attention', {
    propertyName: 'Harbour Lodge',
    portalHealthStatus: 'unavailable',
    portalHealthReason: 'publication_snapshot_unavailable',
  }),
}

/** Graceful degradation: an empty payload must still produce a usable email. */
export const NoMetadata: Story = {
  args: single('review.created', {}),
}

/** Coalesced rows carry a repeat marker rather than reading like a single event. */
export const CoalescedOccurrences: Story = {
  args: single('inbox.escalated', {
    propertyName: 'Riverside Hotel',
    guestRating: 2,
    platform: 'portal',
    waitedHours: 26,
    occurrences: 4,
  }),
}

/** The daily digest: grouped by property, one deep link per row. */
export const Digest: Story = {
  args: renderDigestEmail({
    recipientName: 'Ada',
    dateLabel: 'Thursday, 21 August',
    groups: [
      {
        propertyName: 'Riverside Hotel',
        items: [
          digestItem('review.created', { propertyName: 'Riverside Hotel' }, 'a1'),
          digestItem(
            'reply.pending_approval',
            {
              propertyName: 'Riverside Hotel',
              waitedHours: 9,
              actorRole: 'staff',
            },
            'a2',
          ),
        ],
      },
      {
        propertyName: 'Harbour Lodge',
        items: [
          digestItem(
            'inbox.escalated',
            {
              propertyName: 'Harbour Lodge',
              guestRating: 1,
              platform: 'portal',
              waitedHours: 30,
            },
            'b1',
          ),
          // A goal on one portal names the portal; its count is the line.
          digestItem(
            'goal.completed',
            {
              propertyName: 'Harbour Lodge',
              goalName: 'Reception ratings',
              goalMonth: '2026-10',
              goalSubjectKind: 'portal',
              goalSubjectName: 'Reception',
              goalOutcome: 'met',
              goalMeasure: 'portal_rating_count',
              goalCount: 22,
              goalTargetCount: 20,
            },
            'b2',
          ),
        ],
      },
    ],
    preferencesUrl: PREFERENCES_URL,
  }),
}

/** One property, one item — the subject names the property instead of a count. */
export const DigestSingleProperty: Story = {
  args: renderDigestEmail({
    recipientName: null,
    dateLabel: 'Thursday, 21 August',
    groups: [
      {
        propertyName: 'Riverside Hotel',
        items: [
          digestItem(
            'inbox_note.added',
            {
              propertyName: 'Riverside Hotel',
              guestRating: 4,
              platform: 'portal',
              actorRole: 'property_manager',
            },
            'c1',
          ),
        ],
      },
    ],
    preferencesUrl: PREFERENCES_URL,
  }),
}

/** Seaview's November portal goal, as the deck's notices state it (P-8). */
const SEAVIEW_GOAL: NotificationPayload = {
  propertyName: 'Seaview Hotel',
  goalName: 'Monthly portal goal',
  goalMonth: '2026-11',
  goalSubjectKind: 'property',
  goalMeasure: 'portal_rating_count',
  goalCount: 41,
  goalTargetCount: 40,
}

/** A portal goal notice in the one email it is sent in: the daily digest. */
const goalDigest = (type: NotificationType, payload: NotificationPayload) =>
  renderDigestEmail({
    recipientName: 'Elena',
    dateLabel: 'Tuesday, 1 December',
    groups: [
      {
        propertyName: 'Seaview Hotel',
        items: [digestItem(type, payload, 'g1')],
      },
    ],
    preferencesUrl: PREFERENCES_URL,
  })

/** Asserts the digest line states the notice's title and its body (N-1, N-3). */
const goalLineSays =
  (title: string, body: string): Story['play'] =>
  async ({ canvasElement, args }) => {
    const text = within(canvasElement).getByText(/Plain-text part/).parentElement
    expect(text).toHaveTextContent(title)
    expect(text).toHaveTextContent(body)
    // The HTML part carries the same title; neither title has an ASCII quote
    // for React to escape.
    expect(args.html).toContain(title)
  }

/**
 * Goal email is daily only (ADR 0046, amended 2026-09-22), so a met portal
 * goal reaches its reader as a digest line: the title, then the month's count
 * against its target, under the Property's heading (deck N-1).
 */
export const PortalGoalMet: Story = {
  args: goalDigest('goal.completed', { ...SEAVIEW_GOAL, goalOutcome: 'met' }),
  play: goalLineSays(
    'Seaview Hotel met its November portal goal',
    'Your portals brought in 41 private ratings. The goal was 40.',
  ),
}

/** A correction took the month below its target (deck N-3). */
export const PortalGoalNoLongerMet: Story = {
  args: goalDigest('goal.result_revised', {
    ...SEAVIEW_GOAL,
    goalOutcome: 'not_met',
    goalCount: 39,
  }),
  play: goalLineSays(
    'Seaview Hotel\u2019s November portal goal: no longer met',
    'A correction changed November to 39 of 40.',
  ),
}

/**
 * The Urgent alert (v3 contract decision 10): "An urgent review needs you" at the Property,
 * the attention pill and one button. No reason, topic, rating or review text — the reason is
 * read in the app, where the button goes (ADR 0046 r.8).
 */
export const UrgentReview: Story = {
  args: single('review.ai_urgent_detected', {
    propertyName: 'Harbour Lodge',
    platform: 'google',
    waitedHours: 2,
  }),
  play: async ({ args }) => {
    expect(args.subject).toBe('An urgent review needs you at Harbour Lodge')
    expect(args.html).toContain('Needs attention')
    expect(args.html).toContain('Open review')
    expect(args.text).not.toMatch(/safety|health|discriminat|legal|star|rating/i)
    expect(args.html).not.toMatch(/safety|health|discriminat|legal threat|stars?\b/i)
  },
}

export const UrgentReviewPhone: Story = {
  ...UrgentReview,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

const SUMMARY_LINES = [
  {
    kind: 'fix_first',
    topic: 'facilities_equipment',
    reviewCount: 19,
    textReviewCount: 128,
    upToHundredths: 20,
  },
  { kind: 'protect', topic: 'staff_service', reviewCount: 61, textReviewCount: 128 },
  {
    kind: 'change',
    topic: 'cleanliness',
    reviewCount: 12,
    textReviewCount: 128,
    change: 'rising',
    polarity: 'complaint',
  },
] as const

/**
 * The Monday email (v3 contract decision 11): the page's three lines as paragraphs, one
 * button into Guest voice, the footer pointing at the preference that turned it on. Topics
 * and counts only: no cause, quote, person or review.
 */
export const GuestVoiceMonday: Story = {
  args: single(
    'guest_voice.summary',
    {
      propertyName: 'Harbour Lodge',
      guestVoiceKind: 'weekly',
      guestVoiceWindow: '90d',
      guestVoiceLines: SUMMARY_LINES,
    },
    'normal',
  ),
  play: async ({ args }) => {
    expect(args.subject).toBe('Your Guest voice this week at Harbour Lodge')
    expect(args.html).not.toContain('Needs attention')
    expect(args.html).toContain('Open Guest voice')
    for (const line of [
      'Fix first: Facilities and equipment, in 19 of 128 reviews, worth up to about 0.2★ on your 90-day average.',
      'Guests love: Staff and service, in 61 of 128 reviews.',
      'Cleanliness complaints are rising.',
    ]) {
      expect(args.html).toContain(line)
      expect(args.text).toContain(line)
    }
  },
}

export const GuestVoiceMondayPhone: Story = {
  ...GuestVoiceMonday,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

/** The first Monday of the month: the roundup, even when the page has nothing to name. */
export const GuestVoiceMonthlyRoundup: Story = {
  args: single(
    'guest_voice.summary',
    {
      propertyName: 'Harbour Lodge',
      guestVoiceKind: 'monthly',
      guestVoiceWindow: '30d',
      guestVoiceLines: [],
    },
    'normal',
  ),
  play: async ({ args }) => {
    expect(args.subject).toBe('Your Guest voice this month at Harbour Lodge')
    expect(args.html).toContain('Nothing stands out. Open it for every topic.')
  },
}
