// Durable delivery for one-shot Inbox Response Target reminders.
//
// The Inbox event is only a candidate. Notification resolves the exact active
// target before fan-out, and the queued audience resolves it again before
// materialization. Completion, cancellation, cycle replacement, and recipient
// changes therefore fail closed without turning a timing reminder into an
// escalation or leaking source content.

import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { inboxItemId, organizationId, propertyId } from '#/shared/domain/ids'
import type { NotificationType } from '../domain/notification-types'
import type { NotificationAudience } from '../application/notification-audience'
import { resolveResponseTargetReminderRecipients } from '../application/response-target-reminder-recipients'
import type { InboxFanoutDeps } from './inbox-notification-fanout'
import { buildInboxItemPayload } from './notification-payload-facts'
import { deliverNotices, type NoticeDeliveryDeps } from '../notify/consumers.server'

const EVENT_TYPE = 'inbox.response_target.reminder_due' as const

export const ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER =
  'notification.on-inbox-response-target-reminder-due' as const

export type ResponseTargetNotificationConsumerDeps = InboxFanoutDeps & NoticeDeliveryDeps

type ResponseTargetReminderPayload = Readonly<{
  inboxItemId: string
  cycleNumber: number
  organizationId: string
  propertyId: string
  targetKind: 'google_review_response' | 'private_feedback_handling'
  reminderKind: 'halfway' | 'target_passed'
  scheduledFor: string
  userId: null
  source: 'import'
  occurredAt: string
}>

function parse(event: ConsumerEvent): ResponseTargetReminderPayload {
  if (event.eventType !== EVENT_TYPE) {
    throw new Error('Unsupported Inbox Response Target notification event')
  }
  const payload = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  ) as ResponseTargetReminderPayload | undefined
  if (
    event.eventVersion !== 1 ||
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Inbox Response Target notification envelope attribution mismatch')
  }
  return payload
}

const notificationTypeFor = (
  reminderKind: ResponseTargetReminderPayload['reminderKind'],
): NotificationType =>
  reminderKind === 'halfway'
    ? 'inbox.response_target_halfway'
    : 'inbox.response_target_passed'

export async function handleNotificationResponseTargetReminder(
  deps: ResponseTargetNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parse(event)
  const orgId = organizationId(payload.organizationId)
  const itemId = inboxItemId(payload.inboxItemId)
  const scheduledFor = new Date(payload.scheduledFor)
  const facts = await deps.inboxItemLookup.findResponseTargetReminderNotificationFacts({
    inboxItemId: itemId,
    organizationId: orgId,
    cycleNumber: payload.cycleNumber,
    targetKind: payload.targetKind,
    reminderKind: payload.reminderKind,
    scheduledFor,
  })
  if (
    !facts ||
    facts.propertyId !== payload.propertyId ||
    facts.currentCycleNumber !== payload.cycleNumber ||
    facts.status !== 'open' ||
    facts.targetKind !== payload.targetKind ||
    facts.reminderKind !== payload.reminderKind ||
    facts.scheduledFor.toISOString() !== payload.scheduledFor
  ) {
    return deliverNotices(
      deps,
      event,
      ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
      [],
      { status: 'obsolete' },
    )
  }

  const recipients = await resolveResponseTargetReminderRecipients(deps, orgId, facts)
  const notificationPayload = {
    ...(await buildInboxItemPayload(deps, {
      inboxItemId: itemId,
      orgId,
      measureWait: true,
    })),
    // What the reminder is actually about. Stored as the instant, because the
    // copy renders it on each READER's clock and two people responsible for
    // one item need not share a timezone.
    targetDueAt: facts.dueAt.toISOString(),
  }
  const audience: NotificationAudience = {
    kind: 'response_target_reminder',
    inboxItemId: itemId,
    sourceType: facts.sourceType,
    sourceId: facts.sourceId,
    cycleNumber: facts.currentCycleNumber,
    sourceRevision: facts.currentSourceRevision,
    stateRevision: facts.stateRevision,
    targetKind: facts.targetKind,
    reminderKind: facts.reminderKind,
    scheduledFor: facts.scheduledFor.toISOString(),
  }

  return deliverNotices(
    deps,
    event,
    ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: orgId,
      propertyId: propertyId(payload.propertyId),
      type: notificationTypeFor(payload.reminderKind),
      resourceType: 'inbox_item' as const,
      resourceId: itemId,
      payload: notificationPayload,
      audience,
    })),
  )
}

export function registerResponseTargetNotificationConsumer(
  registry: ConsumerRegistry,
  deps: ResponseTargetNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: EVENT_TYPE,
    consumerName: ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
    module: 'notification.response-target-outbox-consumers',
    handler: (event) => handleNotificationResponseTargetReminder(deps, event),
  })
}
