// Feed notification surface — Resend delivery-event handler (ADR 0046 r.6).
//
// `EmailQueueStatus` has declared all nine states since migration 0026 and
// `recordProviderState` has existed in the repository just as long, but nothing
// ever called it. The practical consequence: `delivered`, `bounced` and
// `complained` were unreachable, so a hard bounce was invisible forever and we
// kept mailing dead addresses until the provider throttled the whole domain.
// This is the missing caller.
//
// Built by the Feed notification surface and exposed to the webhook route through
// the composition container. This is not a createServerFn because a webhook is
// provider push, not client RPC.

import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { providerEventCorrelationId } from '../delivery-correlation'
import type {
  EmailSuppressionReason,
  NotificationEmailRepositoryPort,
  ProviderDeliveryState,
  ProviderStateTransition,
} from '../../application/ports/notification-email-repository.port'
import type { UserLookupPort } from '../../application/ports/notification-user-lookup.port'

/**
 * The Resend event types we act on, mapped to the delivery states the queue
 * models. Everything else Resend emits (`email.sent`, `email.opened`,
 * `email.clicked`, …) is either redundant with `accepted` or engagement
 * telemetry we deliberately do not store.
 *
 * `email.suppressed` and `email.failed` arrive AFTER Resend accepted the send
 * and returned an id. Ignoring them left dropped mail reading `accepted`
 * forever, and kept mailing an address Resend had already refused.
 */
const STATE_BY_EVENT: Readonly<Record<string, ProviderDeliveryState | undefined>> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
}

/**
 * The provider refused the ADDRESS, not just this message: it is dead to us
 * too. A failure is not one of these: its causes (quota, domain, API key)
 * are rarely the recipient's.
 */
const SUPPRESSING_STATES: Readonly<Record<string, EmailSuppressionReason | undefined>> = {
  bounced: 'bounced',
  complained: 'complained',
  suppressed: 'suppressed',
}

/**
 * Only a permanent bounce proves the address dead; Resend's own suppression
 * list takes nothing else. A transient bounce (a full mailbox) or an
 * undetermined one ends only that message. A bounce with no type at all is an
 * unfamiliar payload, so it is treated as the old code treated every bounce.
 */
const isPermanentBounce = (bounceType: string | undefined): boolean =>
  bounceType === undefined || bounceType.toLowerCase() === 'permanent'

const suppressionReasonFor = (
  state: ProviderDeliveryState,
  bounceType: string | undefined,
): EmailSuppressionReason | undefined =>
  state === 'bounced' && !isPermanentBounce(bounceType)
    ? undefined
    : SUPPRESSING_STATES[state]

/** An event about one message we sent. */
export type ResendMessageEventInput = Readonly<{
  /** Resend event type, e.g. `email.bounced`. */
  type: string
  /** `data.email_id` — the id `markAccepted` stored as `providerMessageId`. */
  providerMessageId: string
  /** Provider-reported event time; falls back to receipt time at the route. */
  occurredAt: Date
  /** `svix-id`, for correlating a retry with its first delivery in logs. */
  eventId: string
  /** `data.bounce.type` of a bounce: `Permanent`, `Transient` or `Undetermined`. */
  bounceType?: string
}>

/**
 * A change to the provider's own suppression list. It names an address, not
 * a message: an operator who takes an address off Resend's list must see it
 * lifted here too, or it stays refused by us forever.
 */
export type ResendSuppressionListEventInput = Readonly<{
  type: 'suppression.added' | 'suppression.removed'
  /** `data.email`. Keyed at once and never logged or stored as given. */
  address: string
  /** `data.origin`: `bounce`, `complaint` or `manual`. */
  origin?: string
  occurredAt: Date
  eventId: string
}>

export type ResendEventInput = ResendMessageEventInput | ResendSuppressionListEventInput

export type ResendEventResult = Readonly<{
  /**
   * Whether the event took effect: it moved a queue row, or re-applied the
   * suppression of a message whose row an earlier delivery already moved.
   */
  applied: boolean
  /** Rows moved by this event. */
  rows: number
  /** Further rows suppressed because the recipient is now undeliverable. */
  suppressed: number
  /** Why nothing was applied, when `applied` is false. */
  reason?: 'ignored_event_type' | 'unknown_message' | 'out_of_order'
}>

export type ResendEventDeps = Readonly<{
  emailRepo: NotificationEmailRepositoryPort
  /** The recipient's address, to key a durable suppression by. */
  userLookup: Pick<UserLookupPort, 'getEmail'>
  logger: LoggerPort
}>

/**
 * One cascade per distinct (user, organization): every still-sendable row for
 * that recipient is dead too. The address itself is recorded durably, so the
 * refusal outlives queue retention and reaches every Organization that would
 * mail it.
 */
async function suppressRecipients(
  deps: ResendEventDeps,
  moved: readonly ProviderStateTransition[],
  reason: EmailSuppressionReason,
  occurredAt: Date,
): Promise<number> {
  const seen = new Set<string>()
  let suppressed = 0
  for (const row of moved) {
    const key = `${row.organizationId as string}:${row.userId as string}`
    if (seen.has(key)) continue
    seen.add(key)
    const address = await deps.userLookup.getEmail(row.userId)
    if (address) await deps.emailRepo.suppressAddress(address, reason, occurredAt)
    suppressed += await deps.emailRepo.suppressRecipient(
      row.userId,
      row.organizationId,
      `provider_${reason}`,
      occurredAt,
    )
  }
  return suppressed
}

/** Why Resend put an address on its list, in our terms. */
const LIST_ORIGIN_REASONS: Readonly<Record<string, EmailSuppressionReason | undefined>> =
  {
    bounce: 'bounced',
    complaint: 'complained',
  }

async function applySuppressionListEvent(
  deps: ResendEventDeps,
  input: ResendSuppressionListEventInput,
): Promise<ResendEventResult> {
  const fields = {
    eventType: input.type,
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    correlationId: providerEventCorrelationId(input.eventId),
  }
  if (input.type === 'suppression.removed') {
    await deps.emailRepo.forgetAddress(input.address)
    deps.logger.info(fields, 'Provider lifted an address suppression; lifted here too')
    return { applied: true, rows: 0, suppressed: 0 }
  }
  // A manual addition, or an origin we do not know, is the provider's own call.
  const reason = LIST_ORIGIN_REASONS[input.origin ?? ''] ?? 'suppressed'
  await deps.emailRepo.suppressAddress(input.address, reason, input.occurredAt)
  deps.logger.info(fields, 'Provider suppressed an address; recorded here too')
  return { applied: true, rows: 0, suppressed: 0 }
}

export async function applyResendEvent(
  deps: ResendEventDeps,
  input: ResendEventInput,
): Promise<ResendEventResult> {
  if ('address' in input) return applySuppressionListEvent(deps, input)
  const correlationId = providerEventCorrelationId(input.eventId)
  const state = STATE_BY_EVENT[input.type]
  if (!state) {
    // Not an error: Resend sends engagement events we do not subscribe to
    // state for. Logged at debug so an unexpected type is still discoverable.
    deps.logger.debug(
      { eventType: input.type, correlationId },
      'Resend event ignored — no delivery-state mapping',
    )
    return { applied: false, rows: 0, suppressed: 0, reason: 'ignored_event_type' }
  }

  const moved = await deps.emailRepo.recordProviderState(
    input.providerMessageId,
    state,
    input.occurredAt,
  )
  const reason = suppressionReasonFor(state, input.bounceType)
  if (moved.length === 0) {
    // The state change commits on its own, before the suppression below. If
    // that suppression failed, the provider retries into a row that no longer
    // moves; the address must still be refused. Both writes are idempotent,
    // so re-applying them on any refusal of a message that is ours is safe.
    const owned = reason
      ? await deps.emailRepo.findProviderMessageRecipients(input.providerMessageId)
      : []
    if (reason && owned.length > 0) {
      const suppressed = await suppressRecipients(deps, owned, reason, input.occurredAt)
      deps.logger.warn(
        { eventType: input.type, deliveryState: state, suppressed, correlationId },
        'Resend event re-applied the suppression of a message already recorded',
      )
      return { applied: true, rows: 0, suppressed }
    }
    // Either the provider message id is not ours (a stale webhook from a
    // rotated account) or the transition would go backwards. Both are worth a
    // line: a silent no-op here looks exactly like a working webhook.
    deps.logger.warn(
      { eventType: input.type, deliveryState: state, correlationId },
      'Resend event matched no queue row — unknown message or out-of-order transition',
    )
    return { applied: false, rows: 0, suppressed: 0, reason: 'unknown_message' }
  }

  if (!reason) {
    const fields = {
      eventType: input.type,
      deliveryState: state,
      ...(input.bounceType === undefined ? {} : { bounceType: input.bounceType }),
      rows: moved.length,
      correlationId,
    }
    // A message lost after acceptance is exactly what support cannot see.
    if (state === 'failed') {
      deps.logger.error(fields, 'Email failed at the provider after it was accepted')
    } else {
      deps.logger.info(fields, 'Recorded email delivery state')
    }
    return { applied: true, rows: moved.length, suppressed: 0 }
  }

  const suppressed = await suppressRecipients(deps, moved, reason, input.occurredAt)
  deps.logger.error(
    {
      eventType: input.type,
      deliveryState: state,
      rows: moved.length,
      suppressed,
      correlationId,
    },
    'Recipient marked undeliverable by provider — remaining queued email suppressed',
  )
  return { applied: true, rows: moved.length, suppressed }
}

/**
 * Bind the route-facing handler while the context is assembled. Infrastructure
 * receives its ports inward from the build module and never reaches outward to
 * the global container.
 */
export const createResendEventHandler =
  (deps: ResendEventDeps) =>
  (input: ResendEventInput): Promise<ResendEventResult> =>
    trace('notification.handleResendEvent', () => applyResendEvent(deps, input))
