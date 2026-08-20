// Guest context — scan & public portal read server functions (split from public.ts)

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import {
  decidePublicExecution,
  type ExecutionDecision,
} from '#/shared/auth/execution-policy'
import type { GuestResponseFormAvailability } from '../application/dto/public-portal.dto'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { isGuestError } from '../domain/errors'
import type { GuestErrorCode } from '../domain/errors'
import { organizationId, portalId, portalLinkId, propertyId } from '#/shared/domain/ids'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import { hashIp } from './hash-ip.server'
import { guestRateLimitKey } from './guest-session'

// ── Error → HTTP status mapping (exhaustive) ──────────────────────

export const guestErrorStatus = (code: GuestErrorCode): number =>
  match(code)
    .with('rate_limit_exceeded', () => 429)
    .with(
      'invalid_rating',
      'duplicate_rating',
      'duplicate_feedback',
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

// ── recordScan ────────────────────────────────────────────────────

const recordScanSchema = z.object({
  token: z.string().min(1).max(256),
  csrfNonce: z.string().uuid(),
  source: z.enum(['qr', 'nfc', 'direct']),
  analyticsConsent: z.literal(true),
})

export const recordScanFn = createServerFn({ method: 'POST' })
  .inputValidator(recordScanSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases, rateLimiter } = getContainer()
        const headers = await headersFromContext()
        const portal = await useCases.getPublicPortal({ token: data.token })
        const scope = {
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.portal.id,
        }
        const session = useCases.guestSessions.verify(headers?.get('cookie') ?? '', scope)
        if (!session || !useCases.guestSessions.verifyCsrf(session, data.csrfNonce)) {
          throwContextError(
            'GuestError',
            { code: 'portal_not_found', message: 'Portal not found' },
            404,
          )
        }
        const decision = await decidePublicExecution({
          action: 'public:portal.analytics.record',
          capability: 'portal.public_read',
          ...scope,
          consentAssertions: {
            analytics: true,
            response: false,
            freeText: false,
            contact: false,
            media: false,
          },
          requiredPublicConsents: ['analytics'],
          now: new Date(),
        })
        if (!decision.allowed) return { success: false }

        const ipHash = hashIp(clientIpFromHeaders(headers))
        const rateResult = await rateLimiter.check(
          guestRateLimitKey('scan', session.sessionId, ipHash),
        )
        if (!rateResult.allowed) {
          setResponseHeader(
            'Retry-After',
            String(
              Math.max(1, Math.ceil((rateResult.resetAt.getTime() - Date.now()) / 1000)),
            ),
          )
          throwContextError(
            'GuestError',
            { code: 'rate_limit_exceeded', message: 'Too many requests' },
            429,
          )
        }

        try {
          await useCases.recordScan({
            organizationId: organizationId(portal.organizationId),
            portalId: portalId(portal.portal.id),
            propertyId: propertyId(portal.propertyId),
            source: data.source,
            sessionId: session.sessionId,
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
  token: z.string().min(1).max(256),
})

// Transient deny reasons: the capability may return without any tenant
// reconfiguration, so the guest gets the retryable copy rather than the flat
// "not available for this portal". Every other deny is a configuration answer.
const TRANSIENT_DENY_REASONS: Record<string, true> = {
  org_suspended: true,
  property_suspended: true,
  policy_unavailable: true,
}

const formAvailability = (decision: ExecutionDecision): GuestResponseFormAvailability =>
  decision.allowed
    ? 'available'
    : TRANSIENT_DENY_REASONS[decision.reason]
      ? 'unavailable'
      : 'permission_denied'

export const getPublicPortal = createServerFn({ method: 'GET' })
  .inputValidator(publicPortalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases } = getContainer()
        try {
          const portal = await useCases.getPublicPortal({ token: data.token })
          const scope = {
            organizationId: portal.organizationId,
            propertyId: portal.propertyId,
            portalId: portal.portal.id,
          }
          // One instant for every decision on this read.
          const now = new Date()
          const decision = await decidePublicExecution({
            action: 'public:portal.read',
            capability: 'portal.public_read',
            ...scope,
            now,
          })
          if (!decision.allowed) {
            throwContextError(
              'GuestError',
              { code: 'portal_not_found', message: 'Portal not found' },
              404,
            )
          }
          const headers = await headersFromContext()
          let session = useCases.guestSessions.verify(headers?.get('cookie') ?? '', scope)
          if (!session) {
            const issued = useCases.guestSessions.issue(scope)
            session = issued.session
            setResponseHeader('Set-Cookie', [...issued.cookies])
          }
          const response = await useCases.responseLifecycle.getState(
            scope,
            session.sessionId,
          )
          // The guest capability decisions the form needs up front. Same action
          // as the read they serve — the audit row's capability distinguishes
          // them. Resolved only AFTER the public_read deny above has thrown, so
          // a denied portal and a missing one remain indistinguishable (both
          // 404 with the same body); no new non-enumeration surface.
          const [responseDecision, mediaDecision] = await Promise.all([
            decidePublicExecution({
              action: 'public:portal.read',
              capability: 'portal.guest_response',
              ...scope,
              now,
            }),
            decidePublicExecution({
              action: 'public:portal.read',
              capability: 'portal.guest_media',
              ...scope,
              now,
            }),
          ])
          setResponseHeader('Referrer-Policy', 'no-referrer')
          return {
            ...portal,
            guestSession: { csrfNonce: session.csrfNonce },
            response,
            responseForm: {
              availability: formAvailability(responseDecision),
              mediaEnabled: mediaDecision.allowed,
            },
          }
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
  token: z.string().min(1).max(256),
  linkId: z.string().min(1),
})

export const resolveLinkAndTrack = createServerFn({ method: 'GET' })
  .inputValidator(resolveLinkSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { useCases } = getContainer()
        try {
          return await useCases.resolveLinkAndTrack({
            token: data.token,
            linkId: portalLinkId(data.linkId),
          })
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
