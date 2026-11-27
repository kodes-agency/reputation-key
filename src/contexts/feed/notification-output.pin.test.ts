// Pins the email bytes of every notification type. For each type it renders the fullest
// payload variant (the one with the most fields present; see FULLEST below) in three time
// zone contexts and stores the immediate emails (urgent and mandatory) and the digest email
// as a subject plus a hash of the text and of the HTML, so one changed byte in any type's
// email fails this test. In-app wording is not pinned here: notification-templates.copy,
// .invariants and .test assert it. The exception is IN_APP_PINNED_TYPES, the types those
// suites do not assert; their in-app copy and repeat count stay in the pin. Links are pinned
// for every type and resource type except LINK_ASSERTED, the pairs another suite fails on
// when their link changes.
//
// An intended email change makes this fail on purpose. Regenerate the expected output with
//   PIN_WRITE=1 pnpm exec vitest run --project=unit src/contexts/feed/notification-output.pin.test.ts
// then format notification-output.pin.json with prettier, and review the diff before you commit.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderDigestEmail, renderNotificationEmail } from './email/render.server'
import {
  notificationLink,
  notificationReplyTo,
  notificationRepeatCount,
  renderNotification,
  type RenderedNotification,
} from './domain/notification-templates'
import { NOTIFICATION_TYPES, type NotificationType } from './domain/notification-types'
import type { NotificationPayload } from './domain/notification-payload'

const PIN_FILE = new URL('./notification-output.pin.json', import.meta.url)

const FULL: NotificationPayload = {
  propertyName: 'Riverside Hotel',
  organizationName: 'Riverside Group',
  guestRating: 2,
  platform: 'portal',
  waitingHours: 5,
  waitingSince: '2026-03-02T08:00:00.000Z',
  waitedHours: 30,
  actorRole: 'property_manager',
  moderationReason: 'Mentions a staff member',
  hasModerationReason: true,
  leftOrganization: true,
  memberRole: 'property_manager',
  lowRating: true,
  publishOutcome: 'refused',
  goalName: 'Respond within a day',
  occurrences: 3,
  itemCount: 4,
  reportOutcome: 'resolved',
  reauthorizationCause: 'provider_revoked',
  publishFailureCause: 'google_reauthorization_required',
  publicationCancellationCause: 'policy',
  reopenReason: 'new_information',
  portalHealthStatus: 'degraded',
  portalHealthReason: 'public_address_unavailable',
  targetDueAt: '2026-03-03T17:30:00.000Z',
  goalMonth: '2026-02',
  goalSubjectKind: 'portal',
  goalOutcome: 'met',
  goalMarker: 'set_in_month',
  goalMeasure: 'qualified_scans',
  goalCount: 120,
  goalTargetCount: 100,
  goalSubjectName: 'Lobby poster',
  importOutcome: 'failed',
  importedCount: 812,
  unansweredCount: 63,
  importFailureReason: 'temporary',
  ratingShownTenths: 45,
  ratingPreviousTenths: 44,
  ratingTargetTenths: 47,
  ratingGoalMode: 'climb',
  ratingPacePerWeek: 3,
  ratingPaceTenthsPerWeek: 35,
  ratingRecentPaceTenths: 12,
  ratingPaceWindow: 'last_4_weeks',
  siteHost: 'example.com',
  portalName: 'Lobby poster',
  portalId: '5b0c2e0e-6a1d-4f4e-9d52-2d9c8f6a1b11',
  otherPortalCount: 2,
  guestVoiceKind: 'weekly',
  guestVoiceWindow: '90d',
  guestVoiceLines: [
    {
      kind: 'fix_first',
      topic: 'speed_waiting',
      reviewCount: 19,
      textReviewCount: 128,
      upToHundredths: 20,
    },
    { kind: 'protect', topic: 'staff_service', reviewCount: 40, textReviewCount: 128 },
    {
      kind: 'change',
      topic: 'cleanliness',
      reviewCount: 9,
      textReviewCount: 128,
      change: 'rising',
      polarity: 'praise',
    },
  ],
}

const OMITTABLE = Object.keys(FULL) as (keyof NotificationPayload)[]

const withoutKey = (key: keyof NotificationPayload): NotificationPayload => {
  const { [key]: _dropped, ...rest } = FULL
  return rest
}

const CANDIDATES: ReadonlyArray<readonly [string, NotificationPayload]> = [
  ['empty', {}],
  ['full', FULL],
  ...OMITTABLE.map((key) => [`full-without-${key}`, withoutKey(key)] as const),
]

const presentFields = (payload: NotificationPayload): number =>
  Object.values(payload).filter((value) => value !== undefined).length

/**
 * The pinned variant: the candidate with the most payload fields present. A tie goes to
 * the one listed first, so the choice depends on the list, never on chance.
 */
const [FULLEST_NAME, FULLEST] = CANDIDATES.reduce((best, candidate) =>
  presentFields(candidate[1]) > presentFields(best[1]) ? candidate : best,
)

/**
 * Types whose in-app title and body no hand-written suite (copy, invariants, templates)
 * asserts: a probe that altered each type's rendered title or body failed none of them
 * for these. They keep their in-app words and links in the pin until a suite covers them.
 */
const IN_APP_PINNED_TYPES: ReadonlyArray<NotificationType> = [
  'review.ai_urgent_detected',
  'reply.approved',
  'reply.rejected',
  'reply.published',
  'reply.publication_cancelled',
  'inbox.response_target_passed',
  'inbox.assigned',
  'inbox.assignments_released',
  'inbox.unassigned',
  'inbox.bulk_unassigned',
  'inbox_note.added',
  'property.review_import_finished',
  'integration.google_disconnected',
  'goal.rating_reached',
  'goal.rating_changed',
  'goal.rating_below_pace',
  'goal.rating_too_low',
  'goal.rating_keep_dropped',
  'beta_feedback.outcome',
  'guest_voice.summary',
]

const CONTEXTS = [
  ['default', undefined],
  ['Europe/Sofia', { timeZone: 'Europe/Sofia' }],
  ['America/New_York', { timeZone: 'America/New_York' }],
] as const

const RESOURCE_TYPES = [
  'organization',
  'inbox_item',
  'reply',
  'goal',
  'portal',
  'portal_destination',
  'property',
  'integration',
  'beta_feedback_report',
] as const

const ACTION_URL = 'https://app.example.test/inbox?itemId=abc'
const PREFERENCES_URL = 'https://app.example.test/settings/notifications'

const sha = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16)

/** Subject in the clear, text and HTML as hashes: one changed byte changes the hash. */
const emailBytes = (email: { subject: string; text: string; html: string }) => ({
  subject: email.subject,
  text: sha(email.text),
  html: sha(email.html),
})

const emailsFor = (rendered: RenderedNotification) => {
  const immediate = (priority: 'urgent' | 'normal', preferencesUrl: string | null) =>
    emailBytes(
      renderNotificationEmail({
        rendered,
        actionUrl: ACTION_URL,
        preferencesUrl,
        priority,
      }),
    )
  return {
    urgent: immediate('urgent', PREFERENCES_URL),
    mandatory: immediate('normal', null),
    digest: emailBytes(
      renderDigestEmail({
        recipientName: 'Sam',
        dateLabel: 'Tue 3 Mar',
        preferencesUrl: PREFERENCES_URL,
        groups: [
          {
            propertyName: 'Riverside Hotel',
            items: [{ rendered, actionUrl: ACTION_URL }],
          },
        ],
      }),
    ),
  }
}

/**
 * Type and resource type pairs whose link another suite asserts: a probe that altered
 * the path, or the search, of each pair's link failed one of those suites. Every other
 * pair keeps its link in the pin.
 */
const LINK_ASSERTED: ReadonlyArray<string> = [
  'account.invitation_accepted:organization',
  'account.organization_access_removed:organization',
  'account.organization_property_access_changed:organization',
  'goal.completed:goal',
  'goal.rating_below_pace:goal',
  'goal.rating_changed:goal',
  'goal.rating_keep_dropped:goal',
  'goal.rating_reached:goal',
  'goal.rating_too_low:goal',
  'inbox.assigned:inbox_item',
  'inbox.bulk_assigned:inbox_item',
  'inbox.bulk_reopened:inbox_item',
  'inbox.bulk_unassigned:inbox_item',
  'inbox.reopened:inbox_item',
  'integration.google_disconnected:integration',
  'portal.link_approval:portal_destination',
  'property.review_import_finished:property',
  'review.created:inbox_item',
]

const linksFor = (type: NotificationType) =>
  Object.fromEntries(
    RESOURCE_TYPES.filter(
      (resourceType) => !LINK_ASSERTED.includes(`${type}:${resourceType}`),
    ).flatMap((resourceType) =>
      [null, 'prop-1'].map((propertyId) => {
        const { path, search } = notificationLink(
          resourceType,
          'res-1',
          propertyId,
          type,
          FULLEST,
        )
        return [`${resourceType}/${propertyId}`, `${path} ${JSON.stringify(search)}`]
      }),
    ),
  )

const inAppFor = (type: NotificationType) => ({
  rendered: Object.fromEntries(
    CONTEXTS.map(([label, context]) => [
      label,
      renderNotification(type, FULLEST, context),
    ]),
  ),
  repeat: notificationRepeatCount(type, FULLEST),
})

/** What one type pins: the email bytes of its fullest variant, its unasserted links, and in-app words where no suite asserts them. */
const pinFor = (type: NotificationType) => ({
  replyTo: notificationReplyTo(type),
  variant: FULLEST_NAME,
  email: Object.fromEntries(
    CONTEXTS.map(([label, context]) => [
      label,
      emailsFor(renderNotification(type, FULLEST, context)),
    ]),
  ),
  links: linksFor(type),
  ...(IN_APP_PINNED_TYPES.includes(type) ? { inApp: inAppFor(type) } : {}),
})

const collect = () =>
  Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, pinFor(type)]))

describe('notification output pin', () => {
  const current = JSON.parse(JSON.stringify(collect())) as Record<string, unknown>

  if (process.env.PIN_WRITE === '1') {
    it('writes the pin', () => {
      writeFileSync(PIN_FILE, `${JSON.stringify(current)}\n`)
    })
    return
  }

  const pinned = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Record<string, unknown>

  it('covers every notification type', () => {
    expect(Object.keys(pinned).sort()).toEqual([...NOTIFICATION_TYPES].sort())
  })

  it('pins the candidate with the most payload fields present', () => {
    expect(FULLEST_NAME).toBe('full')
  })

  it.each(NOTIFICATION_TYPES)(
    '%s sends the same email bytes in every channel',
    (type) => {
      expect(current[type]).toEqual(pinned[type])
    },
  )
})
