import { createPortal } from './application/use-cases/create-portal'
import {
  createPersonalPortal,
  checkPersonalPortalSource,
  type CreatePersonalPortalDeps,
} from './application/use-cases/create-personal-portal'
import {
  publishPortalChanges,
  type PublishPortalChangesDeps,
} from './application/use-cases/publish-portal-changes'
import { updatePersonalGuestPage } from './application/use-cases/update-personal-guest-page'
export const buildPersonalPortalUseCases = (
  deps: CreatePersonalPortalDeps,
  publishDeps: PublishPortalChangesDeps,
) => ({
  createPortal: createPortal(deps),
  createPersonalPortal: createPersonalPortal(deps),
  checkPersonalPortalSource: checkPersonalPortalSource(deps),
  updatePersonalGuestPage: updatePersonalGuestPage({
    ...deps,
    portalTokenRepo: publishDeps.portalTokenRepo,
    publishChanges: publishPortalChanges(publishDeps),
  }),
})
