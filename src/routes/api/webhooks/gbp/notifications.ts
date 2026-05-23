// Integration context — GBP Pub/Sub webhook endpoint
// Per architecture: the route is thin — it verifies the JWT (API endpoint concern),
// parses the push payload, extracts locationId, then delegates to the server function.
// No auth guard — JWT verification is manual (Google Pub/Sub push format).
// Webhook routes are exempt from the "no direct infrastructure import" rule — see src/routes/CONTEXT.md

import { createFileRoute } from '@tanstack/react-router'
import { verifyPubSubJwt } from '#/shared/auth/pubsub-jwt.verifier'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
// eslint-disable-next-line boundaries/dependencies -- webhook routes delegate directly to context handlers
import { handleGbpNotification } from '#/contexts/integration/infrastructure/handlers/gbp-notification-handler'

export const Route = createFileRoute('/api/webhooks/gbp/notifications')({
  server: {
    handlers: {
      POST: async ({ request }) =>
        trace('webhook.gbpNotifications', async () => {
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
            const audience =
              env.GBP_PUBSUB_AUDIENCE ?? 'https://reputationkey.app/webhooks/gbp'
            await verifyPubSubJwt(token, audience)

            // 2. Parse Pub/Sub push message
            const body = (await request.json()) as {
              message?: {
                data: string // base64-encoded
                attributes?: Record<string, string>
                messageId: string
              }
              subscription: string
            }

            if (!body.message?.data) {
              logger.warn(
                { body },
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

            const payload = JSON.parse(
              Buffer.from(body.message.data, 'base64').toString('utf-8'),
            ) as {
              locationName?: string
              reviewName?: string
              accountName?: string
              eventType?: 'REVIEW_UPDATED' | 'NEW_REVIEW'
            }

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
              messageId: body.message.messageId,
            })

            // Always return 200 to prevent Pub/Sub retry
            return Response.json({ ok: true, enqueued: result.enqueued }, { status: 200 })
          } catch (err) {
            logger.error({ err }, 'Webhook processing failed')
            return Response.json(
              {
                error: 'Internal Server Error',
                message: 'Unexpected error processing webhook notification',
              },
              { status: 500 },
            )
          }
        }),
    },
  },
})
