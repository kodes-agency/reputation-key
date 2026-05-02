import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { ratingInputSchema } from '../application/dto/rating.dto'
import { feedbackInputSchema } from '../application/dto/feedback.dto'
import { isGuestError, guestError } from '../domain/errors'
import { organizationId, propertyId, portalId, ratingId } from '#/shared/domain/ids'
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
    const { db } = getContainer()
    const { portals, portalLinkCategories, portalLinks } =
      await import('#/shared/db/schema/portal.schema')
    const { properties } = await import('#/shared/db/schema/property.schema')
    const { eq, and } = await import('drizzle-orm')
    const { sql } = await import('drizzle-orm')

    // Find portal by property + slug
    // Organization table is managed by Better Auth (not in Drizzle schema),
    // so we query it via raw SQL for the org name.
    const portalRows = await db
      .select()
      .from(portals)
      .innerJoin(properties, eq(portals.propertyId, properties.id))
      .where(
        and(eq(properties.slug, data.propertySlug), eq(portals.slug, data.portalSlug)),
      )
      .limit(1)

    if (portalRows.length === 0) {
      throw guestError('portal_not_found', 'Portal not found')
    }

    const portal = portalRows[0].portals

    // Check if portal is active
    if (!portal.isActive) {
      throw guestError('portal_inactive', 'Portal is inactive')
    }

    // Get org name via raw query
    const orgResult = await db.execute(
      sql`SELECT id, name FROM "organization" WHERE id = ${portal.organizationId} LIMIT 1`,
    )
    const org = orgResult.rows[0] as { id: string; name: string } | undefined

    if (!org) {
      throw guestError('portal_not_found', 'Organization not found')
    }

    // Load link categories and links
    const categories = await db
      .select()
      .from(portalLinkCategories)
      .where(eq(portalLinkCategories.portalId, portal.id))
      .orderBy(portalLinkCategories.sortKey)

    const links = await db
      .select()
      .from(portalLinks)
      .where(eq(portalLinks.portalId, portal.id))
      .orderBy(portalLinks.sortKey)

    return {
      portal: {
        id: portal.id,
        name: portal.name,
        slug: portal.slug,
        description: portal.description,
        heroImageUrl: portal.heroImageUrl,
        theme: portal.theme as Record<string, string | number | boolean | null> | null,
        smartRoutingEnabled: portal.smartRoutingEnabled,
        smartRoutingThreshold: portal.smartRoutingThreshold,
        organizationName: org.name,
      },
      categories,
      links,
      organizationId: org.id,
      propertyId: portal.propertyId,
    }
  })

// ── submitRating ───────────────────────────────────────────────────

export const submitRatingFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingInputSchema)
  .handler(async ({ data }) => {
    const { useCases, db } = getContainer()
    const headers = headersFromContext()

    const cookieHeader = headers?.get('cookie') ?? ''
    const sessionId =
      cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()

    const { rateLimiter } = getContainer()
    const rateResult = await rateLimiter.check(`rating:${sessionId}`)
    if (!rateResult.allowed) {
      throw guestError('rate_limit_exceeded', 'Too many requests')
    }

    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    const portalData = await db.query.portals.findFirst({
      where: (portals, { eq }) => eq(portals.id, data.portalId),
    })

    if (!portalData) {
      throw guestError('portal_not_found', 'Portal not found')
    }

    try {
      const rating = await useCases.submitRating({
        organizationId: organizationId(portalData.organizationId),
        portalId: portalId(data.portalId),
        propertyId: propertyId(portalData.propertyId),
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

    const { useCases, db } = getContainer()
    const headers = headersFromContext()

    const cookieHeader = headers?.get('cookie') ?? ''
    const sessionId =
      cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()

    const { rateLimiter } = getContainer()
    const rateResult = await rateLimiter.check(`feedback:${sessionId}`)
    if (!rateResult.allowed) {
      throw guestError('rate_limit_exceeded', 'Too many requests')
    }

    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    const portalData = await db.query.portals.findFirst({
      where: (portals, { eq }) => eq(portals.id, data.portalId),
    })

    if (!portalData) {
      throw guestError('portal_not_found', 'Portal not found')
    }

    try {
      const fb = await useCases.submitFeedback({
        organizationId: organizationId(portalData.organizationId),
        portalId: portalId(data.portalId),
        propertyId: propertyId(portalData.propertyId),
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
