import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { decidePublicExecution } from '#/shared/auth/execution-policy'
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
  canStartNewGuestResponse,
  isQualifiedGuestResponse,
  RESPONSE_WITHDRAWAL_WINDOW_MS,
  type GuestResponseInput,
  type GuestResponseView,
} from '../application/use-cases/guest-response-lifecycle'
import type { PublicPortalData } from '../application/dto/public-portal.dto'
import {
  guestPrivateFeedbackMutationDto,
  guestRatingMutationDto,
  guestResponseMutationDto,
  guestSecondaryLinkMutationDto,
} from '../application/dto/guest-response-form.dto'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { guestRateLimitKey } from './guest-session'
import { rateLimitBudgetFor, type GuestRateLimitAction } from './guest-rate-limit-budgets'
import {
  applyGuestPublicResponsePrivacy,
  guestPublicResponseValidator,
} from './public-response-privacy.server'
import { organizationId, portalId, portalLinkId, propertyId } from '#/shared/domain/ids'
import type { RateLimitResult } from '#/shared/rate-limit/middleware'
export type { PublicPortalLoaderData } from '../application/dto/public-portal.dto'

const HONEYPOT_INTEGRITY_ASSESSMENT = {
  outcome: 'filtered_automatically',
  reasonCode: 'honeypot_signal',
  source: 'automatic',
  actorId: 'guest-integrity-honeypot-v1',
} as const

// The guests of one venue share one public address, so a rating beyond the
// network-and-Portal budget is kept and filtered automatically, never refused:
// the guest still reaches the Google step and the rating stays out of the
// private-rating figures (Results' integrity line counts it).
const NETWORK_VOLUME_INTEGRITY_ASSESSMENT = {
  outcome: 'filtered_automatically',
  reasonCode: 'network_volume',
  source: 'automatic',
  actorId: 'guest-integrity-network-v1',
} as const

// A filled trap wins over network volume: a bot is a bot whatever address it posts from.
const initialIntegrityAssessment = (
  flags: Readonly<{ trapped: boolean; overNetworkBudget: boolean }>,
) => {
  if (flags.trapped) return HONEYPOT_INTEGRITY_ASSESSMENT
  return flags.overNetworkBudget ? NETWORK_VOLUME_INTEGRITY_ASSESSMENT : undefined
}

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
  const container = getContainer()
  const useCases = container.guestPublicApi.requests
  const { clock } = container
  let portal: PublicPortalData
  try {
    portal = await useCases.getPublicPortal({ token: input.token })
  } catch {
    return denyWithoutEnumeration()
  }
  const scope: GuestResponseScope = {
    organizationId: organizationId(portal.organizationId),
    propertyId: propertyId(portal.propertyId),
    portalId: portalId(portal.portal.id),
  }
  const requestHeaders = (await headersFromContext()) ?? new Headers()
  const origin = requestHeaders.get('origin')
  if (origin !== useCases.guestPublicRuntime.expectedOrigin) {
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
    now: clock(),
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

/**
 * How `rateLimit` answers a request that a budget did not admit.
 * - `refuse` (the default): a 429.
 * - `fail_open_navigation`: resolves false and the caller goes on without the
 *   analytics, whichever layer or outage said no.
 * - `keep_over_network_volume`: resolves false when only the network-and-Portal
 *   layer (or its durable twin) is exhausted, so the caller keeps the request.
 *   A session-layer denial and a limiter outage still refuse.
 */
type GuestRateLimitMode = 'refuse' | 'fail_open_navigation' | 'keep_over_network_volume'

async function rateLimit(
  action: GuestRateLimitAction,
  sessionId: string,
  scope: GuestResponseScope,
  headers: Headers,
  destinationKey?: string,
  mode: GuestRateLimitMode = 'refuse',
): Promise<boolean> {
  const failOpenNavigation = mode === 'fail_open_navigation'
  const container = getContainer()
  const useCases = container.guestPublicApi.requests
  const { rateLimiter, clock } = container
  // Kept beside the limiter it feeds: the guest-request → durable
  // network-pressure authority map, null for requests that have none. A
  // correction has none: it would spend the venue's room for new ratings, and
  // the aggregate's one-correction rule, the session budget and the Redis
  // network budget already bound it.
  const pressureActionByRequest = {
    submit: 'rating',
    feedback: 'private_feedback',
    google: 'destination_action',
    secondary: 'destination_action',
  } as const
  const pressureAction =
    action in pressureActionByRequest
      ? pressureActionByRequest[action as keyof typeof pressureActionByRequest]
      : null
  const pseudonymAction =
    pressureAction ?? (action === 'feedback_withdraw' ? 'private_feedback' : 'rating')
  const limits = rateLimitBudgetFor(action)
  const keyKind = action === 'google' || action === 'secondary' ? 'click' : 'response'
  const portalId = scope.portalId
  const observedAt = clock()
  const pseudonym = useCases.guestPublicRuntime.hashNetworkPseudonym(
    clientIpFromHeaders(headers),
    scope,
    pseudonymAction,
    observedAt,
  )
  const denyRateLimited = (resetAt: Date): false => {
    if (failOpenNavigation) return false
    setResponseHeader(
      'Retry-After',
      String(Math.max(1, Math.ceil((resetAt.getTime() - observedAt.getTime()) / 1000))),
    )
    throwContextError(
      'GuestResponseError',
      { code: 'rate_limited', message: 'Too many requests' },
      429,
    )
  }
  const denyLimiterResult = async (result: RateLimitResult): Promise<false> => {
    if (failOpenNavigation && result.backendStatus === 'unavailable') {
      await useCases.reportObservationLoss('review_link')
    }
    return denyRateLimited(result.resetAt)
  }
  // The venue's budget, not the guest's: say so once, without the address, then
  // refuse or hand the verdict back, as the mode asks.
  const denyNetworkVolume = (resetAt: Date): false => {
    useCases.reportNetworkBudgetExhausted({ action })
    return mode === 'keep_over_network_volume' ? false : denyRateLimited(resetAt)
  }

  const sessionResult = await rateLimiter.check(
    `${guestRateLimitKey(keyKind, sessionId, pseudonym)}:${action}${destinationKey ? `:${destinationKey}` : ''}`,
    limits.session,
  )
  if (!sessionResult.allowed) return denyLimiterResult(sessionResult)

  const networkResult = await rateLimiter.check(
    `${keyKind}:network:${pseudonym}:portal:${portalId}:${action}`,
    limits.networkPortal,
  )
  if (!networkResult.allowed) {
    return networkResult.backendStatus === 'available'
      ? denyNetworkVolume(networkResult.resetAt)
      : denyLimiterResult(networkResult)
  }

  if (pressureAction) {
    try {
      const pressureResult = await useCases.consumeGuestNetworkPressure({
        ...scope,
        pseudonym,
        action: pressureAction,
        ...limits.networkPortal,
      })
      if (!pressureResult.allowed) return denyNetworkVolume(pressureResult.resetAt)
    } catch (error) {
      if (failOpenNavigation) {
        await useCases.reportObservationLoss('review_link')
        return false
      }
      throw error
    }
  }
  return true
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
 * submit would have produced. Silent by design — a visible error (or a
 * distinguishable success shape) tells the bot the trap exists. Valid,
 * rate-limited rating submissions are retained under the automatic integrity
 * outcome; this view remains the fail-closed fallback when binding/persistence
 * cannot safely happen.
 */
function decoyView(
  input: Readonly<{ rating?: number | null; text?: string | null }>,
  now: Date,
): GuestResponseView {
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
  .validator(guestPublicResponseValidator(guestRatingMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        const trapped = Boolean(data.honeypot)
        let overNetworkBudget: boolean
        let bound: Awaited<ReturnType<typeof resolveBoundSession>>
        try {
          bound = await resolveBoundSession({
            ...data,
            action: 'public:portal.response.submit',
            capability: 'portal.guest_response',
            assertions: assertions(data),
            requiredConsents: ['response'],
          })
          // A new rating is never refused for network volume: past the network
          // layer it is kept and filtered below. This device's own budget, or a
          // limiter that cannot answer, still refuses.
          overNetworkBudget = !(await rateLimit(
            'submit',
            bound.session.sessionId,
            bound.scope,
            bound.headers,
            undefined,
            'keep_over_network_volume',
          ))
        } catch (error) {
          if (trapped) return decoyView(data, getContainer().clock())
          throw error
        }
        try {
          const response = await bound.useCases.responseLifecycle.submit(
            bound.scope,
            bound.session.sessionId,
            data,
            {
              portalPublicationState: bound.portal.responseConfiguration.publicationState,
              portalPublicationSnapshotId:
                bound.portal.responseConfiguration.publicationSnapshotId,
              portalPublicationVersion:
                bound.portal.responseConfiguration.publicationVersion,
              portalPublicationDigest:
                bound.portal.responseConfiguration.publicationDigest,
              portalConfigurationDigest:
                bound.portal.responseConfiguration.configurationDigest,
              guestLocale: bound.portal.responseConfiguration.guestLocale,
              languagePackVersion: bound.portal.responseConfiguration.languagePackVersion,
              privateFeedbackThreshold:
                bound.portal.responseConfiguration.privateFeedbackThreshold,
            },
            undefined,
            initialIntegrityAssessment({ trapped, overNetworkBudget }),
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
          if (trapped) return decoyView(data, getContainer().clock())
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.submit',
    ),
  )

export const correctGuestResponseFn = createServerFn({ method: 'POST' })
  .validator(guestPublicResponseValidator(guestRatingMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        // Same trap on the correction path — the form posts the field to both.
        if (data.honeypot) return decoyView(data, getContainer().clock())
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.correct',
          capability: 'portal.guest_response',
          assertions: assertions(data),
          requiredConsents: ['response'],
        })
        await rateLimit('correct', bound.session.sessionId, bound.scope, bound.headers)
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
 * Allowed once the session holds a durable rating, or once the guest withdrew it
 * (`canStartNewGuestResponse`): a withdrawn response ends its session's chance
 * to rate, so a fresh session is the only way on.
 */
export const startNewGuestResponseFn = createServerFn({ method: 'POST' })
  .validator(guestPublicResponseValidator(guestResponseMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
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
          bound.scope,
          bound.headers,
        )
        const response = await bound.useCases.responseLifecycle.getState(
          bound.scope,
          bound.session.sessionId,
        )
        if (!canStartNewGuestResponse(response)) return denyWithoutEnumeration()
        const issued = bound.useCases.guestSessions.issue(bound.scope)
        setResponseHeader('Set-Cookie', [...issued.cookies])
        return { csrfNonce: issued.session.csrfNonce }
      },
      'POST',
      'guest.response.start_new',
    ),
  )

export const submitPrivateFeedbackFn = createServerFn({ method: 'POST' })
  .validator(guestPublicResponseValidator(guestPrivateFeedbackMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        if (data.honeypot) {
          return decoyView({ text: data.text }, getContainer().clock())
        }
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
        await rateLimit('feedback', bound.session.sessionId, bound.scope, bound.headers)
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
  .validator(guestPublicResponseValidator(guestResponseMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
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
          bound.scope,
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
  .validator(guestPublicResponseValidator(guestResponseMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
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
        if (!isQualifiedGuestResponse(response)) return denyWithoutEnumeration()
        const googleReview = bound.portal.reviewGateway.googleReview
        if (googleReview.status !== 'available') return denyWithoutEnumeration()
        const qualified = await rateLimit(
          'google',
          bound.session.sessionId,
          bound.scope,
          bound.headers,
          undefined,
          'fail_open_navigation',
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
 * Qualified secondary-link action. The GET redirect handles every navigation;
 * only this origin/CSRF/session-bound mutation may create analytics.
 */
export const selectSecondaryLinkFn = createServerFn({ method: 'POST' })
  .validator(guestPublicResponseValidator(guestSecondaryLinkMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.secondary_link.select',
          capability: 'portal.public_read',
          assertions: {
            analytics: true,
            response: false,
            freeText: false,
            contact: false,
            media: false,
          },
          requiredConsents: [],
        })
        const qualified = await rateLimit(
          'secondary',
          bound.session.sessionId,
          bound.scope,
          bound.headers,
          data.linkId,
          'fail_open_navigation',
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
  .validator(guestPublicResponseValidator(guestResponseMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
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
        await rateLimit(
          'response_withdraw',
          bound.session.sessionId,
          bound.scope,
          bound.headers,
        )
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
