// Identity context — finalize user avatar upload use case.
// Confirms the S3 upload and returns the URL. Does NOT persist to any entity
// (the caller persists via authClient.updateUser on the client side).

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'

export type FinalizeAvatarUploadInput = Readonly<{
  key: string
}>

export type FinalizeAvatarUploadDeps = Readonly<{
  storage: StoragePort
}>

export const finalizeAvatarUpload =
  (deps: FinalizeAvatarUploadDeps) =>
  async (
    input: FinalizeAvatarUploadInput,
    ctx: AuthContext,
  ): Promise<{ avatarUrl: string }> => {
    if (!canForContext(ctx, 'identity.avatar_upload')) {
      throw identityError('forbidden', 'Insufficient permissions to upload avatar')
    }

    const expectedPrefix = `avatars/${ctx.userId}/`
    if (!input.key.startsWith(expectedPrefix)) {
      throw identityError('forbidden', 'Upload key is not scoped to this user')
    }

    const avatarUrl = await deps.storage.confirmUpload(input.key)
    return { avatarUrl }
  }

export type FinalizeAvatarUpload = ReturnType<typeof finalizeAvatarUpload>
