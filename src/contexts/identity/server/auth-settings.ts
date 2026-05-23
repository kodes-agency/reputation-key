// Identity context — server functions for auth settings (change password, update profile)
// Thin wrappers around better-auth API with tracedHandler for observability.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { throwContextError } from '#/shared/auth/server-errors'
import { getLogger } from '#/shared/observability/logger'
import { z } from 'zod/v4'

/** Map better-auth APIError status codes to appropriate HTTP status + domain code. */
const handleAuthError = (
  error: unknown,
  errorName: string,
  code: string,
  fallbackMessage: string,
): never => {
  // Distinguish error types for proper HTTP status mapping
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const apiError = error as { statusCode: number; message?: string }
    const status = apiError.statusCode
    const message = apiError.message ?? fallbackMessage

    getLogger().warn({ err: error, statusCode: status }, `${errorName}: ${code}`)

    if (status === 401) {
      throwContextError(
        errorName,
        { code: 'unauthorized', message: 'Authentication required' },
        401,
      )
    }
    if (status === 403) {
      throwContextError(
        errorName,
        { code: 'forbidden', message: 'Insufficient permissions' },
        403,
      )
    }
    if (status === 404) {
      throwContextError(errorName, { code: 'not_found', message }, 404)
    }
    if (status === 409) {
      throwContextError(errorName, { code: 'conflict', message }, 409)
    }
    if (status === 429) {
      throwContextError(
        errorName,
        { code: 'rate_limited', message: 'Too many requests' },
        429,
      )
    }
    // Client errors (4xx) — forward with original status
    if (status >= 400 && status < 500) {
      throwContextError(errorName, { code, message }, status)
    }
  }

  // Fallback for non-APIError errors
  getLogger().warn({ err: error }, `${errorName}: ${code}`)
  throwContextError(errorName, { code, message: fallbackMessage }, 400)
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
          )
        }
      },
      'POST',
      'identity.createOrganization',
    ),
  )
