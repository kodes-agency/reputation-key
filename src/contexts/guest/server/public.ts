// Guest context — rating & feedback submission server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { ratingInputSchema } from '../application/dto/rating.dto'
import { feedbackInputSchema } from '../application/dto/feedback.dto'
import { isGuestError } from '../domain/errors'
export type { PublicPortalLoaderData } from '../application/dto/public-portal.dto'
import { portalId, ratingId } from '#/shared/domain/ids'
import { guestErrorStatus, hashIp } from './guest-scans'

// ── submitRating ───────────────────────────────────────────────────

export const submitRatingFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases, rateLimiter } = getContainer()
        const headers = await headersFromContext()

        const cookieHeader = headers?.get('cookie') ?? ''
        // F065 NOTE: sessionId is extracted from cookie or generated. The generated
        // ID is used for rate limiting and analytics but is NOT set as a response cookie
        // here — that's handled by the guest-scans server function where session init happens.
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
          throw catchUntagged(e)
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
        const headers = await headersFromContext()

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
          throw catchUntagged(e)
        }
      },
      'POST',
      'guest.submitFeedback',
    ),
  )

// ── Re-exports from split files ────────────────────────────────────

export { recordScanFn, getPublicPortal, resolveLinkAndTrack } from './guest-scans'
