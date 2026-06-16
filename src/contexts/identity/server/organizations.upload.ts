// Upload server functions (org logo + user avatar request/finalize).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { getContainer } from '#/composition'
import { randomUUID } from 'crypto'
import { isIdentityError } from '../domain/errors'
import { MAX_UPLOAD_BYTES } from './organizations.shared'
import { throwIdentityError } from './organizations.errors.server'
import { requestOrgLogoUpload as requestOrgLogoUploadUseCase } from '../application/use-cases/request-org-logo-upload'
import { finalizeOrgLogoUpload as finalizeOrgLogoUploadUseCase } from '../application/use-cases/finalize-org-logo-upload'
import { requestAvatarUpload as requestAvatarUploadUseCase } from '../application/use-cases/request-avatar-upload'
import { finalizeAvatarUpload as finalizeAvatarUploadUseCase } from '../application/use-cases/finalize-avatar-upload'

// ── Organization logo upload ────────────────────────────────────────

const requestOrgLogoUploadSchema = z.object({
  contentType: z.string(),
  fileSize: z.number().positive().max(MAX_UPLOAD_BYTES),
})

export const requestOrgLogoUpload = createServerFn({ method: 'POST' })
  .inputValidator(requestOrgLogoUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { storage } = getContainer()
        const useCase = requestOrgLogoUploadUseCase({
          storage,
          idGen: () => randomUUID(),
        })
        try {
          return await useCase(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.requestOrgLogoUpload',
    ),
  )

const finalizeOrgLogoUploadSchema = z.object({
  key: z.string().min(1),
})

export const finalizeOrgLogoUpload = createServerFn({ method: 'POST' })
  .inputValidator(finalizeOrgLogoUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { storage } = getContainer()
        const useCase = finalizeOrgLogoUploadUseCase({ storage })
        try {
          const result = await useCase(data, ctx)

          // Persist the logo URL on the organization via better-auth
          const auth = getAuth()
          await auth.api.updateOrganization({
            headers,
            body: { data: { logo: result.logoUrl } },
          })

          return result
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.finalizeOrgLogoUpload',
    ),
  )

// ── User avatar upload ──────────────────────────────────────────────
// Uses user-scoped S3 keys (avatars/${userId}/${uuid}).
// No org-side side effects — the client persists via authClient.updateUser.

const requestAvatarUploadSchema = z.object({
  contentType: z.string(),
  fileSize: z.number().positive().max(MAX_UPLOAD_BYTES),
})

export const requestAvatarUpload = createServerFn({ method: 'POST' })
  .inputValidator(requestAvatarUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { storage } = getContainer()
        const useCase = requestAvatarUploadUseCase({ storage, idGen: () => randomUUID() })
        try {
          return await useCase(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.requestAvatarUpload',
    ),
  )

const finalizeAvatarUploadSchema = z.object({
  key: z.string().min(1),
})

export const finalizeAvatarUpload = createServerFn({ method: 'POST' })
  .inputValidator(finalizeAvatarUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { storage } = getContainer()
        const useCase = finalizeAvatarUploadUseCase({ storage })
        try {
          return await useCase(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.finalizeAvatarUpload',
    ),
  )
