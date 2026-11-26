// Upload server functions (org logo + user avatar request/finalize).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import { identityCommandErrors } from './organizations.shared'
import { z } from 'zod/v4'
import { getAuth } from '#/shared/auth/auth'
import { getContainer } from '#/composition'
import { MAX_UPLOAD_BYTES } from '../images/identity-assets.contracts'
import { retireReplacedIdentityAsset } from '../images/retire-replaced-identity-asset.server'
import { requestOrgLogoUpload as requestOrgLogoUploadUseCase } from '../images/request-org-logo-upload.server'
import { finalizeOrgLogoUpload as finalizeOrgLogoUploadUseCase } from '../images/finalize-org-logo-upload.server'
import { requestAvatarUpload as requestAvatarUploadUseCase } from '../images/request-avatar-upload.server'
import { finalizeAvatarUpload as finalizeAvatarUploadUseCase } from '../images/finalize-avatar-upload.server'

// ── Organization logo upload ────────────────────────────────────────

const requestOrgLogoUploadSchema = z.object({
  contentType: z.string(),
  fileSize: z.number().positive().max(MAX_UPLOAD_BYTES),
})

export const requestOrgLogoUpload = createServerFn({ method: 'POST' })
  .validator(requestOrgLogoUploadSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.requestOrgLogoUpload',
        action: 'identity.logo_upload',
        errors: identityCommandErrors,
      },
      async ({ data, actor: ctx }) => {
        const { assetStorage: storage, idGen } = getContainer()
        const useCase = requestOrgLogoUploadUseCase({
          storage,
          idGen,
        })
        return useCase(data, ctx)
      },
    ),
  )

const finalizeOrgLogoUploadSchema = z.object({
  key: z.string().min(1),
})

export const finalizeOrgLogoUpload = createServerFn({ method: 'POST' })
  .validator(finalizeOrgLogoUploadSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.finalizeOrgLogoUpload',
        action: 'identity.logo_upload',
        errors: identityCommandErrors,
      },
      async ({ data, actor: ctx, headers }) => {
        const { assetStorage: storage, identityAssetReferences, logger } = getContainer()
        const useCase = finalizeOrgLogoUploadUseCase({
          storage,
          currentLogo: () =>
            identityAssetReferences.currentOrganizationLogo(ctx.organizationId),
          retireReplaced: retireReplacedIdentityAsset({ storage, logger }),
          // Persist the logo via the auth provider — injected as a closure so the
          // use case owns the persistence step (mirrors update-organization.server.ts).
          updateOrg: async (updateData) => {
            const auth = getAuth()
            await auth.api.updateOrganization({ headers, body: { data: updateData } })
          },
        })
        return useCase(data, ctx)
      },
    ),
  )

// ── User avatar upload ──────────────────────────────────────────────
// Uses user-scoped S3 keys (avatars/${userId}/${uuid}).
// No org-side side effects — the client persists through updateUserImageFn
// (the provider's raw /update-user route is not served).

const requestAvatarUploadSchema = z.object({
  contentType: z.string(),
  fileSize: z.number().positive().max(MAX_UPLOAD_BYTES),
})

export const requestAvatarUpload = createServerFn({ method: 'POST' })
  .validator(requestAvatarUploadSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.requestAvatarUpload',
        action: 'identity.avatar_upload',
        errors: identityCommandErrors,
      },
      async ({ data, actor: ctx }) => {
        const { assetStorage: storage, idGen } = getContainer()
        const useCase = requestAvatarUploadUseCase({
          storage,
          idGen,
        })
        return useCase(data, ctx)
      },
    ),
  )

const finalizeAvatarUploadSchema = z.object({
  key: z.string().min(1),
})

export const finalizeAvatarUpload = createServerFn({ method: 'POST' })
  .validator(finalizeAvatarUploadSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.finalizeAvatarUpload',
        action: 'identity.avatar_upload',
        errors: identityCommandErrors,
      },
      async ({ data, actor: ctx }) => {
        const { assetStorage: storage } = getContainer()
        const useCase = finalizeAvatarUploadUseCase({ storage })
        return useCase(data, ctx)
      },
    ),
  )
