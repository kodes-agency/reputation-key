// Browser previews of the notification emails.
//
// The renderers return a complete HTML document, so the only faithful preview
// is a document: the story mounts the rendered HTML in a same-origin iframe via
// `srcDoc`. Rendering the fragment into a <div> instead would silently drop the
// <head>, and with it the dark-mode media query and the preheader — the two
// parts most likely to regress unnoticed.
import type { Meta, StoryObj } from '@storybook/react'
import { renderNotification } from '../../domain/notification-templates'
import type { NotificationPayload } from '../../domain/notification-payload'
import type { NotificationType } from '../../domain/types'
import { renderDigestEmail, renderNotificationEmail } from './render'

const ACTION_URL = 'https://app.reputationkey.app/inbox?itemId=itm-2f9c'
const PREFERENCES_URL = 'https://app.reputationkey.app/settings/notifications'

// The preview shell below — subject card, `srcDoc` iframe, plain-text
// disclosure — is duplicated in src/shared/email/transactional-email.stories.tsx.
// Both story sets need the same three panes, and the two copies are already
// tuned apart (780px frame for digests, the tallest document we render, against
// 680px for the short account emails).
//
// Sharing it would move Storybook-only JSX into src/shared/email, where the
// changed-code and coverage gates treat every module as product code and demand
// a colocated test — and a rendering shell can only be asserted through JSX,
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

const single = (
  type: NotificationType,
  payload: NotificationPayload,
  priority: 'urgent' | 'normal' = 'urgent',
) =>
  renderNotificationEmail({
    rendered: renderNotification(type, payload),
    actionUrl: ACTION_URL,
    preferencesUrl: PREFERENCES_URL,
    priority,
  })

const digestItem = (
  type: NotificationType,
  payload: NotificationPayload,
  id: string,
) => ({
  rendered: renderNotification(type, payload),
  actionUrl: `https://app.reputationkey.app/inbox?itemId=${id}`,
})

const meta: Meta<typeof EmailPreview> = {
  title: 'Email/Notification',
  component: EmailPreview,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen', theme: 'light' },
}

export default meta
type Story = StoryObj<typeof EmailPreview>

/** The reply-approval alert: pill, stars, waiting age, one CTA. */
export const UrgentReplyApproval: Story = {
  args: single('reply.pending_approval', {
    propertyName: 'Riverside Hotel',
    rating: 2,
    waitingHours: 3,
    actorRole: 'staff',
  }),
}

/** An SLA breach — the waiting age is the whole point of the email. */
export const UrgentEscalation: Story = {
  args: single('inbox.escalated', {
    propertyName: 'Harbour Lodge',
    rating: 1,
    waitingHours: 52,
  }),
}

/** Normal priority drops the attention pill; everything else is identical. */
export const NormalPriority: Story = {
  args: single(
    'reply.published',
    { propertyName: 'Riverside Hotel', rating: 5 },
    'normal',
  ),
}

/** Graceful degradation: an empty payload must still produce a usable email. */
export const NoMetadata: Story = {
  args: single('review.created', {}),
}

/** Coalesced rows carry a repeat marker rather than reading like a single event. */
export const CoalescedOccurrences: Story = {
  args: single('inbox.escalated', {
    propertyName: 'Riverside Hotel',
    rating: 2,
    waitingHours: 26,
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
          digestItem(
            'review.created',
            { propertyName: 'Riverside Hotel', rating: 5 },
            'a1',
          ),
          digestItem(
            'reply.pending_approval',
            {
              propertyName: 'Riverside Hotel',
              rating: 2,
              waitingHours: 9,
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
            { propertyName: 'Harbour Lodge', rating: 1, waitingHours: 30 },
            'b1',
          ),
          digestItem(
            'goal.completed',
            { propertyName: 'Harbour Lodge', goalName: 'Q3 rating lift' },
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
              rating: 4,
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
