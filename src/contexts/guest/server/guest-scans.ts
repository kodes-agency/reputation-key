// Guest context — scan & public portal read server functions (split from public.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { isGuestError } from '../domain/errors'
import type { GuestErrorCode } from '../domain/errors'
import { portalId, portalLinkId } from '#/shared/domain/ids'
import { getEnv } from '#/shared/config/env'
import { createHash } from 'crypto'

// ── Error → HTTP status mapping (exhaustive) ──────────────────────

export const guestErrorStatus = (code: GuestErrorCode): number =>
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
    .with('portal_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('portal_inactive', () => 410)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .exhaustive()

// ── Helpers ───────────────────────────────────────────────────────

export function hashIp(ip: string): string {
  const env = getEnv()
  const today = new Date().toISOString().slice(0, 10)
  const salt = `${env.GUEST_SESSION_SALT}:${today}`
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex')
}

// ── recordScan ────────────────────────────────────────────────────

const recordScanSchema = z.object({
  portalId: z.string().min(1),
  source: z.enum(['qr', 'nfc', 'direct']),
})

export const recordScanFn = createServerFn({ method: 'POST' })
  .inputValidator(recordScanSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases } = getContainer()
        const headers = await headersFromContext()

        const cookieHeader = headers?.get('cookie') ?? ''
        const sessionId =
          cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()

        const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const ipHash = hashIp(ip)

        const ctx = await useCases.resolvePortalContext({
          portalId: portalId(data.portalId),
        })

        try {
          await useCases.recordScan({
            organizationId: ctx.organizationId,
            portalId: portalId(data.portalId),
            propertyId: ctx.propertyId,
            source: data.source,
            sessionId,
            ipHash,
          })
          return { success: true }
        } catch (e) {
          if (isGuestError(e))
            throwContextError('GuestError', e, guestErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'guest.recordScan',
    ),
  )

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
          throw catchUntagged(e)
        }
      },
      'GET',
      'guest.getPublicPortal',
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
        try {
          return await useCases.resolveLinkAndTrack({ linkId: portalLinkId(data.linkId) })
        } catch (e) {
          if (isGuestError(e))
            throwContextError('GuestError', e, guestErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'guest.resolveLinkAndTrack',
    ),
  )
