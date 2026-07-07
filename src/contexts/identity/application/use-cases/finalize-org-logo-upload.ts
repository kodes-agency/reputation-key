// Identity context — finalize organization logo upload use case

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { identityError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'

export type FinalizeOrgLogoUploadInput = Readonly<{
  key: string
}>

// fallow-ignore-next-line unused-type
export type FinalizeOrgLogoUploadDeps = Readonly<{
  storage: StoragePort
  /** Persist the logo URL on the organization via the auth provider. */
  updateOrg: (data: Record<string, unknown>) => Promise<void>
}>

export const finalizeOrgLogoUpload =
  (deps: FinalizeOrgLogoUploadDeps) =>
  async (
    input: FinalizeOrgLogoUploadInput,
    ctx: AuthContext,
  ): Promise<{ logoUrl: string }> => {
    if (!canForContext(ctx, 'identity.logo_upload')) {
      throw identityError(
        'forbidden',
        'Insufficient permissions to finalize organization logo upload',
      )
    }

    const expectedPrefix = `organizations/${ctx.organizationId}/logo/`
    if (!input.key.startsWith(expectedPrefix)) {
      throw identityError('forbidden', 'Upload key is not scoped to this organization')
    }

    const logoUrl = await deps.storage.confirmUpload(input.key)

    // Persist the logo URL on the organization. This is business persistence —
    // it belongs in the use case, not the server fn (see update-organization.ts).
    await deps.updateOrg({ logo: logoUrl })

    return { logoUrl }
  }

// fallow-ignore-next-line unused-type
export type FinalizeOrgLogoUpload = ReturnType<typeof finalizeOrgLogoUpload>
