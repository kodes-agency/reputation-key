// Registration and auth server functions (register, sign in, set active org).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { requireAuth } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import { getAuth } from '#/shared/auth/auth'
import { checkUserOrganizationMembership } from '#/shared/auth/user-organization-membership-authority'
import { throwAuthError } from '#/shared/auth/auth-errors'
import { getContainer } from '#/composition'
import { invitationId } from '#/shared/domain/ids'
import { isIdentityError } from '../domain/errors'
import { invitationState } from '../domain/invitation-state'
import { providerRefusalCode } from '../application/provider-refusal'
import { throwIdentityError } from './organizations.errors.server'
import { signInAndForwardCookies } from './sign-in-session.server'
import { enforceVerificationResendRateLimit } from './verification-resend-rate-limit.server'
import {
  registerMemberInputSchema,
  resendVerificationEmailInputSchema,
  setActiveOrgInputSchema,
  signInInputSchema,
  type RegisterMemberInput,
  type ResendVerificationEmailInput,
} from '../application/dto/invitation.dto'

async function maskedEmail(email: string): Promise<string> {
  const { maskEmail } = await import('#/shared/observability/pii')
  return maskEmail(email)
}

// ── Register user only (no organization) ────────────────────────────
// Used by invited members joining an existing org via /join.
export const registerMemberHandler = createServerOnlyFn(
  async ({
    data,
  }: Readonly<{ data: RegisterMemberInput }>): Promise<
    Readonly<{ signedIn: boolean }>
  > => {
    // This is the sole beta account-creation route. The use case requires
    // and consumes an exact email-bound manager invitation; the separate
    // public-registration capability remains permanently blocked.
    const reqHeaders = await headersFromContext()
    const ip = clientIpFromHeaders(reqHeaders)
    const { rateLimiter: rl, logger } = getContainer()
    const rlResult = await rl.check(`auth:register:${ip}`)
    if (!rlResult.allowed) {
      throwContextError(
        'AuthError',
        { code: 'rate_limited', message: 'Too many registration attempts' },
        429,
      )
    }
    try {
      await getContainer().identityPublicApi.requests.registerInvitedUser({
        ...data,
        invitationId: invitationId(data.invitationId),
      })
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw catchUntagged(e)
    }
    // Acceptance verified the address, so the explicit sign-in succeeds under
    // the verification policy. The account exists either way: a failed
    // sign-in leaves the member on the "sign in" card.
    try {
      await signInAndForwardCookies(data.email, data.password, reqHeaders)
      return { signedIn: true }
    } catch (e) {
      logger.warn(
        { emailPrefix: await maskedEmail(data.email), refusal: providerRefusalCode(e) },
        'Sign-in after invited registration failed',
      )
      return { signedIn: false }
    }
  },
)

export const registerMember = createServerFn({ method: 'POST' })
  .validator(registerMemberInputSchema)
  .handler(tracedHandler(registerMemberHandler, 'POST', 'identity.registerMember'))

// ── Sign in user ────────────────────────────────────────────────────
// Direct delegation: no use case because this is pure delegation to better-auth.

/**
 * A refused sign-in, mapped once. An unverified address is reported as such:
 * Better Auth checks the password before it says so, so this reveals nothing
 * a wrong password would not. Everything else stays `invalid_credentials`.
 */
function throwSignInFailure(e: unknown): never {
  if (providerRefusalCode(e) === 'EMAIL_NOT_VERIFIED') {
    throwContextError(
      'AuthError',
      { code: 'email_not_verified', message: 'Verify your email before signing in.' },
      403,
    )
  }
  // Distinguish infrastructure errors (5xx) from auth errors (401).
  // better-auth APIError carries a statusCode property.
  const statusCode = (e as { statusCode?: number }).statusCode
  if (statusCode && statusCode >= 500) {
    throwContextError(
      'AuthError',
      {
        code: 'server_error',
        message: 'Sign-in temporarily unavailable. Please try again.',
      },
      statusCode,
    )
  }
  throwContextError(
    'AuthError',
    { code: 'invalid_credentials', message: 'Invalid email or password' },
    401,
  )
}

export const signInUser = createServerFn({ method: 'POST' })
  .validator(signInInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const reqHeaders = await headersFromContext()
        const ip = clientIpFromHeaders(reqHeaders)
        const { rateLimiter: rl, logger } = getContainer()
        const rlResult = await rl.check(`auth:signin:${ip}`)
        if (!rlResult.allowed) {
          throwContextError(
            'AuthError',
            { code: 'rate_limited', message: 'Too many sign-in attempts' },
            429,
          )
        }

        try {
          await signInAndForwardCookies(data.email, data.password, reqHeaders)
        } catch (e) {
          logger.warn(
            { emailPrefix: await maskedEmail(data.email), err: e },
            'Sign-in failed',
          )
          throwSignInFailure(e)
        }
      },
      'POST',
      'identity.signInUser',
    ),
  )

// ── Resend the email-verification link ─────────────────────────────
// Anonymous recovery for an account whose address is not verified yet. The
// answer is the same whatever happened, so it says nothing about accounts.

export const resendVerificationEmailHandler = createServerOnlyFn(
  async ({
    data,
  }: Readonly<{ data: ResendVerificationEmailInput }>): Promise<
    Readonly<{ sent: true }>
  > => {
    const reqHeaders = await headersFromContext()
    const { rateLimiter, identityRequestSecurity, logger } = getContainer()
    await enforceVerificationResendRateLimit({
      rateLimiter,
      ip: clientIpFromHeaders(reqHeaders),
      email: data.email,
      keyHmacSecret: identityRequestSecurity.invitationRateLimitHmacSecret,
    })
    try {
      // No request headers: this is the anonymous path, which is silent for
      // unknown and already-verified addresses.
      await getAuth().api.sendVerificationEmail({
        body: { email: data.email, callbackURL: '/login' },
      })
    } catch (e) {
      logger.warn(
        { emailPrefix: await maskedEmail(data.email), refusal: providerRefusalCode(e) },
        'Verification email resend failed',
      )
    }
    return { sent: true }
  },
)

export const resendVerificationEmail = createServerFn({ method: 'POST' })
  .validator(resendVerificationEmailInputSchema)
  .handler(
    tracedHandler(
      resendVerificationEmailHandler,
      'POST',
      'identity.resendVerificationEmail',
    ),
  )

// ── Set active organization ────────────────────────────────────────

export const setActiveOrganization = createServerFn({ method: 'POST' })
  .validator(setActiveOrgInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const user = await requireAuth(headers)
          const membership = await checkUserOrganizationMembership(
            user.id,
            data.organizationId,
          )
          if (membership.kind === 'deny') {
            throwAuthError(
              'organization_membership_conflict',
              'This account belongs to a different Organization',
            )
          }
          const auth = getAuth()

          await auth.api.setActiveOrganization({
            headers,
            body: { organizationId: data.organizationId },
          })
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.setActiveOrganization',
    ),
  )

// ── List user invitations (for accept invitation page) ──────────────

export const listUserInvitationsHandler = createServerOnlyFn(async () => {
  try {
    const headers = await headersFromContext()
    await requireAuth(headers)
    const { identityPort, clock } = getContainer()
    const now = clock()

    // Only an invitation that can still be accepted is offered; a lapsed one
    // reads as expired and needs Resend from its Organization.
    const invitations = (await identityPort.listUserInvitations(headers))
      .filter((inv) => invitationState(inv.status, inv.expiresAt, now) === 'pending')
      .map((inv) => ({
        ...inv,
        organizationName: inv.organizationName ?? 'Unknown Organization',
      }))

    return { invitations }
  } catch (e) {
    if (isIdentityError(e)) throwIdentityError(e)
    throw catchUntagged(e)
  }
})

export const listUserInvitations = createServerFn({ method: 'GET' }).handler(
  tracedHandler(listUserInvitationsHandler, 'GET', 'identity.listUserInvitations'),
)
