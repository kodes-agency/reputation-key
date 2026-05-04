// Identity context — request user avatar upload URL use case.
// Separate from org logo upload: uses user-scoped S3 keys and no org side effects.

import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { identityError } from '../../domain/errors'
import { randomUUID } from 'crypto'

// fallow-ignore-next-line unused-type
export type RequestAvatarUploadDeps = Readonly<{
  storage: StoragePort
}>

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

export const requestAvatarUpload =
  (deps: RequestAvatarUploadDeps) =>
  async (
    input: { contentType: string; fileSize: number },
    ctx: AuthContext,
  ): Promise<{ uploadUrl: string; key: string }> => {
    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
      throw identityError(
        'validation_error',
        `Content type ${input.contentType} is not allowed`,
      )
    }

    if (input.fileSize > MAX_FILE_SIZE) {
      throw identityError('validation_error', 'File size exceeds 5 MB limit')
    }

    const key = `avatars/${ctx.userId}/${randomUUID()}`
    const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
      key,
      input.contentType,
      MAX_FILE_SIZE,
    )

    return { uploadUrl, key }
  }

// fallow-ignore-next-line unused-type
export type RequestAvatarUpload = ReturnType<typeof requestAvatarUpload>
