import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { match } from 'ts-pattern'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { throwContextError } from '#/shared/auth/server-errors'
import { ratingInputSchema } from '../application/dto/rating.dto'
import { feedbackInputSchema } from '../application/dto/feedback.dto'
import { isGuestError } from '../domain/errors'
import type { GuestErrorCode } from '../domain/errors'
export type { PublicPortalLoaderData } from '../application/dto/public-portal.dto'
import { portalId, ratingId } from '#/shared/domain/ids'
import { getEnv } from '#/shared/config/env'
import { createHash } from 'crypto'

// ── Error → HTTP status mapping (exhaustive) ──────────────────────

const guestErrorStatus = (code: GuestErrorCode): number =>
  match(code)
    .with('rate_limit_exceeded', () => 429)
    .with(
      'invalid_rating',
      'duplicate_rating',
      'feedback_too_long',
      'feedback_empty',
      'invalid_source',
      'invalid_session',
      () => 400,
    )
    .with('portal_not_found', () => 404)
    .with('portal_inactive', () => 410)
    .exhaustive()

// ── Helpers ───────────────────────────────────────────────────────

function hashIp(ip: string): string {
  const env = getEnv()
  const today = new Date().toISOString().slice(0, 10)
  const salt = `${env.GUEST_SESSION_SALT}:${today}`
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex')
}

// ── getPublicPortal ────────────────────────────────────────────────

const publicPortalSchema = z.object({
  propertySlug: z.string().min(1),
  portalSlug: z.string().min(1),
})

export const getPublicPortal = createServerFn({ method: 'GET' })
  .inputValidator(publicPortalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases } = getContainer()
        try {
          return await useCases.getPublicPortal({
            propertySlug: data.propertySlug,
            portalSlug: data.portalSlug,
          })
        } catch (e) {
          if (isGuestError(e))
            throwContextError('GuestError', e, guestErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'guest.getPublicPortal',
    ),
  )

// ── submitRating ───────────────────────────────────────────────────

export const submitRatingFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases, rateLimiter } = getContainer()
        const headers = headersFromContext()

        const cookieHeader = headers?.get('cookie') ?? ''
        const sessionId =
          cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()

        const rateResult = await rateLimiter.check(`rating:${sessionId}`)
        if (!rateResult.allowed) {
          throwContextError(
            'GuestError',
            { code: 'rate_limit_exceeded', message: 'Too many requests' },
            429,
          )
        }

        const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const ipHash = hashIp(ip)

        const ctx = await useCases.resolvePortalContext({
          portalId: portalId(data.portalId),
        })

        try {
          const rating = await useCases.submitRating({
            organizationId: ctx.organizationId,
            portalId: portalId(data.portalId),
            propertyId: ctx.propertyId,
            sessionId,
            value: data.value,
            source: data.source,
            ipHash,
          })
          return { success: true, ratingId: rating.id }
        } catch (e) {
          if (isGuestError(e))
            throwContextError('GuestError', e, guestErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'guest.submitRating',
    ),
  )

// ── submitFeedback ─────────────────────────────────────────────────

export const submitFeedbackFn = createServerFn({ method: 'POST' })
  .inputValidator(feedbackInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        // Honeypot check
        if (data.honeypot) {
          return { success: true, blocked: true }
        }

        const { useCases, rateLimiter } = getContainer()
        const headers = headersFromContext()

        const cookieHeader = headers?.get('cookie') ?? ''
        const sessionId =
          cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()

        const rateResult = await rateLimiter.check(`feedback:${sessionId}`)
        if (!rateResult.allowed) {
          throwContextError(
            'GuestError',
            { code: 'rate_limit_exceeded', message: 'Too many requests' },
            429,
          )
        }

        const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const ipHash = hashIp(ip)

        const ctx = await useCases.resolvePortalContext({
          portalId: portalId(data.portalId),
        })

        try {
          const fb = await useCases.submitFeedback({
            organizationId: ctx.organizationId,
            portalId: portalId(data.portalId),
            propertyId: ctx.propertyId,
            sessionId,
            comment: data.comment,
            source: data.source,
            ipHash,
            ratingId: data.ratingId ? ratingId(data.ratingId) : undefined,
          })
          return { success: true, feedbackId: fb.id }
        } catch (e) {
          if (isGuestError(e))
            throwContextError('GuestError', e, guestErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'guest.submitFeedback',
    ),
  )

// ── resolveLinkAndTrack ───────────────────────────────────────────
// Resolves a portal link to its redirect URL and tracks the click.
// Used by the public click-tracking API route.

const resolveLinkSchema = z.object({
  linkId: z.string().min(1),
})

export const resolveLinkAndTrack = createServerFn({ method: 'GET' })
  .inputValidator(resolveLinkSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases } = getContainer()
        return await useCases.resolveLinkAndTrack({ linkId: data.linkId })
      },
      'GET',
      'guest.resolveLinkAndTrack',
    ),
  )
