// Portal context — list portal overview use case.
//
// The Portals overview needs, for every Portal at once: its languages, its
// health and the reason, how many page changes are waiting to be published, the
// group it is in, who is responsible for it, what its address looks like and
// whether it is published. One read answers all of that, however many Portals
// there are: each source is asked once for the whole set, never once per Portal.
//
// Scoped like `listPortals`: the caller needs `portal.read`, sees the Portals of
// the Properties they are assigned (an organisation-wide role sees all of them),
// and asking for one Property they may not see answers nothing, not an error.
// A source row that names a Portal outside the set is dropped, so a source can
// never widen the answer.

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalHealthRepository } from '../ports/portal-health.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalResponsibleManagerRepository } from '../ports/portal-responsible-manager.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { Portal } from '../../domain/types'
import type { PortalHealth } from '../../domain/portal-health'
import type { PortalPublicationState } from '../../domain/portal-publication'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalGroupId, PortalId, PropertyId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { portalError } from '../../domain/errors'
import { toPortalTokenStatus, type PortalTokenStatus } from '../portal-token-status'

export type ListPortalOverviewInput = Readonly<
  | { scope: 'property'; propertyId: string }
  | {
      scope: 'organization'
      /**
       * Narrows the read to these Properties (an empty list reads none). The
       * request layer passes the Properties whose execution policy allows the
       * read; omitted, every Property the caller may see is read.
       */
      propertyIds?: readonly string[]
    }
>

export type ListPortalOverviewDeps = Readonly<{
  portalRepo: Pick<PortalRepository, 'list' | 'listByProperty'>
  portalHealthRepo: Pick<PortalHealthRepository, 'listCurrentForPortals'>
  publicationRepo: Pick<PortalPublicationRepository, 'countOpenPendingContentChanges'>
  portalGroupRepo: Pick<PortalGroupRepository, 'listGroupsForPortals'>
  managerRepo: Pick<PortalResponsibleManagerRepository, 'listActiveForPortals'>
  portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummariesForPortals'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

/** One Portal as the overview lists it. Carries identifiers and states, no content. */
export type PortalOverviewRow = Readonly<{
  portalId: PortalId
  propertyId: PropertyId
  name: string
  slug: string
  publicationState: PortalPublicationState
  primaryGuestLocale: GuestLocale
  additionalGuestLocales: readonly GuestLocale[]
  /** Null until Health has been derived for the Portal once. */
  health: PortalHealth | null
  /** Page changes made since the live version, not yet published. */
  pendingChangeCount: number
  group: Readonly<{ id: PortalGroupId; name: string }> | null
  /** Sorted; empty means nobody is responsible for the Portal yet. */
  responsibleManagerUserIds: readonly string[]
  token: PortalTokenStatus
}>

const compareByNameThenId = (a: Portal, b: Portal): number => {
  const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  if (byName !== 0) return byName
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const groupByPortal = <T extends Readonly<{ portalId: string }>>(
  rows: readonly T[],
): ReadonlyMap<string, readonly T[]> => {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    grouped.set(row.portalId, [...(grouped.get(row.portalId) ?? []), row])
  }
  return grouped
}

const indexByPortal = <T extends Readonly<{ portalId: string }>>(
  rows: readonly T[],
): ReadonlyMap<string, T> => new Map(rows.map((row) => [row.portalId, row]))

export const listPortalOverview =
  (deps: ListPortalOverviewDeps) =>
  async (
    input: ListPortalOverviewInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<PortalOverviewRow>> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    // D6-001: scope reads to properties in the caller's staff_assignment.
    // Organization-wide roles bypass (the lookup answers null).
    const accessible = await getAccessiblePropertyIdsForPermission(
      (orgId, userId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
      ctx,
      'portal.read',
    )
    const listed =
      input.scope === 'property'
        ? await deps.portalRepo.listByProperty(
            ctx.organizationId,
            propertyId(input.propertyId),
          )
        : await deps.portalRepo.list(ctx.organizationId)
    const narrowedTo = input.scope === 'organization' ? input.propertyIds : undefined
    const portals = listed
      .filter((portal) => accessible === null || accessible.includes(portal.propertyId))
      .filter((portal) => !narrowedTo || narrowedTo.includes(portal.propertyId))
      .sort(compareByNameThenId)
    if (portals.length === 0) return []

    const portalIds = portals.map((portal) => portal.id)
    const asOf = deps.clock()
    const [healths, pending, groups, managers, tokens] = await Promise.all([
      deps.portalHealthRepo.listCurrentForPortals(ctx.organizationId, portalIds),
      deps.publicationRepo.countOpenPendingContentChanges(ctx.organizationId, portalIds),
      deps.portalGroupRepo.listGroupsForPortals(ctx.organizationId, portalIds, asOf),
      deps.managerRepo.listActiveForPortals(ctx.organizationId, portalIds),
      deps.portalTokenRepo.findResolvableSummariesForPortals(
        ctx.organizationId,
        portalIds,
        asOf,
      ),
    ])
    const healthByPortal = indexByPortal(healths)
    const pendingByPortal = indexByPortal(pending)
    const groupByPortalId = indexByPortal(groups)
    const managersByPortal = groupByPortal(managers)
    const tokenByPortal = indexByPortal(tokens)

    return portals.map((portal) => {
      const health = healthByPortal.get(portal.id)
      const group = groupByPortalId.get(portal.id)?.group
      return {
        portalId: portal.id,
        propertyId: portal.propertyId,
        name: portal.name,
        slug: portal.slug,
        publicationState: portal.publicationState,
        primaryGuestLocale: portal.primaryGuestLocale,
        additionalGuestLocales: portal.additionalGuestLocales,
        health: health ? { status: health.status, reason: health.reason } : null,
        pendingChangeCount: pendingByPortal.get(portal.id)?.count ?? 0,
        group: group ? { id: group.id, name: group.name } : null,
        responsibleManagerUserIds: (managersByPortal.get(portal.id) ?? [])
          .map((manager) => manager.userId)
          .sort(),
        token: toPortalTokenStatus(tokenByPortal.get(portal.id)),
      }
    })
  }

export type ListPortalOverview = ReturnType<typeof listPortalOverview>
