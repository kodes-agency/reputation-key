import { createPortal } from './application/use-cases/create-portal'
import {
  createPersonalPortal,
  checkPersonalPortalSource,
  type CreatePersonalPortalDeps,
} from './application/use-cases/create-personal-portal'
export const buildPersonalPortalUseCases = (deps: CreatePersonalPortalDeps) => ({
  createPortal: createPortal(deps),
  createPersonalPortal: createPersonalPortal(deps),
  checkPersonalPortalSource: checkPersonalPortalSource(deps),
})
