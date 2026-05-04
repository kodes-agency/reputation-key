// Identity context — finalize organization logo upload use case

import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { identityError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'

// fallow-ignore-next-line unused-type
export type FinalizeOrgLogoUploadDeps = Readonly<{
  storage: StoragePort
}>

export const finalizeOrgLogoUpload =
  (deps: FinalizeOrgLogoUploadDeps) =>
  async (input: { key: string }, ctx: AuthContext): Promise<{ logoUrl: string }> => {
    if (!can(ctx.role, 'organization.update')) {
      throw identityError(
        'forbidden',
        'Insufficient permissions to finalize organization logo upload',
      )
    }

    const logoUrl = await deps.storage.confirmUpload(input.key)

    return { logoUrl }
  }

// fallow-ignore-next-line unused-type
export type FinalizeOrgLogoUpload = ReturnType<typeof finalizeOrgLogoUpload>
