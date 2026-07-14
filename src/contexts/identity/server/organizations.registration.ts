// Registration and auth server functions (register, sign in, set active org).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { requireAuth } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { assertGlobalCapability } from '#/shared/auth/beta-capabilities'
import { throwIdentityError } from './organizations.errors.server'
import {
  registerUserInputSchema,
  registerMemberInputSchema,
  setActiveOrgInputSchema,
  signInInputSchema,
} from '../application/dto/invitation.dto'

// ── Register user only (no organization) ────────────────────────────
// Used by invited members joining an existing org via /join.
export const registerMember = createServerFn({ method: 'POST' })
  .inputValidator(registerMemberInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        // B0.6: Public registration is a non-core capability — disabled by
        // default in beta. Operators enable it via BETA_ALLOWLIST_ORGS.
        assertGlobalCapability('identity.register')
        const reqHeaders = await headersFromContext()
        const ip = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const { rateLimiter: rl } = getContainer()
        const rlResult = await rl.check(`auth:register:${ip}`)
        if (!rlResult.allowed) {
          throwContextError(
            'AuthError',
            { code: 'rate_limited', message: 'Too many registration attempts' },
            429,
          )
        }
        try {
          const { useCases } = getContainer()
          await useCases.registerUser(data)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.registerMember',
    ),
  )

// ── Register user + create organization ────────────────────────────
export const registerUserAndOrg = createServerFn({ method: 'POST' })
  .inputValidator(registerUserInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        // B0.6: Self-service org creation is a non-core capability — disabled
        // by default in beta. Operators enable it via BETA_ALLOWLIST_ORGS.
        assertGlobalCapability('organization.create')
        const reqHeaders = await headersFromContext()
        const ip = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const { rateLimiter: rl } = getContainer()
        const rlResult = await rl.check(`auth:register:${ip}`)
        if (!rlResult.allowed) {
          throwContextError(
            'AuthError',
            { code: 'rate_limited', message: 'Too many registration attempts' },
            429,
          )
        }
        try {
          const { useCases } = getContainer()
          await useCases.registerUserAndOrg(data)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.registerUserAndOrg',
    ),
  )

// ── Sign in user ────────────────────────────────────────────────────
// Direct delegation: no use case because this is pure delegation to better-auth.

export const signInUser = createServerFn({ method: 'POST' })
  .inputValidator(signInInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const reqHeaders = await headersFromContext()
        const ip = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const { rateLimiter: rl } = getContainer()
        const rlResult = await rl.check(`auth:signin:${ip}`)
        if (!rlResult.allowed) {
          throwContextError(
            'AuthError',
            { code: 'rate_limited', message: 'Too many sign-in attempts' },
            429,
          )
        }
        const auth = getAuth()

        try {
          await auth.api.signInEmail({
            body: { email: data.email, password: data.password },
          })
        } catch (e) {
          const { getLogger } = await import('#/shared/observability/logger')
          const { maskEmail } = await import('#/shared/observability/pii')
          getLogger().warn({ email: maskEmail(data.email), err: e }, 'Sign-in failed')
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
      },
      'POST',
      'identity.signInUser',
    ),
  )

// ── Set active organization ────────────────────────────────────────

export const setActiveOrganization = createServerFn({ method: 'POST' })
  .inputValidator(setActiveOrgInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          await requireAuth(headers)
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

export const listUserInvitations = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        await requireAuth(headers)
        const { identityPort } = getContainer()

        const invitations = (await identityPort.listUserInvitations(headers)).map(
          (inv) => ({
            ...inv,
            organizationName: inv.organizationName ?? 'Unknown Organization',
          }),
        )

        return { invitations }
      } catch (e) {
        if (isIdentityError(e)) throwIdentityError(e)
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.listUserInvitations',
  ),
)
