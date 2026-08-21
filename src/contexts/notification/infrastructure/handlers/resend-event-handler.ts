// Notification context — Resend delivery-event handler (ADR 0046 r.6).
//
// `EmailQueueStatus` has declared all nine states since migration 0026 and
// `recordProviderState` has existed in the repository just as long, but nothing
// ever called it. The practical consequence: `delivered`, `bounced` and
// `complained` were unreachable, so a hard bounce was invisible forever and we
// kept mailing dead addresses until the provider throttled the whole domain.
// This is the missing caller.
//
// Called from the webhook route after signature verification, in the same shape
// as `integration/infrastructure/handlers/gbp-notification-handler.ts`: not a
// createServerFn, because a webhook is push, not RPC.

import { getContainer } from '#/composition'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { providerEventCorrelationId } from '../delivery-correlation'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'

/**
 * The Resend event types we act on, mapped to the delivery states the queue
 * models. Everything else Resend emits (`email.sent`, `email.opened`,
 * `email.clicked`, …) is either redundant with `accepted` or engagement
 * telemetry we deliberately do not store.
 */
const STATE_BY_EVENT: Readonly<
  Record<string, 'delivered' | 'bounced' | 'complained' | undefined>
> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

/** A terminal negative state means the address is dead. Stop mailing it. */
const SUPPRESSING_STATES: Readonly<Record<string, true | undefined>> = {
  bounced: true,
  complained: true,
}

export type ResendEventInput = Readonly<{
  /** Resend event type, e.g. `email.bounced`. */
  type: string
  /** `data.email_id` — the id `markAccepted` stored as `providerMessageId`. */
  providerMessageId: string
  /** Provider-reported event time; falls back to receipt time at the route. */
  occurredAt: Date
  /** `svix-id`, for correlating a retry with its first delivery in logs. */
  eventId: string
}>

export type ResendEventResult = Readonly<{
  /** Whether the event moved any queue row. */
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
  logger: LoggerPort
}>

export async function applyResendEvent(
  deps: ResendEventDeps,
  input: ResendEventInput,
): Promise<ResendEventResult> {
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
  if (moved.length === 0) {
    // Either the provider message id is not ours (a stale webhook from a
    // rotated account) or the transition would go backwards. Both are worth a
    // line: a silent no-op here looks exactly like a working webhook.
    deps.logger.warn(
      { eventType: input.type, state, correlationId },
      'Resend event matched no queue row — unknown message or out-of-order transition',
    )
    return { applied: false, rows: 0, suppressed: 0, reason: 'unknown_message' }
  }

  if (!SUPPRESSING_STATES[state]) {
    deps.logger.info(
      { eventType: input.type, state, rows: moved.length, correlationId },
      'Recorded email delivery state',
    )
    return { applied: true, rows: moved.length, suppressed: 0 }
  }

  // One cascade per distinct (user, organization): a bounce is a property of
  // the ADDRESS, so every still-sendable row for that recipient is dead too.
  const seen = new Set<string>()
  let suppressed = 0
  for (const row of moved) {
    const key = `${row.organizationId as string}:${row.userId as string}`
    if (seen.has(key)) continue
    seen.add(key)
    suppressed += await deps.emailRepo.suppressRecipient(
      row.userId,
      row.organizationId,
      `provider_${state}`,
      input.occurredAt,
    )
  }
  deps.logger.error(
    {
      eventType: input.type,
      state,
      rows: moved.length,
      suppressed,
      correlationId,
    },
    'Recipient marked undeliverable by provider — remaining queued email suppressed',
  )
  return { applied: true, rows: moved.length, suppressed }
}

/**
 * Route-facing entry point. Resolves the repository from the container so the
 * webhook route stays a thin request/response shell.
 */
export async function handleResendEvent(
  input: ResendEventInput,
): Promise<ResendEventResult> {
  return trace('notification.handleResendEvent', async () => {
    return applyResendEvent(
      { emailRepo: getContainer().notificationEmailRepo, logger: getLogger() },
      input,
    )
  })
}
