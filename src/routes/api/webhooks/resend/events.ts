// Notification context — Resend delivery-event webhook endpoint (ADR 0046 r.6).
//
// Structured after `api/webhooks/gbp/notifications.ts`: the route is thin — it
// verifies the signature (an API endpoint concern), parses the event, then
// delegates to the composition-owned notification handler. Responses are
// status-coded so an operator can tell a forged signature (401) from a
// malformed body (400) from a transient internal failure (500). Resend retries
// only on non-2xx, so the happy path acks with 200 — and so does an event we
// deliberately ignore, because retrying it forever would not change the outcome.
//
// Fail-closed-at-the-route: `RESEND_WEBHOOK_SECRET` is OPTIONAL in the env
// schema so a deployment without Resend webhooks still boots, and this endpoint
// answers 503 `webhook_disabled` rather than accepting unverified state
// transitions. That answer goes out before any authentication, so it names no
// configuration; the variable name is in the operator log only.
//
// Webhook routes may resolve narrow runtime operations from the composition
// container, but never import context infrastructure directly.

import { createFileRoute } from '@tanstack/react-router'
import { z, ZodError } from 'zod/v4'
import { getContainer } from '#/composition'
import { svixHeaders, verifySvixSignature } from '#/shared/auth/svix-signature.verifier'
import { requestRuntimeConfig } from '#/shared/config/request-runtime-config'
import { getLogger } from '#/shared/observability/logger'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import { trace } from '#/shared/observability/trace'

// Only the fields we act on. Resend adds fields freely, so the schema stays
// permissive about everything else — and deliberately never reads a message
// event's `data.to`, `data.subject` or `data.html`: BQC-1.6 keeps recipient
// content out of this process, and the queue row already knows who it was
// for. Of a bounce only its `type` is read, a classification (Permanent,
// Transient, Undetermined): the provider's message is the recipient server's
// text.
const resendEventSchema = z.object({
  type: z.string().min(1),
  created_at: z.string().optional(),
  data: z.object({
    email_id: z.string().min(1),
    bounce: z.object({ type: z.string().min(1).max(32).optional() }).optional(),
  }),
})

/** What the composition-owned handler accepts. */
type ResendEventInput = Parameters<
  ReturnType<typeof getContainer>['handleResendEvent']
>[0]

// A change to Resend's own suppression list names an address, not a message.
// The address is the one recipient field read here: it is keyed at once by the
// handler and never logged or stored as given. Without it, an operator who
// lifts a suppression at the provider could never lift ours.
const SUPPRESSION_LIST_EVENTS = ['suppression.added', 'suppression.removed'] as const
const suppressionListEventSchema = z.object({
  type: z.enum(SUPPRESSION_LIST_EVENTS),
  created_at: z.string().optional(),
  data: z.object({
    email: z.string().min(3).max(320),
    origin: z.string().min(1).max(32).optional(),
  }),
})

const isSuppressionListEvent = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  SUPPRESSION_LIST_EVENTS.some((type) => (payload as { type?: unknown }).type === type)

/**
 * A webhook subscribed to "all events" also receives domain.* and contact.*
 * events, which are about no message and carry no `email_id`. Parsed as a
 * message event they failed as malformed (400), so the provider retried each
 * one and the log read like a broken integration. They are acknowledged as
 * ignored, like any other event this route has no use for.
 */
const typeAboutNoMessage = (payload: unknown): string | null => {
  const type =
    typeof payload === 'object' && payload !== null
      ? (payload as { type?: unknown }).type
      : undefined
  return typeof type === 'string' && !type.startsWith('email.') ? type.slice(0, 64) : null
}

/** A provider timestamp we cannot parse is worse than our own receipt time. */
const eventTime = (createdAt: string | undefined): Date => {
  const parsed = createdAt ? new Date(createdAt) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
}

/**
 * Parse the verified body into the handler's input, or the type of an event
 * about no message. Throws ZodError.
 */
function eventInput(
  rawBody: string,
  eventId: string,
): ResendEventInput | Readonly<{ ignoredType: string }> {
  const payload: unknown = JSON.parse(rawBody)
  if (isSuppressionListEvent(payload)) {
    const event = suppressionListEventSchema.parse(payload)
    return {
      type: event.type,
      address: event.data.email,
      ...(event.data.origin === undefined ? {} : { origin: event.data.origin }),
      occurredAt: eventTime(event.created_at),
      eventId,
    }
  }
  const ignoredType = typeAboutNoMessage(payload)
  if (ignoredType !== null) return { ignoredType }
  const event = resendEventSchema.parse(payload)
  const bounceType = event.data.bounce?.type
  return {
    type: event.type,
    providerMessageId: event.data.email_id,
    occurredAt: eventTime(event.created_at),
    eventId,
    // Only a permanent bounce suppresses the address.
    ...(bounceType === undefined ? {} : { bounceType }),
  }
}

/**
 * POST handler for Resend webhooks. Extracted from the Route definition so it
 * is directly testable without the TanStack route tree.
 *
 * Flow: gate on configured secret → verify Svix signature over the RAW body →
 * parse → delegate to `handleResendEvent`.
 */
export async function handleResendWebhookPost(request: Request): Promise<Response> {
  return trace('webhook.resendEvents', async () => {
    const logger = getLogger()
    const signingSecret = requestRuntimeConfig().resendWebhookSecret

    if (!signingSecret) {
      logger.warn(
        'Resend webhook received while RESEND_WEBHOOK_SECRET is unset — endpoint disabled',
      )
      return Response.json(
        { error: 'Service Unavailable', code: 'webhook_disabled' },
        { status: 503 },
      )
    }

    try {
      // The RAW body, read once. Re-serialising parsed JSON changes bytes and
      // invalidates the signature.
      const rawBody = await request.text()
      const verification = verifySvixSignature({
        rawBody,
        headers: svixHeaders(request),
        signingSecret,
      })
      if (!verification.ok) {
        logger.warn(
          { reason: verification.reason },
          'Resend webhook signature verification failed',
        )
        return Response.json(
          { error: 'Unauthorized', message: 'Invalid Resend webhook signature' },
          { status: 401 },
        )
      }

      const input = eventInput(rawBody, verification.id)
      if ('ignoredType' in input) {
        logger.info(
          { eventType: input.ignoredType },
          'Resend webhook event about no message ignored',
        )
        return Response.json(
          {
            ok: true,
            applied: false,
            rows: 0,
            suppressed: 0,
            reason: 'ignored_event_type',
          },
          { status: 200 },
        )
      }
      const result = await getContainer().handleResendEvent(input)

      // 200 even for an ignored or unmatched event: a retry cannot change it,
      // and the handler has already logged why.
      return Response.json({ ok: true, ...result }, { status: 200 })
    } catch (err) {
      if (err instanceof ZodError || err instanceof SyntaxError) {
        logger.warn({ err }, 'Resend webhook received malformed payload')
        return Response.json(
          { error: 'Bad Request', message: 'Malformed webhook payload' },
          { status: 400 },
        )
      }
      logger.error({ err }, 'Resend webhook processing failed')
      // Answered, not thrown, so neither the Nitro error hook nor Sentry's
      // request middleware sees it; Resend just retries into the same failure.
      captureObservabilityException(err, { source: 'nitro' })
      return Response.json(
        {
          error: 'Internal Server Error',
          message: 'Unexpected error processing Resend delivery event',
        },
        { status: 500 },
      )
    }
  })
}

export const Route = createFileRoute('/api/webhooks/resend/events')({
  server: {
    handlers: {
      POST: ({ request }) => handleResendWebhookPost(request),
    },
  },
})
