// Identity context — finalize user avatar upload use case.
// Confirms the upload landed and returns the address the avatar is shown at (an
// address on the app, see identity-assets.ts). Does NOT persist to any entity
// (the caller persists via authClient.updateUser on the client side).

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { isIdentityAssetKey } from '../identity-assets'

export type FinalizeAvatarUploadInput = Readonly<{
  key: string
}>

export type FinalizeAvatarUploadDeps = Readonly<{
  storage: StoragePort
  /** The address an uploaded object is shown at: `identityAssetUrl` on the app's base URL. */
  assetUrl: (key: string) => string
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

    if (!isIdentityAssetKey(input.key)) {
      throw identityError('validation_error', 'Upload key is not an avatar key')
    }

    await deps.storage.confirmUpload(input.key)
    return { avatarUrl: deps.assetUrl(input.key) }
  }

export type FinalizeAvatarUpload = ReturnType<typeof finalizeAvatarUpload>
