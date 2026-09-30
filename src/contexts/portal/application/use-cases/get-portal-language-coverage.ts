// Portal context — the language coverage read (round 4, slice 29).
//
// For each language a Portal offers: how much of the wording guests read is
// written, and what is missing. Read-only and gated by `portal.read` in the
// Portal's Property, like the other editor reads. It composes reads the Portal
// already has (the Property's wording, the Portal's own wording, the links and
// their per-language texts); nothing is stored for it.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  computePortalLanguageCoverage,
  type PortalLanguageCoverage,
} from '../../domain/portal-language-coverage'

export type GetPortalLanguageCoverageInput = Readonly<{ portalId: string }>

export type GetPortalLanguageCoverageDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  experienceRepo: PortalExperienceRepository
  staffPublicApi: StaffPublicApi
}>

export const getPortalLanguageCoverage =
  (deps: GetPortalLanguageCoverageDeps) =>
  async (
    input: GetPortalLanguageCoverageInput,
    ctx: AuthContext,
  ): Promise<PortalLanguageCoverage> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to read Portal languages',
    })
    const [experience, overrides, links, linkTexts] = await Promise.all([
      deps.experienceRepo.getPropertyExperience(ctx.organizationId, portal.propertyId),
      deps.experienceRepo.listPortalOverrides(
        ctx.organizationId,
        portal.propertyId,
        portal.id,
      ),
      deps.portalLinkRepo.listAllLinks(ctx.organizationId, portal.id),
      deps.portalLinkRepo.listLinkTexts(
        ctx.organizationId,
        portal.id,
        portal.primaryGuestLocale,
      ),
    ])
    return computePortalLanguageCoverage({
      portalId: portal.id,
      primaryLocale: portal.primaryGuestLocale,
      additionalLocales: portal.additionalGuestLocales,
      propertyContent: experience.content,
      overrides,
      links,
      linkTexts,
    })
  }

export type GetPortalLanguageCoverage = ReturnType<typeof getPortalLanguageCoverage>
