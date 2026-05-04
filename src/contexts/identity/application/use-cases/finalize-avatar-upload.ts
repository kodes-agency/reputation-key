// Identity context — finalize user avatar upload use case.
// Confirms the S3 upload and returns the URL. Does NOT persist to any entity
// (the caller persists via authClient.updateUser on the client side).

import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'

// fallow-ignore-next-line unused-type
export type FinalizeAvatarUploadDeps = Readonly<{
  storage: StoragePort
}>

export const finalizeAvatarUpload =
  (deps: FinalizeAvatarUploadDeps) =>
  async (input: { key: string }, _ctx: AuthContext): Promise<{ avatarUrl: string }> => {
    const avatarUrl = await deps.storage.confirmUpload(input.key)
    return { avatarUrl }
  }

// fallow-ignore-next-line unused-type
export type FinalizeAvatarUpload = ReturnType<typeof finalizeAvatarUpload>
