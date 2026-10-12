// Identity context — finalize organization logo upload use case

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { identityError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { identityAssetPath, isIdentityAssetKey } from '../identity-assets'
import type { RetireReplacedIdentityAsset } from '../retire-replaced-identity-asset'

export type FinalizeOrgLogoUploadInput = Readonly<{
  key: string
}>

export type FinalizeOrgLogoUploadDeps = Readonly<{
  storage: StoragePort
  /** The address the organization's logo is stored at now, if any. */
  currentLogo: () => Promise<string | null>
  /** Frees the object the new logo replaces. Never throws. */
  retireReplaced: RetireReplacedIdentityAsset
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

    if (!isIdentityAssetKey(input.key)) {
      throw identityError('validation_error', 'Upload key is not a logo key')
    }

    await deps.storage.confirmUpload(input.key)
    const logoUrl = identityAssetPath(input.key)
    const previous = await deps.currentLogo()

    // Persist the logo URL on the organization. This is business persistence —
    // it belongs in the use case, not the server fn (see update-organization.ts).
    await deps.updateOrg({ logo: logoUrl })

    await deps.retireReplaced({
      previous,
      nextKey: input.key,
      kind: 'logo',
      ownerId: ctx.organizationId,
    })

    return { logoUrl }
  }

export type FinalizeOrgLogoUpload = ReturnType<typeof finalizeOrgLogoUpload>
