// Feed — the Urgent alert (v3 contract decision 10; ADR 0046, amended 2026-10-30).
//
// A review analysis v3 that finds a review Urgent (a reported risk to safety or health,
// discrimination or a legal threat) writes one identifier-only fact per review revision
// (`ai.review_analysis.urgent_detected`, in the transaction that stores the analysis).
// This route turns it into the one notice an AI finding may start: "An urgent review
// needs you", to the managers who receive this Property's review notifications, under
// the existing urgent channel and the reader's existing Action needed preferences.
//
// What it may say. The fact names a review revision and an analysis and nothing else, and
// so does the notice: it never carries the reason, the topic, the stars or a word of the
// review (ADR 0046 r.8). The reason is read in the app, where the notice opens the Inbox
// item. What it may do. It reads the Inbox and writes nothing there: it changes no
// status, assignment, escalation or priority, and a manager's own priority still wins
// (AI invariant 5; ADR 0071).
//
// When it stays silent. An alert is for a review somebody can still act on, so the route
// raises none when the item is gone, is closed, has moved to a later revision (that one
// has its own analysis and its own alert), arrived as imported Google history (never
// announced, ADR 0046), or has waited longer than a week. The last rule is what stops the
// replay of history after a re-consent from announcing a year of old reviews. A review the
// Inbox has not projected yet is waited for, by throwing so the dispatch retries, up to
// `PROJECTION_HORIZON_MS`, and then dropped as obsolete.
import {
  organizationId,
  propertyId,
  reviewId,
  unbrand,
  type InboxItemId,
} from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
} from '../application/responsible-recipients'
import type { InboxFanoutDeps } from './inbox-notification-fanout'
import { buildInboxItemPayload } from './notification-payload-facts'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_AI_REVIEW_URGENT_DETECTED_CONSUMER =
  'notification.on-ai-review-urgent-detected' as const

const EVENT_TYPE = 'ai.review_analysis.urgent_detected' as const

/** How long the alert waits for the Inbox to project the review it is about. */
export const PROJECTION_HORIZON_MS = 15 * 60_000

/** A review that has waited longer than this is not news; see the route's header. */
export const FRESHNESS_HORIZON_MS = 7 * 24 * 3_600_000

export type AiUrgentReviewNoticeConsumerDeps = InboxFanoutDeps &
  Readonly<{
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type UrgentDetectedPayload = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  occurredAt: string
}>

function parse(event: ConsumerEvent): UrgentDetectedPayload {
  if (event.eventType !== EVENT_TYPE) {
    throw new Error('Urgent alert consumer received the wrong event type')
  }
  const payload = validateEventPayload(EVENT_TYPE, event.eventVersion, event.payload) as
    UrgentDetectedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Urgent alert envelope attribution mismatch')
  }
  return payload
}

type Outcome = Readonly<{ status: 'applied' | 'obsolete' }>

/**
 * The Inbox has not caught up with this revision: the item is not there yet, or still
 * stands at an earlier revision. The projection is asynchronous and usually done long
 * before a provider answers, so this is rare; the dispatch retries by the throw.
 */
function projectionPending(
  deps: AiUrgentReviewNoticeConsumerDeps,
  fact: UrgentDetectedPayload,
): boolean {
  return deps.clock().getTime() - Date.parse(fact.occurredAt) < PROJECTION_HORIZON_MS
}

/** Whether the item is still the unhandled review this alert is about. */
async function alertIsCurrent(
  deps: AiUrgentReviewNoticeConsumerDeps,
  fact: UrgentDetectedPayload,
  item: InboxItemId,
): Promise<'current' | 'stale' | 'pending'> {
  const org = organizationId(fact.organizationId)
  const facts = await deps.inboxItemLookup.findHandlingCycleNotificationFacts(item, org)
  if (
    facts === null ||
    facts.sourceType !== 'review' ||
    facts.sourceId !== fact.reviewId ||
    facts.propertyId !== fact.propertyId ||
    facts.status !== 'open'
  ) {
    return 'stale'
  }
  if (facts.currentSourceRevision < fact.sourceRevision) return 'pending'
  if (facts.currentSourceRevision > fact.sourceRevision) return 'stale'
  if (await deps.inboxItemLookup.isHistoricalOnboardingItem(item, org)) return 'stale'
  const waitingSince = await deps.inboxItemLookup.findWaitingSince(item, org)
  return waitingSince !== null &&
    deps.clock().getTime() - waitingSince.getTime() > FRESHNESS_HORIZON_MS
    ? 'stale'
    : 'current'
}

export async function handleAiReviewUrgentDetected(
  deps: AiUrgentReviewNoticeConsumerDeps,
  event: ConsumerEvent,
): Promise<Outcome> {
  const fact = parse(event)
  const org = organizationId(fact.organizationId)
  const finish = async (status: Outcome['status']): Promise<Outcome> => {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_AI_REVIEW_URGENT_DETECTED_CONSUMER,
      status,
    )
    return { status }
  }

  const item = await deps.inboxItemLookup.findInboxItemByReviewId(
    reviewId(fact.reviewId),
    org,
  )
  const state = item === null ? 'pending' : await alertIsCurrent(deps, fact, item)
  if (item === null || state === 'pending') {
    if (projectionPending(deps, fact)) {
      throw new Error('Urgent alert waits for the Inbox to project the review')
    }
    return finish('obsolete')
  }
  if (state === 'stale') return finish('obsolete')

  const facts = await deps.inboxItemLookup.findInboxItemFacts(item, org)
  if (facts === null) return finish('obsolete')
  const recipients = await resolveInboxResponsibleRecipients(deps, org, facts)
  if (recipients.length === 0) {
    deps.logger.warn('urgent alert: no recipients found')
    return finish('obsolete')
  }

  // The Property and how long the item has waited; the payload allowlist admits no more.
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: item,
    orgId: org,
    measureWait: true,
  })
  const audience = inboxNotificationAudience(facts)
  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: org,
          propertyId: propertyId(fact.propertyId),
          type: 'review.ai_urgent_detected' as const,
          resourceType: 'inbox_item' as const,
          resourceId: unbrand(item),
          eventId: event.eventId,
          payload,
          audience,
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )
  return finish('applied')
}

export function registerAiUrgentReviewNoticeConsumer(
  registry: ConsumerRegistry,
  deps: AiUrgentReviewNoticeConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Literals kept mechanically discoverable by the governance catalogues.
  registerConsumer({
    eventType: 'ai.review_analysis.urgent_detected',
    consumerName: 'notification.on-ai-review-urgent-detected',
    module: 'notification.ai-urgent-review-notice-consumers',
    handler: (event) => handleAiReviewUrgentDetected(deps, event),
  })
}
