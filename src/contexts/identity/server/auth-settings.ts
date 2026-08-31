// Identity context — server functions for auth settings (change password, update profile)
// Thin wrappers around better-auth API with tracedHandler for observability.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { handleAuthError } from './auth-settings.helpers'
import { changePasswordCommandSchema } from '../application/dto/change-password.dto'
import {
  updateProfileInputSchema,
  updateUserImageInputSchema,
} from '../application/dto/profile-settings.dto'

// ── Change password ────────────────────────────────────────────────

export const changePasswordFn = createServerFn({ method: 'POST' })
  .validator(changePasswordCommandSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'identity.password.change' })
        const auth = getAuth()

        try {
          await auth.api.changePassword({
            headers,
            body: {
              currentPassword: data.currentPassword,
              newPassword: data.newPassword,
              // Better Auth rotates the current session and invalidates every
              // other device session when this is true.
              revokeOtherSessions: true,
            },
          })
        } catch (e) {
          const { getContainer } = await import('#/composition')
          handleAuthError(
            getContainer().logger,
            e,
            'AuthError',
            'password_change_failed',
            'Failed to change password. Please check your current password.',
          )
        }
      },
      'POST',
      'identity.changePassword',
    ),
  )

// ── Update profile ─────────────────────────────────────────────────

export const updateProfileFn = createServerFn({ method: 'POST' })
  .validator(updateProfileInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'identity.profile.update' })
        const auth = getAuth()

        try {
          await auth.api.updateUser({
            headers,
            body: { name: data.name },
          })
        } catch (e) {
          const { getContainer } = await import('#/composition')
          handleAuthError(
            getContainer().logger,
            e,
            'AuthError',
            'profile_update_failed',
            'Failed to update profile.',
          )
        }
      },
      'POST',
      'identity.updateProfile',
    ),
  )

// ── Update user image ──────────────────────────────────────────────

export const updateUserImageFn = createServerFn({ method: 'POST' })
  .validator(updateUserImageInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'identity.avatar.set' })
        const auth = getAuth()

        try {
          await auth.api.updateUser({
            headers,
            body: { image: data.imageUrl },
          })
        } catch (e) {
          const { getContainer } = await import('#/composition')
          handleAuthError(
            getContainer().logger,
            e,
            'AuthError',
            'avatar_update_failed',
            'Failed to update avatar.',
          )
        }
      },
      'POST',
      'identity.updateUserImage',
    ),
  )
