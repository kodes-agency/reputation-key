import type { NotificationPayload } from './notification-payload'
import type {
  NotificationRenderContext,
  RenderedNotification,
} from './notification-templates'
import type { NotificationType } from './notification-types'

export const UUID = '61ed98fc-9cf8-44e9-b49d-cd25e744fd6c'

export const FULL: NotificationPayload = {
  propertyName: 'Riverside Hotel',
  guestRating: 2,
  platform: 'portal',
  waitingHours: 27,
  actorRole: 'property_manager',
  moderationReason: 'Tone is too defensive.',
  goalName: 'Q3 response time',
}

export const SEAVIEW: NotificationPayload = {
  propertyName: 'Seaview Hotel',
  goalName: 'Monthly portal goal',
  goalMonth: '2026-11',
  goalSubjectKind: 'property',
  goalMeasure: 'portal_rating_count',
  goalCount: 41,
  goalTargetCount: 40,
}

interface CopyFields {
  readonly title: string
  readonly body: string
  readonly actionLabel: string
  readonly summary: string
  /** Set when the row under the title repeats the body. */
  readonly detailMirrorsBody?: true
  readonly whyReceived?: string
}

/** The full rendered shape a copy test pins with toEqual. */
export const copy = (fields: CopyFields): RenderedNotification => ({
  title: fields.title,
  body: fields.body,
  detail: fields.detailMirrorsBody === true ? fields.body : '',
  actionLabel: fields.actionLabel,
  summary: fields.summary,
  ...(fields.whyReceived === undefined ? {} : { whyReceived: fields.whyReceived }),
})

export type ExactCopyCase = readonly [
  name: string,
  type: NotificationType,
  payload: NotificationPayload,
  options: NotificationRenderContext | undefined,
  expected: RenderedNotification,
]
