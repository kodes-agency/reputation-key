// Pins every word a notification says in each channel: for every type, the in-app
// title/body/detail/facts, the link, the repeat count, the immediate email (subject, text and
// a digest of its text and HTML) and the digest email. The expected output lives in
// notification-output.pin.json and was produced by the code before the payload and copy
// modules were restructured; set PIN_WRITE=1 only to regenerate it on purpose.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderDigestEmail, renderNotificationEmail } from './email/render.server'
import {
  notificationLink,
  notificationReplyTo,
  notificationRepeatCount,
  renderNotification,
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

const ENUM_VALUES: Readonly<Record<string, readonly unknown[]>> = {
  platform: ['google', 'portal'],
  guestRating: [1, 2, 3, 4, 5],
  actorRole: ['account_admin', 'property_manager', 'staff'],
  memberRole: ['account_admin', 'property_manager'],
  publishOutcome: ['not_sent', 'refused', 'unconfirmed'],
  reportOutcome: ['accepted', 'declined', 'resolved'],
  reauthorizationCause: ['provider_revoked', 'member_removed', 'account_admin_role_lost'],
  publishFailureCause: ['google_reauthorization_required'],
  publicationCancellationCause: [
    'disconnect',
    'policy',
    'source_changed',
    'provider_truth',
    'ai_draft_withdrawn',
  ],
  reopenReason: [
    'guest_follow_up_still_needed',
    'internal_follow_up_still_needed',
    'new_information',
    'correcting_handling_status',
    'other',
    'provider_reply_deleted',
    'provider_reply_diverged',
    'material_revision_changed',
  ],
  portalHealthStatus: ['degraded', 'unavailable'],
  portalHealthReason: [
    'publication_snapshot_unavailable',
    'public_address_unavailable',
    'google_destination_unavailable',
  ],
  goalSubjectKind: ['property', 'portal_group', 'portal'],
  goalOutcome: ['met', 'not_met', 'unavailable'],
  goalMarker: ['set_in_month', 'target_changed'],
  goalMeasure: ['qualified_scans', 'portal_rating_count', 'portal_rating_average'],
  importOutcome: ['completed', 'failed'],
  importFailureReason: [
    'google_authorization',
    'property_source_changed',
    'location_too_large',
    'temporary',
  ],
  ratingGoalMode: ['climb', 'keep'],
  ratingPaceWindow: ['last_4_weeks', 'since_set', 'since_pace_change'],
  guestVoiceKind: ['weekly', 'monthly'],
  guestVoiceWindow: ['30d', '90d', '180d', '365d'],
  occurrences: [1, 2, 7],
  itemCount: [1, 5],
  waitedHours: [0, 1, 23, 24, 49],
  leftOrganization: [true, false],
  hasModerationReason: [true, false],
  lowRating: [true],
  otherPortalCount: [0, 1, 4],
  ratingPaceTenthsPerWeek: [10, 35],
  ratingPacePerWeek: [1, 3],
}

const OMITTABLE = Object.keys(FULL) as (keyof NotificationPayload)[]

const withoutKey = (key: keyof NotificationPayload): NotificationPayload => {
  const { [key]: _dropped, ...rest } = FULL
  return rest
}

const variants = (): ReadonlyArray<readonly [string, NotificationPayload]> => [
  ['empty', {}],
  ['full', FULL],
  ...OMITTABLE.map((key) => [`full-without-${key}`, withoutKey(key)] as const),
  ...Object.entries(ENUM_VALUES).flatMap(([key, values]) =>
    values.flatMap((value) => [
      [`full-${key}=${String(value)}`, { ...FULL, [key]: value }] as const,
      [`empty-${key}=${String(value)}`, { [key]: value }] as const,
    ]),
  ),
]

const CONTEXTS = [
  undefined,
  { timeZone: 'Europe/Sofia' },
  { timeZone: 'America/New_York' },
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

const sha = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16)

const channelsFor = (
  type: NotificationType,
  payload: NotificationPayload,
  tz: number,
) => {
  const context = CONTEXTS[tz]
  const rendered = renderNotification(type, payload, context)
  const actionUrl = 'https://app.example.test/inbox?itemId=abc'
  const email = (priority: 'urgent' | 'normal', preferencesUrl: string | null) => {
    const out = renderNotificationEmail({ rendered, actionUrl, preferencesUrl, priority })
    return { subject: out.subject, text: sha(out.text), html: sha(out.html) }
  }
  const digest = renderDigestEmail({
    recipientName: 'Sam',
    dateLabel: 'Tue 3 Mar',
    preferencesUrl: 'https://app.example.test/settings/notifications',
    groups: [{ propertyName: 'Riverside Hotel', items: [{ rendered, actionUrl }] }],
  })
  return {
    rendered,
    repeat: notificationRepeatCount(type, payload),
    urgent: email('urgent', 'https://app.example.test/settings/notifications'),
    mandatory: email('normal', null),
    digest: { subject: digest.subject, text: sha(digest.text), html: sha(digest.html) },
  }
}

const links = (type: NotificationType, payload: NotificationPayload) =>
  RESOURCE_TYPES.flatMap((resourceType) =>
    [null, 'prop-1'].map((propertyId) => [
      `${resourceType}/${propertyId}`,
      notificationLink(resourceType, 'res-1', propertyId, type, payload),
    ]),
  )

/** Distinct outputs per type, each with the variants that produce it. */
const collect = () => {
  const pin: Record<string, unknown> = {}
  for (const type of NOTIFICATION_TYPES) {
    const outputs = new Map<string, { output: unknown; variants: string[] }>()
    for (const [name, payload] of variants()) {
      for (let tz = 0; tz < CONTEXTS.length; tz += 1) {
        const output = channelsFor(type, payload, tz)
        const key = JSON.stringify(output)
        const label = `${name}@${tz}`
        const hit = outputs.get(key)
        if (hit === undefined) outputs.set(key, { output, variants: [label] })
        else hit.variants.push(label)
      }
    }
    const linkOutputs = new Map<string, { output: unknown; variants: string[] }>()
    for (const [name, payload] of variants()) {
      const output = links(type, payload)
      const key = JSON.stringify(output)
      const hit = linkOutputs.get(key)
      if (hit === undefined) linkOutputs.set(key, { output, variants: [name] })
      else hit.variants.push(name)
    }
    pin[type] = {
      replyTo: notificationReplyTo(type),
      copy: [...outputs.values()].map(({ output, variants: names }) => ({
        output,
        variantCount: names.length,
        firstVariants: names.slice(0, 3),
      })),
      links: [...linkOutputs.values()].map(({ output, variants: names }) => ({
        output,
        variantCount: names.length,
        firstVariants: names.slice(0, 3),
      })),
    }
  }
  return pin
}

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

  it.each(NOTIFICATION_TYPES)('%s says the same words in every channel', (type) => {
    expect(current[type]).toEqual(pinned[type])
  })
})
