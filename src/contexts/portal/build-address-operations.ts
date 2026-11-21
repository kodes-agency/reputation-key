import type { PropertyLifecyclePublicApi } from '#/contexts/property/public-api'
import {
  ensurePersonalPortalToken,
  issuePortalToken,
  type IssuePortalTokenDeps,
} from './addresses/issue-portal-token.server'
import {
  revealPortalAddress,
  type RevealPortalAddressDeps,
} from './addresses/reveal-portal-address.server'
import { rotatePortalToken } from './addresses/rotate-portal-token.server'
import type { PersonalPortalPresentationDeps } from './personal-portals/personal-portal-presentation.server'
import {
  getOwnPersonalCode,
  getOwnPersonalLook,
} from './personal-portals/get-own-personal-code.server'

/** Manager and own-code commands share the same sealing and print-code bindings. */
export function buildPortalAddressOperations(
  deps: IssuePortalTokenDeps &
    RevealPortalAddressDeps &
    PersonalPortalPresentationDeps &
    Readonly<{ propertyLifecycleApi: PropertyLifecyclePublicApi }>,
) {
  return {
    issuePortalToken: issuePortalToken(deps),
    ensurePersonalPortalToken: ensurePersonalPortalToken(deps),
    rotatePortalToken: rotatePortalToken({
      ...deps,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    }),
    revealPortalAddress: revealPortalAddress(deps),
    getOwnPersonalCode: getOwnPersonalCode(deps),
    getOwnPersonalLook: getOwnPersonalLook(deps),
  }
}
