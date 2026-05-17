// Integration context — GBP Pub/Sub webhook endpoint
// Per architecture: integration owns the webhook route. Parses notification,
// resolves property, enqueues review sync job.
// No auth guard — JWT verification is manual (Google Pub/Sub push format).

import { createFileRoute } from '@tanstack/react-router'
import { verifyPubSubJwt } from '#/shared/auth/pubsub-jwt.verifier'
import { getContainer } from '#/composition'
import { getDb } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getLogger } from '#/shared/observability/logger'
import { getEnv } from '#/shared/config/env'

export const Route = createFileRoute('/api/webhooks/gbp/notifications')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const logger = getLogger()
        const env = getEnv()

        try {
          // 1. Extract bearer token
          const authHeader = request.headers.get('Authorization')
          if (!authHeader?.startsWith('Bearer ')) {
            return Response.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, { status: 401 })
          }

          // 2. Verify JWT
          const token = authHeader.slice(7)
          const audience = env.GBP_PUBSUB_AUDIENCE ?? 'https://reputationkey.app/webhooks/gbp'
          await verifyPubSubJwt(token, audience)

          // 3. Parse Pub/Sub push message
          const body = await request.json() as {
            message?: {
              data: string // base64-encoded
              attributes?: Record<string, string>
              messageId: string
            }
            subscription: string
          }

          if (!body.message?.data) {
            logger.warn({ body }, 'Webhook received malformed message — missing message.data')
            return Response.json({ error: 'Bad Request', message: 'Missing message.data in Pub/Sub payload' }, { status: 400 })
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
            return Response.json({ error: 'Bad Request', message: 'Missing locationName or reviewName in notification payload' }, { status: 400 })
          }

          // 4. Resolve property by gbpPlaceId (last segment of locationName)
          const locationId = payload.locationName.split('/').pop()
          if (!locationId) {
            logger.warn({ locationName: payload.locationName }, 'Could not extract location ID')
            return Response.json({ error: 'Bad Request', message: 'Invalid locationName format' }, { status: 400 })
          }

          const db = getDb()
          const propertyRows = await db
            .select()
            .from(properties)
            .where(
              and(
                eq(properties.gbpPlaceId, locationId),
                isNull(properties.deletedAt),
              ),
            )
            .limit(1)

          const property = propertyRows[0]
          if (!property || !property.googleConnectionId) {
            logger.info(
              { locationId },
              'Webhook notification for unknown or deleted property — ignoring',
            )
            // Return 200 to prevent Pub/Sub retry
            return Response.json({ ok: true }, { status: 200 })
          }

          // 5. Enqueue sync job with replay deduplication via messageId-based jobId
          const container = getContainer()
          const queue = container.jobQueue
          if (!queue) {
            logger.error('Job queue unavailable — Redis not configured')
            return Response.json({ error: 'Service Unavailable', message: 'Job queue unavailable — Redis not configured' }, { status: 503 })
          }

          // Use messageId as jobId to deduplicate Pub/Sub retries.
          // BullMQ will silently skip if a job with this ID already exists.
          await queue.add('sync-property-reviews', {
            propertyId: property.id,
            organizationId: property.organizationId,
            connectionId: property.googleConnectionId,
            locationName: payload.locationName,
          }, {
            jobId: `webhook:${body.message.messageId}`,
            attempts: 3,
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
          })

          logger.info(
            {
              propertyId: property.id,
              eventType: payload.eventType,
              reviewName: payload.reviewName,
              messageId: body.message.messageId,
            },
            'Webhook enqueued review sync',
          )

          return Response.json({ ok: true }, { status: 200 })
        } catch (err) {
          logger.error({ err }, 'Webhook processing failed')
          return Response.json({ error: 'Internal Server Error', message: 'Unexpected error processing webhook notification' }, { status: 500 })
        }
      },
    },
  },
})
