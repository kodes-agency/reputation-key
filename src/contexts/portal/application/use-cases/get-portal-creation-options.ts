// Portal context — what the New portal dialog needs to know about a Property:
// the languages a new Portal starts with and who may be made responsible. The
// groups and the Portals that can be copied come from the reads the Portals
// page already holds, so this adds only what no other read answers.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import { resolveNewPortalLocales } from '../../domain/portal-new-locales'
import { loadPropertyDefaultLocales } from '../create-portal-resolvers'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import {
  listEligiblePortalManagers,
  type PortalManagerEligibilityDeps,
} from '../portal-manager-eligibility'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'

export type GetPortalCreationOptionsDeps = PortalManagerEligibilityDeps &
  Readonly<{
    propertyApi: PropertyPublicApi
    experienceRepo: Pick<PortalExperienceRepository, 'getPropertyExperience'>
  }>

export type PortalCreationOptions = Readonly<{
  /** The languages a new Portal starts with, first = primary. Never empty. */
  defaultGuestLocales: readonly OfferedGuestLocale[]
  /** Managers who may be made responsible for a Portal of this Property. */
  eligibleManagerUserIds: readonly string[]
  /** Whether the caller is one of them (and so responsible by default). */
  creatorIsEligible: boolean
}>

export const getPortalCreationOptions =
  (deps: GetPortalCreationOptionsDeps) =>
  async (
    input: Readonly<{ propertyId: string }>,
    ctx: AuthContext,
  ): Promise<PortalCreationOptions> => {
    await assertNewPortalPropertyAccess(
      deps,
      ctx,
      input.propertyId,
      'this role cannot create portals',
    )
    const [defaults, eligible] = await Promise.all([
      loadPropertyDefaultLocales(deps, ctx, input.propertyId),
      listEligiblePortalManagers(
        deps,
        ctx.organizationId,
        toPropertyId(input.propertyId),
      ),
    ])
    const { primary, additional } = resolveNewPortalLocales({
      propertyDefaults: defaults,
    })
    const eligibleManagerUserIds = eligible.map((manager) => manager.userId)
    return {
      defaultGuestLocales: [primary, ...additional],
      eligibleManagerUserIds,
      creatorIsEligible: eligibleManagerUserIds.includes(ctx.userId),
    }
  }

export type GetPortalCreationOptions = ReturnType<typeof getPortalCreationOptions>
