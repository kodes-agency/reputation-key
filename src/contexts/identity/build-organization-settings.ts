// Identity context — Organization settings wiring.
//
// Split out of build.ts so the context build stays under its file-length
// ratchet. This is the one place `updateOrganization` is composed: the server
// function calls the instance built here, so the logo cleanup it is wired with
// is the cleanup production runs.

import type { LoggerPort } from '#/shared/domain/logger.port'
import type { IdentityAssetReferencesPort } from './application/ports/identity-asset-references.port'
import { retireReplacedIdentityAsset } from './application/retire-replaced-identity-asset'
import { updateOrganization } from './application/use-cases/update-organization'

export type OrganizationSettingsUseCaseDeps = Readonly<{
  /** Saves the Organization through the auth provider, as the signed-in caller. */
  saveOrganization: (data: Record<string, unknown>) => Promise<void>
  assetReferences: Pick<IdentityAssetReferencesPort, 'currentOrganizationLogo'>
  /** Deletes one stored avatar or logo object. */
  deleteAssetObject: (key: string) => Promise<void>
  logger: Pick<LoggerPort, 'warn'>
}>

export function buildOrganizationSettingsUseCases(deps: OrganizationSettingsUseCaseDeps) {
  return {
    updateOrganization: updateOrganization({
      updateOrg: deps.saveOrganization,
      // A removed logo is freed from the store once the removal is saved.
      currentLogo: deps.assetReferences.currentOrganizationLogo,
      retireReplaced: retireReplacedIdentityAsset({
        storage: { deleteObject: deps.deleteAssetObject },
        logger: deps.logger,
      }),
    }),
  } as const
}
