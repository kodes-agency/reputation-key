// Portal context — create portal use case
// Full pattern: authorize → resolve every choice (address, group, what to start
// from, languages, managers) → build → atomically persist with facts → return.
// Nothing is written until every choice resolved, so a refusal creates nothing.

import type { PortalRepository } from '../ports/portal.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { Portal, PortalId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalInput } from '../dto/create-portal.dto'
export type { CreatePortalInput }
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { PortalApprovedDestinationRepository } from '../ports/portal-approved-destination.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import { resolveNewPortalLocales } from '../../domain/portal-new-locales'
import { buildCreatePortalCommand, type NewPortalPlan } from '../create-portal-commit'
import {
  allocateSlug,
  loadCopySource,
  loadPropertyDefaultLocales,
  loadTargetGroup,
  resolveResponsibleManagers,
} from '../create-portal-resolvers'

const isSlugTaken = (error: unknown): boolean =>
  isPortalError(error) && error.code === 'slug_taken'

export type CreatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  portalGroupRepo: Pick<PortalGroupRepository, 'findById'>
  portalLinkRepo: Pick<
    PortalLinkRepository,
    'listCategories' | 'listAllLinks' | 'listLinkTexts'
  >
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'list'>
  experienceRepo: Pick<
    PortalExperienceRepository,
    'getPropertyExperience' | 'listPortalOverrides'
  >
  propertyApi: PropertyPublicApi
  staffPublicApi: StaffPublicApi
  identityPublicApi: IdentityManagerFactsPublicApi
  commandStore: PortalCommandStore
  idGen: () => PortalId
  /** Identifiers of everything else the command writes (health, copied rows). */
  entityIdGen: () => string
  clock: () => Date
}>

export const createPortal =
  (deps: CreatePortalDeps) =>
  async (input: CreatePortalInput, ctx: AuthContext): Promise<Portal> => {
    // 1. Authorize + 2. validate referenced property exists + assignment access (D6-001)
    const pid = await assertNewPortalPropertyAccess(
      deps,
      ctx,
      input.propertyId,
      'this role cannot create portals',
    )

    // 3. Resolve every choice before anything is built or written.
    const group = input.groupId
      ? await loadTargetGroup(deps, ctx, pid, input.groupId)
      : null
    const source =
      input.startFrom?.kind === 'portal'
        ? await loadCopySource(deps, ctx, pid, input.startFrom.portalId)
        : null
    const managerIds = await resolveResponsibleManagers(
      deps,
      ctx,
      pid,
      input.responsibleManagerUserIds,
    )
    const locales = resolveNewPortalLocales({
      requested: input.guestLocales,
      source: source?.portal && {
        primary: source.portal.primaryGuestLocale,
        additional: source.portal.additionalGuestLocales,
      },
      propertyDefaults: await loadPropertyDefaultLocales(deps, ctx, input.propertyId),
    })

    // 4. Build the domain object (a copy's settings first; what was typed wins).
    const plan: NewPortalPlan = { input, locales, managerIds, group, source }
    const commit = async (slug: string): Promise<Portal> => {
      const command = buildCreatePortalCommand(deps, ctx, plan, slug)
      await deps.commandStore.createPortal(command)
      return command.portal
    }

    // The address is checked now and unique at commit; another create may take
    // it in between. A derived address then moves to the next free one, once.
    const slug = await allocateSlug(deps, ctx, pid, input)
    try {
      return await commit(slug)
    } catch (error) {
      if (!isSlugTaken(error) || input.slug !== undefined) throw error
      return commit(await allocateSlug(deps, ctx, pid, input))
    }
  }

export type CreatePortal = ReturnType<typeof createPortal>
