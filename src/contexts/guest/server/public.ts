// Guest context — rating & feedback submission server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { assertGlobalCapability } from '#/shared/auth/beta-capabilities'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { ratingInputSchema } from '../application/dto/rating.dto'
import { feedbackInputSchema } from '../application/dto/feedback.dto'
import { isGuestError } from '../domain/errors'
export type { PublicPortalLoaderData } from '../application/dto/public-portal.dto'
import { portalId, ratingId } from '#/shared/domain/ids'
import { guestErrorStatus } from './guest-scans'
import { hashIp } from './hash-ip.server'
import { resolveGuestSession, guestRateLimitKey } from './guest-session'

// ── submitRating ───────────────────────────────────────────────────

export const submitRatingFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        assertGlobalCapability('portal.read')
        const { useCases, rateLimiter } = getContainer()
        const headers = await headersFromContext()

        const cookieHeader = headers?.get('cookie') ?? ''
        // Resolve the guest session: reuse the cookie if present, otherwise mint
        // a fresh id AND set it as an HttpOnly cookie so the client carries it on
        // subsequent requests (cannot be done client-side; HttpOnly is required by
        // the guest CONTEXT.md invariant).
        const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const ipHash = hashIp(ip)
        const session = resolveGuestSession(cookieHeader)

        // Key on the session id when the cookie is present; fall back to the IP
        // hash when cookieless so omitting the cookie cannot yield a fresh,
        // unthrottled bucket on every request.
        const rateResult = await rateLimiter.check(
          guestRateLimitKey('rating', session, ipHash),
        )
        if (!rateResult.allowed) {
          throwContextError(
            'GuestError',
            { code: 'rate_limit_exceeded', message: 'Too many requests' },
            429,
          )
        }

        const ctx = await useCases.resolvePortalContext({
          portalId: portalId(data.portalId),
        })

        try {
          const rating = await useCases.submitRating({
            organizationId: ctx.organizationId,
            portalId: portalId(data.portalId),
            propertyId: ctx.propertyId,
            sessionId: session.sessionId,
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

        assertGlobalCapability('portal.read')
        const { useCases, rateLimiter } = getContainer()
        const headers = await headersFromContext()

        const cookieHeader = headers?.get('cookie') ?? ''
        const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const ipHash = hashIp(ip)
        // Reuse the cookie session if present, otherwise mint a fresh id AND
        // set it as an HttpOnly cookie (see submitRating for full rationale).
        const session = resolveGuestSession(cookieHeader)

        // Session-keyed when the cookie is present; IP-hash fallback when
        // cookieless so omitting the cookie cannot bypass throttling.
        const rateResult = await rateLimiter.check(
          guestRateLimitKey('feedback', session, ipHash),
        )
        if (!rateResult.allowed) {
          throwContextError(
            'GuestError',
            { code: 'rate_limit_exceeded', message: 'Too many requests' },
            429,
          )
        }

        const ctx = await useCases.resolvePortalContext({
          portalId: portalId(data.portalId),
        })

        try {
          const fb = await useCases.submitFeedback({
            organizationId: ctx.organizationId,
            portalId: portalId(data.portalId),
            propertyId: ctx.propertyId,
            sessionId: session.sessionId,
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
