import type { PropertyLifecyclePublicApi } from '#/contexts/property/application/public-api'
import {
  ensurePersonalPortalToken,
  issuePortalToken,
  type IssuePortalTokenDeps,
} from './application/use-cases/issue-portal-token'
import {
  revealPortalAddress,
  type RevealPortalAddressDeps,
} from './application/use-cases/reveal-portal-address'
import { rotatePortalToken } from './application/use-cases/rotate-portal-token'
import { getOwnPersonalCode } from './application/use-cases/get-own-personal-code'

/** Manager and own-code commands share the same sealing and print-code bindings. */
export function buildPortalAddressOperations(
  deps: IssuePortalTokenDeps &
    RevealPortalAddressDeps &
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
  }
}
