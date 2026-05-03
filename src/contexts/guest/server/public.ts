import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { ratingInputSchema } from '../application/dto/rating.dto'
import { feedbackInputSchema } from '../application/dto/feedback.dto'
import { isGuestError, guestError } from '../domain/errors'
import { portalId, ratingId } from '#/shared/domain/ids'
import { getEnv } from '#/shared/config/env'
import { createHash } from 'crypto'

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
  .handler(async ({ data }) => {
    const { useCases } = getContainer()
    return useCases.getPublicPortal({
      propertySlug: data.propertySlug,
      portalSlug: data.portalSlug,
    })
  })

// ── submitRating ───────────────────────────────────────────────────

export const submitRatingFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingInputSchema)
  .handler(async ({ data }) => {
    const { useCases, rateLimiter } = getContainer()
    const headers = headersFromContext()

    const cookieHeader = headers?.get('cookie') ?? ''
    const sessionId =
      cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()

    const rateResult = await rateLimiter.check(`rating:${sessionId}`)
    if (!rateResult.allowed) {
      throw guestError('rate_limit_exceeded', 'Too many requests')
    }

    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    const ctx = await useCases.resolvePortalContext({ portalId: portalId(data.portalId) })

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
      if (isGuestError(e)) throw e
      throw e
    }
  })

// ── submitFeedback ─────────────────────────────────────────────────

export const submitFeedbackFn = createServerFn({ method: 'POST' })
  .inputValidator(feedbackInputSchema)
  .handler(async ({ data }) => {
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
      throw guestError('rate_limit_exceeded', 'Too many requests')
    }

    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    const ctx = await useCases.resolvePortalContext({ portalId: portalId(data.portalId) })

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
      if (isGuestError(e)) throw e
      throw e
    }
  })
