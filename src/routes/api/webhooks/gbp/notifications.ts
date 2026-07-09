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
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
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
 * POST handler for GBP Pub/Sub push notifications. Extracted from the Route
 * definition so it is directly testable without spinning up the TanStack route
 * tree. The route delegates here.
 *
 * Flow: verify JWT → parse push payload → extract locationId → delegate to
 * handleGbpNotification. Failures are status-coded: forged/expired JWT → 401,
 * malformed payload → 400, anything else → 500, so a transient DB failure is
 * distinguishable from a probing client in logs/metrics.
 */
export async function handleGbpWebhookPost(request: Request): Promise<Response> {
  return trace('webhook.gbpNotifications', async () => {
    const logger = getLogger()
    const env = getEnv()

    try {
      // 1. Verify JWT from Google Pub/Sub push
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
      await verifyPubSubJwt(token, audience)

      // 2. Parse Pub/Sub push message
      const body = pubSubBodySchema.parse(await request.json())

      if (!body.message?.data) {
        logger.warn({ body }, 'Webhook received malformed message — missing message.data')
        return Response.json(
          {
            error: 'Bad Request',
            message: 'Missing message.data in Pub/Sub payload',
          },
          { status: 400 },
        )
      }

      const payload = gbpNotificationPayloadSchema.parse(
        JSON.parse(Buffer.from(body.message!.data, 'base64').toString('utf-8')),
      )

      if (!payload.locationName || !payload.reviewName) {
        logger.warn({ payload }, 'Webhook received incomplete notification')
        return Response.json(
          {
            error: 'Bad Request',
            message: 'Missing locationName or reviewName in notification payload',
          },
          { status: 400 },
        )
      }

      // 3. Extract locationId from locationName
      const locationId = payload.locationName.split('/').pop()
      if (!locationId) {
        logger.warn(
          { locationName: payload.locationName },
          'Could not extract location ID',
        )
        return Response.json(
          { error: 'Bad Request', message: 'Invalid locationName format' },
          { status: 400 },
        )
      }

      // 4. Delegate business logic to server function
      const result = await handleGbpNotification({
        locationId,
        locationName: payload.locationName,
        messageId: body.message?.messageId ?? 'unknown',
      })

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
