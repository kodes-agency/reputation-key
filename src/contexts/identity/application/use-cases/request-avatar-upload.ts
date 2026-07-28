// Identity context — request user avatar upload URL use case.
// Separate from org logo upload: uses user-scoped S3 keys and no org side effects.

import type { IdentityStoragePort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { assertUploadAllowed, MAX_UPLOAD_BYTES } from '../upload-policy'
export type RequestAvatarUploadInput = Readonly<{
  contentType: string
  fileSize: number
}>

export type RequestAvatarUploadDeps = Readonly<{
  storage: IdentityStoragePort
  idGen: () => string
}>

export const requestAvatarUpload =
  (deps: RequestAvatarUploadDeps) =>
  async (
    input: RequestAvatarUploadInput,
    ctx: AuthContext,
  ): Promise<{ uploadUrl: string; key: string }> => {
    assertUploadAllowed(
      ctx,
      'identity.avatar_upload',
      input,
      'Insufficient permissions to upload avatar',
    )

    const key = `avatars/${ctx.userId}/${deps.idGen()}`
    const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
      key,
      input.contentType,
      MAX_UPLOAD_BYTES,
    )

    return { uploadUrl, key }
  }

export type RequestAvatarUpload = ReturnType<typeof requestAvatarUpload>
