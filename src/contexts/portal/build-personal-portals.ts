import { createPortal } from './publication/create-portal.server'
import {
  createPersonalPortal,
  checkPersonalPortalSource,
  type CreatePersonalPortalDeps,
} from './personal-portals/create-personal-portal.server'
import {
  publishPortalChanges,
  type PublishPortalChangesDeps,
} from './publication/publish-portal-changes.server'
import { updatePersonalGuestPage } from './personal-portals/update-personal-guest-page.server'
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
