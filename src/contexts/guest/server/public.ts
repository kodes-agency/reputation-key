import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { getEnv } from '#/shared/config/env'
import { headersFromContext } from '#/shared/auth/headers'
import {
  decidePublicExecution,
  requireExecutionAllowed,
} from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type {
  PublicConsent,
  PublicConsentAssertions,
} from '#/shared/auth/execution-policy'
import type { GuestResponseScope } from '../application/ports/guest-response.repository'
import {
  CORRECTION_WINDOW_MS,
  GuestResponseLifecycleError,
  RESPONSE_WITHDRAWAL_WINDOW_MS,
  type GuestResponseInput,
  type GuestResponseView,
} from '../application/use-cases/guest-response-lifecycle'
import type { PublicPortalData } from '../application/dto/public-portal.dto'
import { MAX_TEXT_LENGTH } from '../domain/guest-response'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { guestRateLimitKey } from './guest-session'
import { hashIp } from './hash-ip.server'
import { organizationId, portalId, portalLinkId, propertyId } from '#/shared/domain/ids'
export type { PublicPortalLoaderData } from '../application/dto/public-portal.dto'

const baseMutationSchema = z.object({
  token: z.string().min(1).max(256),
  csrfNonce: z.string().uuid(),
})

const ratingMutationSchema = baseMutationSchema.extend({
  rating: z.number().int().min(1).max(5),
  responseConsent: z.literal(true),
  // Bot trap: a real guest never fills this (the form renders it off-screen and
  // aria-hidden), so any value means an automated submit. The rate limiter was
  // the only bot defence on this path.
  honeypot: z.string().max(256).optional(),
})

const privateFeedbackMutationSchema = baseMutationSchema.extend({
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  textConsent: z.literal(true),
  honeypot: z.string().max(256).optional(),
})

const secondaryLinkMutationSchema = baseMutationSchema.extend({
  linkId: z.string().min(1).max(255),
})

const denyWithoutEnumeration = (): never =>
  throwContextError(
    'GuestResponseError',
    { code: 'unavailable', message: 'Request unavailable' },
    404,
  )

async function resolveBoundSession(
  input: Readonly<{
    token: string
    csrfNonce: string
    capability: Capability
    action: string
    assertions: PublicConsentAssertions
    requiredConsents: ReadonlyArray<PublicConsent>
  }>,
) {
  const { useCases } = getContainer()
  let portal: PublicPortalData
  try {
    portal = await useCases.getPublicPortal({ token: input.token })
  } catch {
    return denyWithoutEnumeration()
  }
  const scope: GuestResponseScope = {
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.portal.id,
  }
  const requestHeaders = (await headersFromContext()) ?? new Headers()
  const origin = requestHeaders.get('origin')
  if (origin !== new URL(getEnv().BETTER_AUTH_URL).origin) {
    return denyWithoutEnumeration()
  }
  const session = useCases.guestSessions.verify(requestHeaders.get('cookie') ?? '', scope)
  if (!session || !useCases.guestSessions.verifyCsrf(session, input.csrfNonce)) {
    return denyWithoutEnumeration()
  }
  const decision = await decidePublicExecution({
    action: input.action,
    capability: input.capability,
    ...scope,
    consentAssertions: input.assertions,
    requiredPublicConsents: input.requiredConsents,
    now: new Date(),
  })
  if (!decision.allowed) return denyWithoutEnumeration()
  return { useCases, scope, session, headers: requestHeaders, portal }
}

function lifecycleFailure(error: unknown): never {
  if (!(error instanceof GuestResponseLifecycleError)) throw error
  const conflict: Record<string, true> = {
    already_submitted: true,
    correction_window_expired: true,
    feedback_withdrawal_expired: true,
    feedback_not_found: true,
    response_not_submitted: true,
    response_withdrawal_expired: true,
    already_deleted: true,
  }
  const hidden: Record<string, true> = {
    response_not_found: true,
    response_unavailable: true,
    media_not_found: true,
  }
  if (hidden[error.code]) return denyWithoutEnumeration()
  throwContextError(
    'GuestResponseError',
    { code: error.code, message: 'Request could not be completed' },
    conflict[error.code] ? 409 : 400,
  )
}

async function rateLimit(
  action:
    | 'submit'
    | 'correct'
    | 'feedback'
    | 'feedback_withdraw'
    | 'new_response'
    | 'google'
    | 'secondary',
  sessionId: string,
  portalId: string,
  headers: Headers,
  destinationKey?: string,
  failOpenNavigation = false,
): Promise<boolean> {
  const { rateLimiter } = getContainer()
  const limits =
    action === 'submit'
      ? {
          session: { maxRequests: 2, windowSeconds: 60 * 60 },
          networkPortal: { maxRequests: 5, windowSeconds: 60 * 60 },
        }
      : action === 'new_response'
        ? {
            // A shared device may legitimately serve another visitor, but
            // rotation must not become an unbounded response-farming primitive.
            // The network+Portal layer survives the new session identity.
            session: { maxRequests: 2, windowSeconds: 24 * 60 * 60 },
            networkPortal: { maxRequests: 5, windowSeconds: 24 * 60 * 60 },
          }
        : action === 'correct' || action === 'feedback' || action === 'feedback_withdraw'
          ? {
              // The aggregate enforces one successful correction/feedback. A
              // small attempt budget still permits retry after a transient fault
              // or compare-and-set race instead of making the UI's retry copy false.
              session: { maxRequests: 3, windowSeconds: 60 * 60 },
              networkPortal: { maxRequests: 10, windowSeconds: 60 * 60 },
            }
          : action === 'google' || action === 'secondary'
            ? {
                // PostgreSQL owns exact once-per-session/destination semantics.
                // This small abuse budget allows a retry after transient
                // observation loss while the navigation itself remains fail-open.
                session: { maxRequests: 3, windowSeconds: 24 * 60 * 60 },
                networkPortal: { maxRequests: 50, windowSeconds: 60 * 60 },
              }
            : {
                session: { maxRequests: 10, windowSeconds: 60 * 60 },
                networkPortal: { maxRequests: 50, windowSeconds: 60 * 60 },
              }
  const keyKind = action === 'google' || action === 'secondary' ? 'click' : 'response'
  const ipHash = hashIp(clientIpFromHeaders(headers))
  let result = await rateLimiter.check(
    `${guestRateLimitKey(keyKind, sessionId, ipHash)}:${action}${destinationKey ? `:${destinationKey}` : ''}`,
    limits.session,
  )
  if (result.allowed) {
    result = await rateLimiter.check(
      `${keyKind}:network:${ipHash}:portal:${portalId}:${action}`,
      limits.networkPortal,
    )
  }
  if (result.allowed) return true
  if (failOpenNavigation) return false
  setResponseHeader(
    'Retry-After',
    String(Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))),
  )
  throwContextError(
    'GuestResponseError',
    { code: 'rate_limited', message: 'Too many requests' },
    429,
  )
}

function assertions(input: GuestResponseInput): PublicConsentAssertions {
  return {
    analytics: false,
    response: input.responseConsent === true,
    freeText: input.textConsent === true,
    contact: false,
    media: input.mediaConsent === true,
  }
}

/**
 * Honeypot response: a filled trap field is answered with the view a real
 * submit would have produced, and nothing is written. Silent by design — a
 * visible error (or a distinguishable success shape) tells the bot the trap
 * exists, which is the whole value of the trap.
 */
function decoyView(
  input: Readonly<{ rating?: number | null; text?: string | null }>,
): GuestResponseView {
  const now = new Date()
  return {
    status: 'submitted',
    rating: input.rating ?? null,
    hasPrivateFeedback: Boolean(input.text?.trim()),
    privateFeedbackEligible: false,
    submittedAt: now.toISOString(),
    correctedAt: null,
    correctionDeadline: new Date(now.getTime() + CORRECTION_WINDOW_MS).toISOString(),
    correctionAvailable: true,
    responseWithdrawalDeadline: new Date(
      now.getTime() + RESPONSE_WITHDRAWAL_WINDOW_MS,
    ).toISOString(),
    responseWithdrawalAvailable: true,
    feedbackSubmittedAt: null,
    feedbackWithdrawalDeadline: null,
    feedbackWithdrawalAvailable: false,
    feedbackWithdrawnAt: null,
    deletedAt: null,
  }
}

export const submitGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        if (data.honeypot) return decoyView(data)
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.submit',
          capability: 'portal.guest_response',
          assertions: assertions(data),
          requiredConsents: ['response'],
        })
        await rateLimit(
          'submit',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        try {
          const response = await bound.useCases.responseLifecycle.submit(
            bound.scope,
            bound.session.sessionId,
            data,
            bound.portal.reviewGateway.privateFeedbackThreshold,
          )
          if (response.responseWithdrawalDeadline) {
            const renewed = bound.useCases.guestSessions.renewUntil(
              bound.session,
              new Date(response.responseWithdrawalDeadline),
            )
            if (renewed) setResponseHeader('Set-Cookie', [...renewed.cookies])
          }
          return response
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.submit',
    ),
  )

export const correctGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        // Same trap on the correction path — the form posts the field to both.
        if (data.honeypot) return decoyView(data)
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.correct',
          capability: 'portal.guest_response',
          assertions: assertions(data),
          requiredConsents: ['response'],
        })
        await rateLimit(
          'correct',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        try {
          return await bound.useCases.responseLifecycle.correct(
            bound.scope,
            bound.session.sessionId,
            data,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.correct',
    ),
  )

/**
 * End recovery on this shared browser and issue a fresh response identity.
 * The earlier response is deliberately untouched: this is neither withdrawal
 * nor correction, and its independent binding simply expires on schedule.
 */
export const startNewGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(baseMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.start_new',
          capability: 'portal.guest_response',
          assertions: {
            analytics: false,
            response: false,
            freeText: false,
            contact: false,
            media: false,
          },
          requiredConsents: [],
        })
        await rateLimit(
          'new_response',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        const response = await bound.useCases.responseLifecycle.getState(
          bound.scope,
          bound.session.sessionId,
        )
        if (!response?.rating || response.status === 'deleted') {
          return denyWithoutEnumeration()
        }
        const issued = bound.useCases.guestSessions.issue(bound.scope)
        setResponseHeader('Set-Cookie', [...issued.cookies])
        return { csrfNonce: issued.session.csrfNonce }
      },
      'POST',
      'guest.response.start_new',
    ),
  )

export const submitPrivateFeedbackFn = createServerFn({ method: 'POST' })
  .inputValidator(privateFeedbackMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        if (data.honeypot) return decoyView({ text: data.text })
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.text.submit',
          capability: 'portal.guest_text',
          assertions: {
            analytics: false,
            response: true,
            freeText: true,
            contact: false,
            media: false,
          },
          requiredConsents: ['response', 'freeText'],
        })
        await rateLimit(
          'feedback',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        try {
          const response = await bound.useCases.responseLifecycle.addPrivateFeedback(
            bound.scope,
            bound.session.sessionId,
            data,
          )
          if (response.feedbackWithdrawalDeadline) {
            const renewed = bound.useCases.guestSessions.renewUntil(
              bound.session,
              new Date(response.feedbackWithdrawalDeadline),
            )
            if (renewed) setResponseHeader('Set-Cookie', [...renewed.cookies])
          }
          return response
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.private_feedback.submit',
    ),
  )

export const withdrawPrivateFeedbackFn = createServerFn({ method: 'POST' })
  .inputValidator(baseMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.text.withdraw',
          capability: 'portal.guest_text',
          assertions: {
            analytics: false,
            response: true,
            freeText: true,
            contact: false,
            media: false,
          },
          requiredConsents: ['response', 'freeText'],
        })
        await rateLimit(
          'feedback_withdraw',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        try {
          return await bound.useCases.responseLifecycle.withdrawPrivateFeedback(
            bound.scope,
            bound.session.sessionId,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.private_feedback.withdraw',
    ),
  )

/**
 * Qualified Google Review Selection. The response must already contain the
 * session's durable private rating; observation failure never blocks navigation.
 */
export const selectGoogleReviewFn = createServerFn({ method: 'POST' })
  .inputValidator(baseMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.google_review.select',
          capability: 'portal.public_read',
          assertions: {
            analytics: true,
            response: true,
            freeText: false,
            contact: false,
            media: false,
          },
          requiredConsents: [],
        })
        const response = await bound.useCases.responseLifecycle.getState(
          bound.scope,
          bound.session.sessionId,
        )
        if (!response?.rating || response.status === 'deleted') {
          return denyWithoutEnumeration()
        }
        const googleReview = bound.portal.reviewGateway.googleReview
        if (googleReview.status !== 'available') return denyWithoutEnumeration()
        const qualified = await rateLimit(
          'google',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
          undefined,
          true,
        )
        if (qualified) {
          await bound.useCases.trackReviewLinkClick({
            linkId: portalLinkId(`google-review:${bound.scope.portalId}`),
            destinationKind: 'google_review',
            sessionId: bound.session.sessionId,
            sessionExpiresAt: bound.session.expiresAt,
            organizationId: organizationId(bound.scope.organizationId),
            portalId: portalId(bound.scope.portalId),
            propertyId: propertyId(bound.scope.propertyId),
          })
        }
        return { url: googleReview.uri }
      },
      'POST',
      'guest.google_review.select',
    ),
  )

/**
 * Qualified secondary-link action. The GET redirect remains a navigation-only
 * fallback; only this origin/CSRF/session-bound mutation may create analytics.
 */
export const selectSecondaryLinkFn = createServerFn({ method: 'POST' })
  .inputValidator(secondaryLinkMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.secondary_link.select',
          capability: 'portal.public_read',
          assertions: {
            analytics: true,
            response: true,
            freeText: false,
            contact: false,
            media: false,
          },
          requiredConsents: [],
        })
        const response = await bound.useCases.responseLifecycle.getState(
          bound.scope,
          bound.session.sessionId,
        )
        if (!response?.rating || response.status === 'deleted') {
          return denyWithoutEnumeration()
        }
        const qualified = await rateLimit(
          'secondary',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
          data.linkId,
          true,
        )
        const result = await bound.useCases.resolveLinkAndTrack({
          token: data.token,
          linkId: portalLinkId(data.linkId),
          qualifyObservation: async (scope) =>
            qualified &&
            scope.organizationId === bound.scope.organizationId &&
            scope.propertyId === bound.scope.propertyId &&
            scope.portalId === bound.scope.portalId
              ? {
                  sessionId: bound.session.sessionId,
                  sessionExpiresAt: bound.session.expiresAt,
                }
              : null,
        })
        if (!result) return denyWithoutEnumeration()
        return result
      },
      'POST',
      'guest.secondary_link.select',
    ),
  )

export const withdrawGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(baseMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.withdraw',
          capability: 'portal.guest_response',
          assertions: {
            analytics: false,
            response: true,
            freeText: false,
            contact: false,
            media: false,
          },
          requiredConsents: ['response'],
        })
        try {
          return await bound.useCases.responseLifecycle.withdraw(
            bound.scope,
            bound.session.sessionId,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.withdraw',
    ),
  )

const moderationSchema = z.object({
  propertyId: z.string().uuid(),
  portalId: z.string().uuid(),
  responseId: z.string().uuid(),
  action: z.enum(['quarantine', 'delete']),
})

// Staff moderation, not guest collection: gating this on portal.guest_response
// made the two impossible to enable independently — a tenant that stopped
// collecting guest responses also lost the ability to moderate the ones it had
// already collected. portal.guest_response stays on the public-facing paths.
export const moderateGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(moderationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const actor = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor,
          action: 'feedback.respond',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        const { useCases } = getContainer()
        try {
          return await useCases.responseLifecycle.moderate(
            {
              organizationId: actor.organizationId,
              propertyId: data.propertyId,
              portalId: data.portalId,
            },
            data.responseId,
            data.action,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.moderate',
    ),
  )
