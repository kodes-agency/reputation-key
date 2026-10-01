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
import { buildPortal } from '../../domain/constructors'
import { portalCreated, portalResponsibilityNeeded } from '../../domain/events'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import { derivePortalHealth } from '../../domain/portal-health'
import { resolveNewPortalLocales } from '../../domain/portal-new-locales'
import { planPortalContentCopy } from '../portal-content-copy'
import {
  allocateSlug,
  buildGroupMembership,
  loadCopySource,
  loadPropertyDefaultLocales,
  loadTargetGroup,
  resolveResponsibleManagers,
} from '../create-portal-resolvers'

export type CreatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  portalGroupRepo: Pick<PortalGroupRepository, 'findById'>
  portalLinkRepo: Pick<
    PortalLinkRepository,
    'listCategories' | 'listAllLinks' | 'listLinkTexts'
  >
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
    const slug = await allocateSlug(deps, ctx, pid, input)
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
    const now = deps.clock()
    const id = deps.idGen()
    const copy = source
      ? planPortalContentCopy({
          source,
          target: { portalId: id, locales },
          idGen: deps.entityIdGen,
          now,
        })
      : null
    const portalResult = buildPortal({
      id,
      organizationId: ctx.organizationId,
      propertyId: propertyId(input.propertyId),
      name: input.name,
      providedSlug: slug,
      description: input.description ?? copy?.settings.description,
      theme: input.theme ?? copy?.settings.theme,
      privateFeedbackThreshold:
        input.privateFeedbackThreshold ?? copy?.settings.privateFeedbackThreshold,
      createdBy: ctx.userId,
      hasInitialResponsibleManager: managerIds.length > 0,
      primaryGuestLocale: locales.primary,
      additionalGuestLocales: locales.additional,
      now,
    })
    if (portalResult.isErr()) throw portalResult.error
    const portal: Portal = {
      ...portalResult.value,
      linktreeEnabled: copy?.settings.linktreeEnabled ?? true,
    }

    const hasManager = managerIds.length > 0
    const factBase = {
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }

    // 5 + 6. Commit authoritative state and every required durable fact.
    await deps.commandStore.createPortal({
      organizationId: ctx.organizationId,
      portal,
      initialResponsibleManagerIds: managerIds,
      event: portalCreated({ ...factBase, publicationState: portal.publicationState }),
      ...(hasManager
        ? {}
        : { responsibilityNeededEvent: portalResponsibilityNeeded(factBase) }),
      ...(group ? { groupMembership: buildGroupMembership(group, portal) } : {}),
      ...(copy ? { copiedContent: copy.content } : {}),
      health: {
        id: deps.entityIdGen(),
        value: derivePortalHealth({
          publicationState: portal.publicationState,
          propertyAvailable: true,
          hasActivePublicationSnapshot: false,
          hasResolvablePublicAddress: false,
          hasResponsibleManager: hasManager,
          googleDestinationState: 'unavailable',
        }),
        sourceVersion: portal.updatedAt.toISOString(),
        effectiveAt: portal.createdAt,
        observedAt: portal.createdAt,
      },
    })

    // 7. Return
    return portal
  }

export type CreatePortal = ReturnType<typeof createPortal>
