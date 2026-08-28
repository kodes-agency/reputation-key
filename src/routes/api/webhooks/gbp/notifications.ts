import { createFileRoute } from '@tanstack/react-router'
import { JOSEError } from 'jose/errors'
import type pino from 'pino'
import { z, ZodError } from 'zod/v4'
import { getContainer } from '#/composition'
import { verifyPubSubJwt } from '#/shared/auth/pubsub-jwt.verifier'
import type { Env } from '#/shared/config/env'
import { requestRuntimeConfig } from '#/shared/config/request-runtime-config'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import type { GoogleReviewPushNotificationKind } from '#/contexts/integration/application/public-api'

const MAX_ENCODED_DATA_LENGTH = 24 * 1024
const MAX_DECODED_DATA_BYTES = 16 * 1024
const isCanonicalBase64 = (value: string): boolean => {
  if (value.length % 4 !== 0) return false
  const decoded = Buffer.from(value, 'base64')
  return decoded.byteLength > 0 && decoded.toString('base64') === value
}

const pubSubBodySchema = z.object({
  message: z.object({
    data: z
      .string()
      .min(1)
      .max(MAX_ENCODED_DATA_LENGTH)
      .refine(isCanonicalBase64, 'Pub/Sub data must be canonical base64'),
    attributes: z.record(z.string().max(128), z.string().max(256)).optional(),
    messageId: z.string().trim().min(1).max(512).optional(),
    message_id: z.string().trim().min(1).max(512).optional(),
  }),
  subscription: z.string().min(1).max(512).optional(),
})
const gbpNotificationPayloadSchema = z.object({
  locationName: z.string().min(1).max(768),
  reviewName: z.string().min(1).max(1_024),
  type: z.string().max(64).optional(),
  notificationType: z.string().max(64).optional(),
})
const notificationKindSchema = z.enum(['NEW_REVIEW', 'UPDATED_REVIEW'])

type GbpPushNotification = Readonly<{
  topic: string
  messageId: string
  notificationKind: GoogleReviewPushNotificationKind
  locationId: string
  locationName: string
  reviewName: string
}>

async function rejectInauthenticPush(
  request: Request,
  env: Env,
  logger: pino.Logger,
): Promise<Response | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json(
      { error: 'Unauthorized', message: 'Missing or invalid Authorization header' },
      { status: 401 },
    )
  }
  if (!env.GBP_PUBSUB_TOPIC || !env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT) {
    logger.error(
      {
        hasTopic: Boolean(env.GBP_PUBSUB_TOPIC),
        hasPinnedPushIdentity: Boolean(env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT),
      },
      'GBP webhook is not configured for exact authenticated push delivery',
    )
    return Response.json(
      { error: 'Service Unavailable', message: 'GBP push delivery is not configured' },
      { status: 503 },
    )
  }

  const token = authHeader.slice(7)
  const audience = env.GBP_PUBSUB_AUDIENCE ?? 'https://reputationkey.app/webhooks/gbp'
  const verified = await verifyPubSubJwt(token, audience)
  if (!verified.emailVerified || verified.email !== env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT) {
    logger.warn(
      {
        hasEmailClaim: verified.email !== '',
        emailVerified: verified.emailVerified,
      },
      'Webhook rejected: Pub/Sub push identity is not the configured verified service account',
    )
    return Response.json(
      { error: 'Unauthorized', message: 'Unrecognized Pub/Sub push identity' },
      { status: 401 },
    )
  }
  return null
}

function notificationKind(
  payload: z.infer<typeof gbpNotificationPayloadSchema>,
  attributes: Readonly<Record<string, string>> | undefined,
): GoogleReviewPushNotificationKind {
  const candidate =
    payload.notificationType ??
    payload.type ??
    attributes?.notificationType ??
    attributes?.type
  // Google's published review notification resource shape identifies a
  // review but does not guarantee a kind field on every delivery. The topic
  // itself is configured to NEW_REVIEW/UPDATED_REVIEW only, so preserve the
  // honest combined kind when the delivery omits it.
  if (candidate === undefined) return 'REVIEW_CHANGED'
  return notificationKindSchema.parse(candidate)
}

async function readPushNotification(
  request: Request,
  env: Env,
): Promise<GbpPushNotification> {
  const body = pubSubBodySchema.parse(await request.json())
  const messageId = body.message.messageId ?? body.message.message_id
  if (!messageId) throw new TypeError('Pub/Sub messageId is required')
  const decoded = Buffer.from(body.message.data, 'base64')
  if (decoded.byteLength > MAX_DECODED_DATA_BYTES) {
    decoded.fill(0)
    throw new TypeError('GBP notification payload exceeds its byte limit')
  }
  let payload: z.infer<typeof gbpNotificationPayloadSchema>
  try {
    payload = gbpNotificationPayloadSchema.parse(JSON.parse(decoded.toString('utf8')))
  } finally {
    decoded.fill(0)
  }
  const resource = parseReviewProviderResource(payload.reviewName)
  const locationName = `accounts/${resource.accountId}/locations/${resource.locationId}`
  if (payload.locationName !== locationName) {
    throw new TypeError('Google review push resource mismatch')
  }
  return {
    topic: env.GBP_PUBSUB_TOPIC,
    messageId,
    notificationKind: notificationKind(payload, body.message.attributes),
    locationId: resource.locationId,
    locationName,
    reviewName: resource.name,
  }
}

export async function handleGbpWebhookPost(request: Request): Promise<Response> {
  return trace('webhook.gbpNotifications', async () => {
    const logger = getLogger()
    const env = requestRuntimeConfig().env
    try {
      const rejection = await rejectInauthenticPush(request, env, logger)
      if (rejection) return rejection
      const notification = await readPushNotification(request, env)
      const result =
        await getContainer().integrationWebhookRuntime.handleNotification(notification)
      return Response.json(
        { ok: true, duplicate: result.duplicate, handoff: result.handoff },
        { status: 200 },
      )
    } catch (error) {
      if (error instanceof JOSEError) {
        logger.warn({ error }, 'Webhook JWT verification failed')
        return Response.json(
          { error: 'Unauthorized', message: 'Invalid or expired Pub/Sub JWT' },
          { status: 401 },
        )
      }
      if (
        error instanceof ZodError ||
        error instanceof SyntaxError ||
        error instanceof TypeError
      ) {
        logger.warn(
          { errorType: error.constructor.name },
          'Webhook received malformed provider identifiers or payload',
        )
        return Response.json(
          { error: 'Bad Request', message: 'Malformed webhook payload' },
          { status: 400 },
        )
      }
      logger.error({ error }, 'Webhook durable acceptance failed')
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
  server: { handlers: { POST: ({ request }) => handleGbpWebhookPost(request) } },
})
