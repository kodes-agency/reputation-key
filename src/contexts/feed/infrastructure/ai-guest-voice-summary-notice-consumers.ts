// Feed — the Monday email (v3 contract decision 11; ADR 0046, amended 2026-10-30).
//
// The AI context decides, once an hour, which Properties have something to say on their
// Monday morning (a week in which Fix first moved, an issue is new, or a review was Urgent;
// or the first Monday of the month, whatever the week held) and records one governed fact
// per Property per Monday: `ai.guest_voice_summary.ready`, the page's three lines as fixed
// topics, counts and a window. This route turns it into one notice per manager who may use
// the Property, and the reader's own preferences decide the rest: the category is
// `guest_voice`, opt-in on both channels, so a manager who never asked gets neither a row
// nor an email, and one who did gets the email on that Monday morning, as a message of
// its own.
//
// Recipients are asked broadly, because consent is the preference and not this list: every
// AccountAdmin and PropertyManager of the Organization who is still eligible for the
// Property (`property_operator`, re-read at delivery). A Member cannot sign in during the
// beta and a manager without access to the Property sees no Guest voice for it.
//
// What the notice carries is only what the fact carried, minus the issue's id: no cause,
// no quote, no review and no person (ADR 0046 r.8; ADR 0031). Each Monday is a row of its
// own (the resource is the Property and the day), so a manager who left last week's unread
// still gets this week's email.
import { organizationId, propertyId, unbrand, type UserId } from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { ActivePropertyLookup } from '../application/ports/active-property.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationPayload } from '../domain/notification-payload'
import type { NotificationGuestVoiceLine } from '../domain/notification-payload-guest-voice'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

export const ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER =
  'notification.on-ai-guest-voice-summary-ready' as const

const EVENT_TYPE = 'ai.guest_voice_summary.ready' as const

export type AiGuestVoiceSummaryNoticeConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    responsibleManagers: Pick<ResponsibleManagerLookupPort, 'isEligibleForProperty'>
    activeProperty: ActivePropertyLookup
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type SummaryFactLine = Readonly<{
  kind: 'fix_first' | 'protect' | 'change'
  topic: NotificationGuestVoiceLine['topic']
  issueId: string | null
  reviewCount: number
  textReviewCount: number
  upTo: number | null
  change: 'rising' | 'falling' | null
  polarity: 'complaint' | 'praise' | null
}>

type SummaryReadyPayload = Readonly<{
  organizationId: string
  propertyId: string
  summaryKind: 'weekly' | 'monthly'
  localDate: string
  window: '30d' | '90d' | '180d' | '365d'
  startLocalDate: string
  endLocalDate: string
  lines: readonly SummaryFactLine[]
  occurredAt: string
}>

function parse(event: ConsumerEvent): SummaryReadyPayload {
  if (event.eventType !== EVENT_TYPE) {
    throw new Error('Guest voice summary consumer received the wrong event type')
  }
  const payload = validateEventPayload(EVENT_TYPE, event.eventVersion, event.payload) as
    SummaryReadyPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Guest voice summary envelope attribution mismatch')
  }
  return payload
}

/** The line as the notice states it: the fact's, in hundredths of a star, with no issue id. */
function lineOf(line: SummaryFactLine): NotificationGuestVoiceLine {
  return {
    kind: line.kind,
    topic: line.topic,
    reviewCount: line.reviewCount,
    textReviewCount: line.textReviewCount,
    ...(line.upTo === null ? {} : { upToHundredths: Math.round(line.upTo * 100) }),
    ...(line.change === null ? {} : { change: line.change }),
    ...(line.polarity === null ? {} : { polarity: line.polarity }),
  }
}

/**
 * The managers who may be told: every AccountAdmin and PropertyManager of the
 * Organization who is eligible for the Property now. Their preferences, not this list,
 * say whether they asked.
 */
async function managersOfProperty(
  deps: AiGuestVoiceSummaryNoticeConsumerDeps,
  org: ReturnType<typeof organizationId>,
  property: ReturnType<typeof propertyId>,
): Promise<readonly UserId[]> {
  const [admins, managers] = await Promise.all([
    deps.userLookup.findByRole(org, 'AccountAdmin'),
    deps.userLookup.findByRole(org, 'PropertyManager'),
  ])
  const candidates = [...new Set([...admins, ...managers])]
  const eligible = await Promise.all(
    candidates.map((user) =>
      deps.responsibleManagers.isEligibleForProperty(org, property, user),
    ),
  )
  return candidates.filter((_user, index) => eligible[index] === true)
}

/** One unread-key per Property and Monday: last week's unread row never swallows this week's email. */
export const guestVoiceSummaryResourceId = (
  property: string,
  localDate: string,
): string => `${property}:${localDate}`

export async function handleAiGuestVoiceSummaryReady(
  deps: AiGuestVoiceSummaryNoticeConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const fact = parse(event)
  const org = organizationId(fact.organizationId)
  const property = propertyId(fact.propertyId)
  const finish = async (status: 'applied' | 'obsolete') => {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER,
      status,
    )
    return { status } as const
  }

  // An archived Property sends nothing: the summary is for a Property people work.
  if (!(await deps.activeProperty(org, property))) return finish('obsolete')
  const recipients = await managersOfProperty(deps, org, property)
  if (recipients.length === 0) return finish('obsolete')

  const where = await buildPropertyPayload(deps, org, property)
  const payload: NotificationPayload = {
    ...where,
    guestVoiceKind: fact.summaryKind,
    guestVoiceWindow: fact.window,
    guestVoiceLines: fact.lines.map(lineOf),
  }
  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: org,
          propertyId: property,
          type: 'guest_voice.summary' as const,
          resourceType: 'property' as const,
          resourceId: guestVoiceSummaryResourceId(fact.propertyId, fact.localDate),
          eventId: event.eventId,
          payload,
          audience: { kind: 'property_operator' as const },
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )
  return finish('applied')
}

export function registerAiGuestVoiceSummaryNoticeConsumer(
  registry: ConsumerRegistry,
  deps: AiGuestVoiceSummaryNoticeConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Literals kept mechanically discoverable by the governance catalogues.
  registerConsumer({
    eventType: 'ai.guest_voice_summary.ready',
    consumerName: 'notification.on-ai-guest-voice-summary-ready',
    module: 'notification.ai-guest-voice-summary-notice-consumers',
    handler: (event) => handleAiGuestVoiceSummaryReady(deps, event),
  })
}
