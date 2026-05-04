// Identity context — request organization logo upload URL use case

import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { identityError } from '../../domain/errors'
import { randomUUID } from 'crypto'
import { can } from '#/shared/domain/permissions'

// fallow-ignore-next-line unused-type
export type RequestOrgLogoUploadDeps = Readonly<{
  storage: StoragePort
}>

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB for logos

export const requestOrgLogoUpload =
  (deps: RequestOrgLogoUploadDeps) =>
  async (
    input: { contentType: string; fileSize: number },
    ctx: AuthContext,
  ): Promise<{ uploadUrl: string; key: string }> => {
    if (!can(ctx.role, 'organization.update')) {
      throw identityError(
        'forbidden',
        'Insufficient permissions to upload organization logo',
      )
    }

    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
      throw identityError(
        'validation_error',
        `Content type ${input.contentType} is not allowed`,
      )
    }

    if (input.fileSize > MAX_FILE_SIZE) {
      throw identityError('validation_error', 'File size exceeds 5 MB limit')
    }

    const key = `organizations/${ctx.organizationId}/logo/${randomUUID()}`
    const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
      key,
      input.contentType,
      MAX_FILE_SIZE,
    )

    return { uploadUrl, key }
  }

// fallow-ignore-next-line unused-type
export type RequestOrgLogoUpload = ReturnType<typeof requestOrgLogoUpload>
