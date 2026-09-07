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
import {
  organizationId,
  portalAccessArtifactId,
  portalId,
  portalLinkId,
  propertyId,
} from '#/shared/domain/ids'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import {
  applyGuestPublicResponsePrivacy,
  guestPublicResponseValidator,
} from './public-response-privacy.server'
import { checkLayeredGuestRateLimit, guestRateLimitKeys } from './guest-session'
import { toPublicPortalLoaderData } from '../application/dto/public-portal.dto'

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
  csrfNonce: z.uuid(),
  accessArtifactId: z.uuid().nullable(),
})

export const recordScanFn = createServerFn({ method: 'POST' })
  .validator(guestPublicResponseValidator(recordScanSchema))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        const container = getContainer()
        const useCases = container.guestPublicApi.requests
        const { rateLimiter, clock } = container
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
        const observedAt = clock()
        const decision = await decidePublicExecution({
          action: 'public:portal.analytics.record',
          capability: 'portal.public_read',
          ...scope,
          now: observedAt,
        })
        if (!decision.allowed) {
          return {
            success: false,
            retryable: decision.reason === 'policy_unavailable',
          }
        }
        const pseudonym = useCases.guestPublicRuntime.hashNetworkPseudonym(
          clientIpFromHeaders(headers),
          scope,
          'qualified_scan',
          observedAt,
        )
        const networkPortalLimits = {
          maxRequests: 100,
          windowSeconds: 60 * 60,
        } as const
        const rateResult = await checkLayeredGuestRateLimit({
          rateLimiter,
          keys: guestRateLimitKeys(
            'scan',
            session.sessionId,
            pseudonym,
            portal.portal.id,
          ),
          sessionLimits: { maxRequests: 3, windowSeconds: 60 * 60 },
          networkPortalLimits,
        })
        if (!rateResult.allowed) {
          if (rateResult.backendStatus === 'unavailable') {
            await useCases.reportObservationLoss('scan')
          }
          setResponseHeader(
            'Retry-After',
            String(
              Math.max(
                1,
                Math.ceil((rateResult.resetAt.getTime() - clock().getTime()) / 1000),
              ),
            ),
          )
          throwContextError(
            'GuestError',
            { code: 'rate_limit_exceeded', message: 'Too many requests' },
            429,
          )
        }

        let pressureResult
        try {
          pressureResult = await useCases.consumeGuestNetworkPressure({
            ...scope,
            pseudonym,
            action: 'qualified_scan',
            ...networkPortalLimits,
          })
        } catch {
          await useCases.reportObservationLoss('scan')
          return { success: false, retryable: true }
        }
        if (!pressureResult.allowed) {
          setResponseHeader(
            'Retry-After',
            String(
              Math.max(
                1,
                Math.ceil((pressureResult.resetAt.getTime() - clock().getTime()) / 1000),
              ),
            ),
          )
          throwContextError(
            'GuestError',
            { code: 'rate_limit_exceeded', message: 'Too many requests' },
            429,
          )
        }

        try {
          const outcome = await useCases.recordScan({
            organizationId: organizationId(portal.organizationId),
            portalId: portalId(portal.portal.id),
            propertyId: propertyId(portal.propertyId),
            accessArtifactId: data.accessArtifactId
              ? portalAccessArtifactId(data.accessArtifactId)
              : null,
            publicationSnapshotId: portal.responseConfiguration.publicationSnapshotId,
            rawToken: data.token,
            sessionId: session.sessionId,
            userAgent: headers?.get('user-agent') ?? null,
            purpose: headers?.get('purpose') ?? null,
            secPurpose: headers?.get('sec-purpose') ?? null,
          })
          return {
            success: outcome !== 'failed' && outcome !== 'retryable',
            retryable: outcome === 'failed' || outcome === 'retryable',
          }
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
  locale: z.enum(['en', 'bg']).optional(),
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
  .validator(guestPublicResponseValidator(publicPortalSchema))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        const container = getContainer()
        const useCases = container.guestPublicApi.requests
        const { clock } = container
        try {
          const requestHeaders = await headersFromContext()
          let portal = await useCases.getPublicPortal({
            token: data.token,
            requestedLocale: data.locale,
            acceptLanguage: requestHeaders?.get('accept-language') ?? null,
          })
          const scope = {
            organizationId: portal.organizationId,
            propertyId: portal.propertyId,
            portalId: portal.portal.id,
          }
          // One instant for every decision on this read.
          const now = clock()
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
          let session = useCases.guestSessions.verify(
            requestHeaders?.get('cookie') ?? '',
            scope,
          )
          if (session?.guestLocale && data.locale === undefined) {
            // The first token resolution establishes the exact tenant/Property/
            // Portal scope needed to verify the cookie. Re-resolve only after
            // that check so a signed preference from another Portal can never
            // influence this response.
            portal = await useCases.getPublicPortal({
              token: data.token,
              requestedLocale: null,
              sessionLocale: session.guestLocale,
              acceptLanguage: requestHeaders?.get('accept-language') ?? null,
            })
          }
          if (!session) {
            const issued = useCases.guestSessions.issue(
              scope,
              portal.localization.selectedLocale,
            )
            session = issued.session
            setResponseHeader('Set-Cookie', [...issued.cookies])
          } else if (session.guestLocale !== portal.localization.selectedLocale) {
            const selected = useCases.guestSessions.selectLocale(
              session,
              portal.localization.selectedLocale,
            )
            session = selected.session
            setResponseHeader('Set-Cookie', [...selected.cookies])
          }
          const response = await useCases.responseLifecycle.getState(
            scope,
            session.sessionId,
          )
          // The guest capability decisions the form needs up front. The
          // capability key distinguishes them even though they serve the same
          // read action. Resolved only AFTER the public_read deny above has thrown, so
          // a denied portal and a missing one remain indistinguishable (both
          // 404 with the same body); no new non-enumeration surface.
          const responseDecision = await decidePublicExecution({
            action: 'public:portal.read',
            capability: 'portal.guest_response',
            ...scope,
            now,
          })
          return toPublicPortalLoaderData(portal, {
            guestSession: { csrfNonce: session.csrfNonce },
            response,
            responseForm: {
              availability: formAvailability(responseDecision),
            },
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

// ── resolvePublicPortalLink ───────────────────────────────────────
// Navigation-only fallback for no-JavaScript and failed mutation paths. A GET
// deliberately never creates the Qualified Link Action product metric.

const resolveLinkSchema = z.object({
  token: z.string().min(1).max(256),
  linkId: z.string().min(1),
})

export const resolvePublicPortalLink = createServerFn({ method: 'GET' })
  .validator(guestPublicResponseValidator(resolveLinkSchema, { varyCookie: false }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy({ varyCookie: false })
        const useCases = getContainer().guestPublicApi.requests
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
      'guest.resolvePublicPortalLink',
    ),
  )
