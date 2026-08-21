// Integration context — GBP Pub/Sub webhook endpoint
// Per architecture: the route is thin — it verifies the JWT (API endpoint concern),
// parses the push payload, extracts locationId, then delegates to the server function.
// No auth guard — JWT verification is manual (Google Pub/Sub push format).
// Responses are status-coded so operators can distinguish a forged token (401) from a
// malformed payload (400) from a transient internal failure (500); Pub/Sub retries only
// on non-2xx, so the happy path still acks with 200.
// Webhook routes are exempt from the "no direct infrastructure import" rule — see src/routes/CONTEXT.md

import { createFileRoute } from '@tanstack/react-router'
import { JOSEError } from 'jose/errors'
import { z, ZodError } from 'zod'
import { verifyPubSubJwt } from '#/shared/auth/pubsub-jwt.verifier'
import { getEnv, type Env } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import type pino from 'pino'
import { trace } from '#/shared/observability/trace'
// eslint-disable-next-line boundaries/dependencies -- webhook routes delegate directly to context handlers
import { handleGbpNotification } from '#/contexts/integration/infrastructure/handlers/gbp-notification-handler'

const pubSubBodySchema = z.object({
  message: z
    .object({
      data: z.string(),
      attributes: z.record(z.string(), z.string()).optional(),
      messageId: z.string().optional(),
    })
    .optional(),
})
const gbpNotificationPayloadSchema = z.object({
  locationName: z.string(),
  reviewName: z.string(),
})

/**
 * Warn-once latch for the unpinned-identity posture. A per-request warn would
 * be one line per Pub/Sub delivery; the posture is process-lifetime constant,
 * so once is the whole signal.
 */
let warnedUnpinnedPusher = false

/** The three facts the notification handler needs out of a push envelope. */
type GbpPushNotification = Readonly<{
  locationId: string
  locationName: string
  messageId: string
}>

/**
 * Authenticate a Pub/Sub push. Returns the 401 Response to send, or null when
 * the push is genuine.
 *
 * Audience verification alone accepts ANY Google-issued OIDC token minted for
 * our audience — including one from an unrelated GCP project — because Google
 * is the issuer for all of them. The subscription's push service account is
 * the only thing that distinguishes our publisher, so when it is configured a
 * mismatch is a forged/misrouted push and gets the same 401 as a bad signature.
 */
async function rejectInauthenticPush(
  request: Request,
  env: Env,
  logger: pino.Logger,
): Promise<Response | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json(
      {
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      },
      { status: 401 },
    )
  }

  const token = authHeader.slice(7)
  const audience = env.GBP_PUBSUB_AUDIENCE ?? 'https://reputationkey.app/webhooks/gbp'
  const verified = await verifyPubSubJwt(token, audience)

  const expectedPusher = env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT
  if (!expectedPusher) {
    if (!warnedUnpinnedPusher) {
      warnedUnpinnedPusher = true
      logger.warn(
        { envVar: 'GBP_PUBSUB_PUSH_SERVICE_ACCOUNT' },
        'GBP webhook pushing identity is unpinned; any Google-issued OIDC token for this audience is accepted',
      )
    }
    return null
  }

  if (verified.email !== expectedPusher) {
    // BQC-1.6: neither the presented nor the expected email is logged —
    // both are identities. Booleans are enough to tell "wrong service
    // account" from "no email claim at all".
    logger.warn(
      { hasEmailClaim: verified.email !== '' },
      'Webhook rejected: Pub/Sub push identity does not match GBP_PUBSUB_PUSH_SERVICE_ACCOUNT',
    )
    return Response.json(
      { error: 'Unauthorized', message: 'Unrecognized Pub/Sub push identity' },
      { status: 401 },
    )
  }

  return null
}

/**
 * Decode the push envelope down to the notification facts. Returns the 400
 * Response to send when the envelope is structurally present but unusable, or
 * the decoded notification.
 *
 * A bad JSON body or base64 blob throws (SyntaxError/ZodError) rather than
 * returning; the caller maps those to the same 400.
 */
async function readPushNotification(
  request: Request,
  logger: pino.Logger,
): Promise<Response | GbpPushNotification> {
  const body = pubSubBodySchema.parse(await request.json())

  if (!body.message?.data) {
    // BQC-1.6: no raw body in logs — the data blob carries GBP resource
    // names (provider identifiers). Message ID only.
    logger.warn(
      { messageId: body.message?.messageId },
      'Webhook received malformed message — missing message.data',
    )
    return Response.json(
      {
        error: 'Bad Request',
        message: 'Missing message.data in Pub/Sub payload',
      },
      { status: 400 },
    )
  }

  const payload = gbpNotificationPayloadSchema.parse(
    JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf-8')),
  )

  if (!payload.locationName || !payload.reviewName) {
    // BQC-1.6: no decoded payload in logs — booleans only.
    logger.warn(
      {
        hasLocationName: Boolean(payload.locationName),
        hasReviewName: Boolean(payload.reviewName),
      },
      'Webhook received incomplete notification',
    )
    return Response.json(
      {
        error: 'Bad Request',
        message: 'Missing locationName or reviewName in notification payload',
      },
      { status: 400 },
    )
  }

  // Extract locationId from locationName
  const locationId = payload.locationName.split('/').pop()
  if (!locationId) {
    // BQC-1.6: no GBP resource name in logs.
    logger.warn('Could not extract location ID from notification')
    return Response.json(
      { error: 'Bad Request', message: 'Invalid locationName format' },
      { status: 400 },
    )
  }

  return {
    locationId,
    locationName: payload.locationName,
    messageId: body.message.messageId ?? 'unknown',
  }
}

/**
 * POST handler for GBP Pub/Sub push notifications. Extracted from the Route
 * definition so it is directly testable without spinning up the TanStack route
 * tree. The route delegates here.
 *
 * Flow: verify JWT → pin the pushing service account → parse push payload →
 * extract locationId → delegate to handleGbpNotification. Failures are
 * status-coded: forged/expired JWT and a wrong pushing identity → 401,
 * malformed payload → 400, anything else → 500, so a transient DB failure is
 * distinguishable from a probing client in logs/metrics.
 */
export async function handleGbpWebhookPost(request: Request): Promise<Response> {
  return trace('webhook.gbpNotifications', async () => {
    const logger = getLogger()
    const env = getEnv()

    try {
      // 1. Verify the JWT and pin the pushing identity
      const rejection = await rejectInauthenticPush(request, env, logger)
      if (rejection) return rejection

      // 2. Parse the push message and extract locationId
      const notification = await readPushNotification(request, logger)
      if (notification instanceof Response) return notification

      // 3. Delegate business logic to server function
      const result = await handleGbpNotification(notification)

      // 2xx acknowledges receipt — Pub/Sub will not retry this message.
      return Response.json({ ok: true, enqueued: result.enqueued }, { status: 200 })
    } catch (err) {
      // JWT verification failure (forged token, bad signature, expired, wrong
      // audience) → 401. Distinguishing this from a transient DB failure is the
      // difference between "someone is probing the endpoint" and "we're down".
      if (err instanceof JOSEError) {
        logger.warn({ err }, 'Webhook JWT verification failed')
        return Response.json(
          { error: 'Unauthorized', message: 'Invalid or expired Pub/Sub JWT' },
          { status: 401 },
        )
      }
      // Malformed push payload (bad JSON body, bad base64 decode, missing fields)
      // → 400. SyntaxError covers request.json() + JSON.parse of the decoded data;
      // ZodError covers schema validation of either layer.
      if (err instanceof ZodError || err instanceof SyntaxError) {
        logger.warn({ err }, 'Webhook received malformed payload')
        return Response.json(
          { error: 'Bad Request', message: 'Malformed webhook payload' },
          { status: 400 },
        )
      }
      // Only true internal errors (DB down, job queue failure, etc.) reach 500.
      logger.error({ err }, 'Webhook processing failed')
      return Response.json(
        {
          error: 'Internal Server Error',
          message: 'Unexpected error processing webhook notification',
        },
        { status: 500 },
      )
    }
  })
}

export const Route = createFileRoute('/api/webhooks/gbp/notifications')({
  server: {
    handlers: {
      POST: ({ request }) => handleGbpWebhookPost(request),
    },
  },
})
