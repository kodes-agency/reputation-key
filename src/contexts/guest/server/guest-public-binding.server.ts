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
import type { PublicPortalData } from '../application/dto/public-portal.dto'
import { guestRateLimitKey } from './guest-session'
import { rateLimitBudgetFor, type GuestRateLimitAction } from './guest-rate-limit-budgets'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { RateLimitResult } from '#/shared/rate-limit/middleware'

export const denyWithoutEnumeration = (): never =>
  throwContextError(
    'GuestResponseError',
    { code: 'unavailable', message: 'Request unavailable' },
    404,
  )

export async function resolveBoundSession(
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

const PSEUDONYM_ACTION_WITHOUT_PRESSURE: Partial<
  Record<GuestRateLimitAction, 'destination_action' | 'private_feedback'>
> = {
  secondary: 'destination_action',
  feedback_withdraw: 'private_feedback',
  contact_request: 'private_feedback',
  contact_request_withdraw: 'private_feedback',
}

export async function rateLimit(
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
  // network budget already bound it. A Linktree tap has none either: tiles are
  // tapped from arrival, and a busy venue's taps must not spend the room its Google
  // opens have. Its session and Redis network budgets bound it, and a limiter outage
  // counts nothing.
  const pressureActionByRequest = {
    submit: 'rating',
    feedback: 'private_feedback',
    google: 'destination_action',
  } as const
  const pressureAction =
    action in pressureActionByRequest
      ? pressureActionByRequest[action as keyof typeof pressureActionByRequest]
      : null
  const pseudonymAction =
    pressureAction ?? PSEUDONYM_ACTION_WITHOUT_PRESSURE[action] ?? 'rating'
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
