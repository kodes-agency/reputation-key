// Portal context — create portal use case
// Full pattern: authorize → resolve every choice (address, group, what to start
// from, languages, managers) → build → atomically persist with facts → return.
// Nothing is written until every choice resolved, so a refusal creates nothing.

import type { PortalRepository } from './portal-repository.port.server'
import type { PropertyPublicApi } from '#/contexts/property/public-api'
import type { Portal, PortalId } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalInput } from './create-portal.contracts'
export type { CreatePortalInput }
import { isPortalError } from '../domain/errors'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/public-api'
import { assertNewPortalPropertyAccess } from './load-accessible-portal.server'
import type { PortalCommandStore } from './portal-command-store-port.server'
import type { PortalApprovedDestinationRepository } from '../destinations/portal-approved-destination-repository.port.server'
import type { PortalExperienceRepository } from '../editor/portal-experience-repository.port.server'
import type { PortalGroupRepository } from '../groups/portal-group-repository.port.server'
import type { PortalLinkRepository } from '../links/portal-link-repository.port.server'
import type { PortalLookRepository } from '../look/portal-look-repository.port.server'
import { resolveNewPortalLocales } from '../domain/portal-new-locales'
import type { PortalCopySource } from './portal-content-copy.server'
import type { CreatePortalCommand } from './portal-command-store-port.server'
import {
  buildCreatePortalCommand,
  type NewPortalPlan,
} from './create-portal-commit.server'
import {
  allocateSlug,
  loadCopySource,
  loadPropertyDefaultLocales,
  loadTargetGroup,
  resolveResponsibleManagers,
} from './create-portal-resolvers.server'

const isSlugTaken = (error: unknown): boolean =>
  isPortalError(error) && error.code === 'slug_taken'

export type CreatePortalDeps = Readonly<{
  personalPortal?: Readonly<{
    printWording?: import('#/shared/domain/portal-print-wording').PrintSavedWording
    publicName: string
    copySource?: PortalCopySource
    sourceFence?: CreatePortalCommand['personalSourceFence']
  }>
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
  /** The own look of the Portal a new one starts from (ADR 0070). */
  portalLookRepo: Pick<PortalLookRepository, 'findForPortal'>
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
      deps.personalPortal?.copySource ??
      (input.startFrom?.kind === 'portal'
        ? await loadCopySource(deps, ctx, pid, input.startFrom.portalId)
        : null)
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
    const portalId = deps.idGen()
    const plan: NewPortalPlan = {
      portalId,
      input,
      locales,
      managerIds,
      group,
      source,
      personalPortal: deps.personalPortal,
    }
    const commit = async (slug: string): Promise<Portal> => {
      const command = buildCreatePortalCommand(deps, ctx, plan, slug)
      await deps.commandStore.createPortal(command)
      return command.portal
    }

    // The address is checked now and unique at commit; another create may take
    // it in between. A derived address then moves to the next free one, once.
    const slug = await allocateSlug(
      deps,
      ctx,
      pid,
      deps.personalPortal ? { name: '' } : input,
      portalId,
    )
    try {
      return await commit(slug)
    } catch (error) {
      if (!isSlugTaken(error) || input.slug !== undefined) throw error
      return commit(
        await allocateSlug(
          deps,
          ctx,
          pid,
          deps.personalPortal ? { name: '' } : input,
          portalId,
        ),
      )
    }
  }

export type CreatePortal = ReturnType<typeof createPortal>
