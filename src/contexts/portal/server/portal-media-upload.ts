// Portal context — the image upload endpoint (POST /api/portal-media).
//
// The HTTP edge of the ingest. The body is the raw image, not a form: a
// browser cannot send `Content-Type: image/*` cross-origin without a preflight
// we never answer, which is half of the CSRF defence; the other half is the
// explicit same-origin check below. The cheap refusals run in order and before
// the body is read at all: origin, session, the `portal.upload` capability for
// this Property, then the rate allowance. Only then are the bytes read, counted
// as they arrive, and handed to the ingest, which decodes and re-encodes them.
//
// Nothing about the store reaches the response: no object key, no bucket, no
// provider message. Errors are a code and, for a refused image, its reason.

import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import { getEnv } from '#/shared/config/env'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  PORTAL_MEDIA_MAX_UPLOAD_BYTES,
  PORTAL_MEDIA_PURPOSES,
  type PortalMediaPurpose,
} from '#/shared/domain/portal-media'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { readBoundedBody } from '#/shared/security/read-bounded-body'
import {
  portalImagePermission,
  type IngestPortalImage,
} from '../application/use-cases/ingest-portal-image'
import { isPortalError, type PortalError } from '../domain/errors'
import type { PortalImageRejectionReason } from '../domain/portal-image-policy'
import { portalErrorStatus } from './portals'

const ACTOR_LIMIT = Object.freeze({ maxRequests: 30, windowSeconds: 60 * 60 })
const ORGANIZATION_LIMIT = Object.freeze({
  maxRequests: 200,
  windowSeconds: 24 * 60 * 60,
})

const querySchema = z.object({
  propertyId: z.uuid(),
  purpose: z.enum(PORTAL_MEDIA_PURPOSES),
  portalId: z.uuid().optional(),
  // Anything but a plain true or false is a malformed request; a false (or a
  // missing flag) is the use case's to refuse with its own reason.
  rightsConfirmed: z.enum(['true', 'false']).optional(),
})

export type PortalMediaUploadDeps = Readonly<{
  /** The origin the app is served from; the only origin an upload may come from. */
  appOrigin: string
  resolveContext: (headers: Headers) => Promise<AuthContext>
  /** Throws a tagged auth error when `portal.upload` is not available for this Property. */
  requireUploadAllowed: (
    ctx: AuthContext,
    propertyId: string,
    purpose: PortalMediaPurpose,
  ) => Promise<void>
  rateLimiter: RateLimiter
  clock: () => Date
  ingest: IngestPortalImage
  logger: Pick<LoggerPort, 'info' | 'warn' | 'error'>
}>

const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Whether the request came from this app's own pages. A browser states it in
 * `Sec-Fetch-Site`, which a page cannot forge; a client that sends no such
 * header must send an `Origin` that is the app.
 */
export function isSameOriginRequest(headers: Headers, appOrigin: string): boolean {
  const site = headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin'
  const origin = headers.get('origin')
  return origin !== null && origin !== 'null' && originOf(origin) === originOf(appOrigin)
}

const NO_STORE = { 'cache-control': 'no-store' } as const

const respond = (
  status: number,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
): Response => Response.json(body, { status, headers: { ...NO_STORE, ...headers } })

const IMAGE_REJECTION_STATUS: Readonly<Record<PortalImageRejectionReason, number>> = {
  too_large: 413,
  unsupported_type: 415,
  type_mismatch: 415,
  rights_not_confirmed: 400,
  asset_limit_reached: 409,
  empty: 422,
  animated: 422,
  too_many_pixels: 422,
  too_small: 422,
  extreme_aspect: 422,
  undecodable: 422,
  output_too_large: 422,
}

function portalErrorResponse(error: PortalError): Response {
  if (error.code === 'image_rejected') {
    const reason = error.context?.reason as PortalImageRejectionReason | undefined
    const status = (reason && IMAGE_REJECTION_STATUS[reason]) ?? 422
    return respond(status, { error: 'image_rejected', ...(reason ? { reason } : {}) })
  }
  return respond(portalErrorStatus(error.code), { error: error.code })
}

export const createPortalMediaUploadHandler =
  (deps: PortalMediaUploadDeps) =>
  async (request: Request): Promise<Response> => {
    try {
      return await handle(deps, request)
    } catch (error) {
      if (isServerFunctionError(error)) {
        return respond(error.status, { error: error.code })
      }
      if (isPortalError(error)) return portalErrorResponse(error)
      // The 500 is answered, not thrown, so nothing upstream would report it.
      // The error is not tenant content; the image bytes never reach it.
      deps.logger.error(
        { err: error, errorCode: 'portal_media_upload_failed' },
        'Portal media upload failed',
      )
      captureObservabilityException(error, { source: 'nitro' })
      return respond(500, { error: 'internal_error' })
    }
  }

async function handle(deps: PortalMediaUploadDeps, request: Request): Promise<Response> {
  if (!isSameOriginRequest(request.headers, deps.appOrigin)) {
    return respond(403, { error: 'cross_origin' })
  }
  const ctx = await deps.resolveContext(request.headers)

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return respond(400, { error: 'invalid_request' })
  const query = parsed.data

  // The capability before the rate allowance: a switched-off feature must not
  // spend anyone's budget, and before the body: nothing is read for a refusal.
  await deps.requireUploadAllowed(ctx, query.propertyId, query.purpose)
  const refused = await refusedByRateLimit(deps, ctx)
  if (refused) return refused

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > PORTAL_MEDIA_MAX_UPLOAD_BYTES) {
    return respond(413, { error: 'image_rejected', reason: 'too_large' })
  }
  const body = await readBoundedBody(request, PORTAL_MEDIA_MAX_UPLOAD_BYTES)
  if (body.kind === 'too_large') {
    return respond(413, { error: 'image_rejected', reason: 'too_large' })
  }
  if (body.kind === 'failed') return respond(400, { error: 'body_unreadable' })

  const asset = await deps.ingest(
    {
      propertyId: query.propertyId,
      ...(query.portalId ? { portalId: query.portalId } : {}),
      purpose: query.purpose,
      declaredContentType: request.headers.get('content-type') ?? '',
      bytes: body.bytes,
      rightsConfirmed: query.rightsConfirmed === 'true',
    },
    ctx,
  )
  deps.logger.info(
    { assetId: asset.assetId, purpose: asset.purpose },
    'Portal media stored',
  )
  return respond(201, { asset })
}

async function refusedByRateLimit(
  deps: Pick<PortalMediaUploadDeps, 'rateLimiter' | 'clock'>,
  ctx: AuthContext,
): Promise<Response | null> {
  const checks = [
    [`portal-media:actor:${ctx.userId}`, ACTOR_LIMIT],
    [`portal-media:organization:${ctx.organizationId}`, ORGANIZATION_LIMIT],
  ] as const
  for (const [key, limit] of checks) {
    const result = await deps.rateLimiter.check(key, limit)
    if (result.allowed) continue
    if (result.backendStatus === 'unavailable') {
      return respond(503, { error: 'rate_limit_unavailable' })
    }
    const retryAfter = Math.max(
      1,
      Math.ceil((result.resetAt.getTime() - deps.clock().getTime()) / 1000),
    )
    return respond(429, { error: 'rate_limited' }, { 'retry-after': String(retryAfter) })
  }
  return null
}

/** The handler wired to the running app. Built per request: configuration is read when used. */
export const handlePortalMediaUpload = (request: Request): Promise<Response> => {
  const container = getContainer()
  return createPortalMediaUploadHandler({
    appOrigin: getEnv().BETTER_AUTH_URL,
    resolveContext: resolveTenantContext,
    requireUploadAllowed: (ctx, propertyId, purpose) =>
      requireExecutionAllowed({
        actor: ctx,
        action: portalImagePermission(purpose),
        capability: 'portal.upload',
        propertyId,
      }),
    rateLimiter: container.rateLimiter,
    clock: container.clock,
    ingest: container.portalPublicApi.management.ingestPortalImage,
    logger: container.logger,
  })(request)
}
