// Identity context — server functions for auth settings (change password, update profile)
// Thin wrappers around better-auth API with tracedHandler for observability.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { z } from 'zod/v4'
import { handleAuthError } from './auth-settings.helpers'

// ── Change password ────────────────────────────────────────────────

export const changePasswordFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    }),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'identity.password.change')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'Insufficient permissions to change password' },
            403,
          )
        }
        const auth = getAuth()

        try {
          await auth.api.changePassword({
            headers,
            body: {
              currentPassword: data.currentPassword,
              newPassword: data.newPassword,
            },
          })
        } catch (e) {
          handleAuthError(
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

const updateProfileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
})

export const updateProfileFn = createServerFn({ method: 'POST' })
  .inputValidator(updateProfileSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'identity.profile.update')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'Insufficient permissions to update profile' },
            403,
          )
        }
        const auth = getAuth()

        try {
          await auth.api.updateUser({
            headers,
            body: { name: data.name },
          })
        } catch (e) {
          handleAuthError(
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

const updateUserImageSchema = z.object({
  imageUrl: z.string().url(),
})

export const updateUserImageFn = createServerFn({ method: 'POST' })
  .inputValidator(updateUserImageSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'identity.avatar.set')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'Insufficient permissions to update avatar' },
            403,
          )
        }
        const auth = getAuth()

        try {
          await auth.api.updateUser({
            headers,
            body: { image: data.imageUrl },
          })
        } catch (e) {
          handleAuthError(
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

// Re-export createOrganizationFn from split file
export { createOrganizationFn } from './auth-settings.org'
