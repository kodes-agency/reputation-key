// Identity context — finalize user avatar upload use case.
// Confirms the upload landed within the size cap and returns the address the
// avatar is shown at (a path on the app, see identity-assets.ts). Does NOT
// persist to any entity (the caller persists through the updateUserImageFn
// server function). Nothing makes a caller run this step before that one, so
// the save makes the same checks itself (`assertOwnStoredAvatar`).

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { identityAssetPath, isIdentityAssetKey } from '../identity-assets'
import { assertStoredUploadAllowed } from '../upload-policy'

export type FinalizeAvatarUploadInput = Readonly<{
  key: string
}>

export type FinalizeAvatarUploadDeps = Readonly<{
  storage: StoragePort
}>

/**
 * What an uploaded avatar passes before its address is handed out or saved:
 * the key is this user's own, it has the avatar key shape, and the object the
 * store holds is within the size cap. The owner is checked first, because an
 * object over the cap is removed.
 */
export const assertOwnStoredAvatar = async (
  storage: Pick<StoragePort, 'inspectObject' | 'deleteObject'>,
  key: string,
  userId: string,
): Promise<void> => {
  if (!key.startsWith(`avatars/${userId}/`)) {
    throw identityError('forbidden', 'Upload key is not scoped to this user')
  }

  if (!isIdentityAssetKey(key)) {
    throw identityError('validation_error', 'Upload key is not an avatar key')
  }

  await assertStoredUploadAllowed(storage, key)
}

export const finalizeAvatarUpload =
  (deps: FinalizeAvatarUploadDeps) =>
  async (
    input: FinalizeAvatarUploadInput,
    ctx: AuthContext,
  ): Promise<{ avatarUrl: string }> => {
    if (!canForContext(ctx, 'identity.avatar_upload')) {
      throw identityError('forbidden', 'Insufficient permissions to upload avatar')
    }

    await assertOwnStoredAvatar(deps.storage, input.key, ctx.userId)
    return { avatarUrl: identityAssetPath(input.key) }
  }

export type FinalizeAvatarUpload = ReturnType<typeof finalizeAvatarUpload>
