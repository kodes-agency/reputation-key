// Identity context — server functions for auth settings (change password, update profile)
// Thin wrappers around better-auth API with tracedHandler for observability.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { throwContextError } from '#/shared/auth/server-errors'
import { getLogger } from '#/shared/observability/logger'
import { z } from 'zod/v4'

/** Common catch handler for better-auth calls: log original error, map to domain error. */
const handleAuthError = (
  error: unknown,
  errorName: string,
  code: string,
  message: string,
  status: number,
): never => {
  // Log the original error for diagnostics before mapping to domain error
  getLogger().warn({ err: error }, `${errorName}: ${code}`)
  throwContextError(errorName, { code, message }, status)
}

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
        const headers = headersFromContext()
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
            400,
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
        const headers = headersFromContext()
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
            400,
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
        const headers = headersFromContext()
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
            400,
          )
        }
      },
      'POST',
      'identity.updateUserImage',
    ),
  )

// ── Create organization ────────────────────────────────────────────

const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
})

export const createOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(createOrganizationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const auth = getAuth()

        try {
          await auth.api.createOrganization({
            headers,
            body: {
              name: data.name,
              slug: data.slug,
            },
          })
        } catch (e) {
          handleAuthError(
            e,
            'IdentityError',
            'org_setup_failed',
            'Failed to create organization.',
            409,
          )
        }
      },
      'POST',
      'identity.createOrganization',
    ),
  )
