// Portal context — the lookups behind createPortal: the web address, the group,
// the Portal being copied and the responsible managers. Each resolves one
// choice the New portal dialog makes into something the command can commit, or
// refuses with a Portal error before anything is written.

import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalGroupId,
  portalId as toPortalId,
  propertyId as toPropertyId,
  userId as toUserId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import { portalAddedToGroup } from '../domain/events'
import {
  hasUsablePortalAddress,
  ID_SLUG_LENGTHS,
  idBasedPortalSlug,
  MAX_SLUG_SUFFIX_ATTEMPTS,
  portalSlugBase,
  slugWithSuffix,
} from '../domain/portal-slug'
import type { Portal, PortalGroup } from '../domain/types'
import { loadPortalOrThrow } from './load-accessible-portal'
import { nextPortalCommandAt } from './portal-command-version'
import {
  isEligiblePortalManager,
  listEligiblePortalManagers,
  type PortalManagerEligibilityDeps,
} from './portal-manager-eligibility'
import type { PortalCopySource } from './portal-content-copy'
import type { CreatePortalGroupMembership } from './ports/portal-command-store.port'
import type { PortalApprovedDestinationRepository } from './ports/portal-approved-destination.repository'
import type { PortalExperienceRepository } from './ports/portal-experience.repository'
import type { PortalGroupRepository } from './ports/portal-group.repository'
import type { PortalLinkRepository } from './ports/portal-link.repository'
import type { PortalRepository } from './ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

type SlugDeps = Readonly<{ portalRepo: Pick<PortalRepository, 'slugExists'> }>

/**
 * The address the new Portal gets. One the manager typed must be free; one
 * derived from the name takes the next free numbered variant instead of failing;
 * a name that gives no address (no Latin letters or digits) takes one from the
 * Portal's own id, a longer slice of it if a shorter one is held, so it never
 * walks a counter one lookup at a time.
 */
export async function allocateSlug(
  deps: SlugDeps,
  ctx: AuthContext,
  propertyId: PropertyId,
  input: Readonly<{ name: string; slug?: string }>,
  newPortalId: string,
): Promise<string> {
  const taken = (slug: string) =>
    deps.portalRepo.slugExists(ctx.organizationId, propertyId, slug)
  if (input.slug !== undefined) {
    if (await taken(input.slug)) {
      throw portalError('slug_taken', 'a portal with this slug already exists')
    }
    return input.slug
  }
  const candidates = hasUsablePortalAddress(input.name)
    ? Array.from({ length: MAX_SLUG_SUFFIX_ATTEMPTS }, (_, n) =>
        slugWithSuffix(portalSlugBase(input.name), n + 1),
      )
    : [
        ...new Set(
          ID_SLUG_LENGTHS.map((length) => idBasedPortalSlug(newPortalId, length)),
        ),
      ]
  for (const candidate of candidates) {
    if (!(await taken(candidate))) return candidate
  }
  throw portalError(
    'slug_taken',
    'no free web address is left for this name; try a different name',
  )
}

type GroupDeps = Readonly<{ portalGroupRepo: Pick<PortalGroupRepository, 'findById'> }>

/** The group the new Portal joins; it must be an active group of the same Property. */
export async function loadTargetGroup(
  deps: GroupDeps,
  ctx: AuthContext,
  propertyId: PropertyId,
  rawGroupId: string,
): Promise<PortalGroup> {
  const group = await deps.portalGroupRepo.findById(
    ctx.organizationId,
    portalGroupId(rawGroupId),
  )
  if (
    !group ||
    group.deletedAt !== null ||
    group.organizationId !== ctx.organizationId ||
    group.propertyId !== propertyId
  ) {
    throw portalError('group_not_found', 'portal group not found for this property')
  }
  return group
}

/** The membership the command commits with the Portal, fencing the group it joins. */
export function buildGroupMembership(
  group: PortalGroup,
  portal: Portal,
): CreatePortalGroupMembership {
  const revision = nextPortalCommandAt(portal.createdAt, group.updatedAt)
  return {
    portalGroupId: group.id,
    expectedGroupUpdatedAt: group.updatedAt,
    revision,
    event: portalAddedToGroup({
      portalGroupId: group.id,
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt: portal.createdAt,
    }),
  }
}

type SourceDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  portalLinkRepo: Pick<
    PortalLinkRepository,
    'listCategories' | 'listAllLinks' | 'listLinkTexts'
  >
  experienceRepo: Pick<PortalExperienceRepository, 'listPortalOverrides'>
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'list'>
}>

/**
 * Everything read from the Portal being copied, which must sit in the same
 * Property and must not be archived: a retired portal is not a starting point.
 */
export async function loadCopySource(
  deps: SourceDeps,
  ctx: AuthContext,
  propertyId: PropertyId,
  rawPortalId: string,
): Promise<PortalCopySource> {
  const portal = await loadPortalOrThrow(deps, ctx, toPortalId(rawPortalId), {
    permission: 'portal.read',
    forbiddenMessage: 'Insufficient permissions to read the portal being copied',
  })
  if (portal.propertyId !== propertyId) {
    throw portalError('portal_not_found', 'portal not found for this property')
  }
  if (portal.publicationState === 'archived') {
    throw portalError('portal_inactive', 'an archived portal cannot be copied')
  }
  const [overrides, categories, links, linkTexts, destinations] = await Promise.all([
    deps.experienceRepo.listPortalOverrides(ctx.organizationId, propertyId, portal.id),
    deps.portalLinkRepo.listCategories(ctx.organizationId, portal.id),
    deps.portalLinkRepo.listAllLinks(ctx.organizationId, portal.id),
    deps.portalLinkRepo.listLinkTexts(
      ctx.organizationId,
      portal.id,
      portal.primaryGuestLocale,
    ),
    deps.destinationRepo.list(ctx.organizationId, propertyId),
  ])
  const approvedDestinationIds = new Set<string>(
    destinations
      .filter((destination) => destination.approvalState === 'approved')
      .map((destination) => destination.id),
  )
  return { portal, overrides, categories, links, linkTexts, approvedDestinationIds }
}

/**
 * Who is responsible from the start. Omitted: the creator, when eligible, else
 * nobody. Named: every one must be eligible for the Property, none twice.
 */
export async function resolveResponsibleManagers(
  deps: PortalManagerEligibilityDeps,
  ctx: AuthContext,
  propertyId: PropertyId,
  requested: readonly string[] | undefined,
): Promise<readonly UserId[]> {
  if (requested === undefined) {
    const creatorIsEligible = await isEligiblePortalManager(
      deps,
      ctx.organizationId,
      propertyId,
      ctx.userId,
    )
    return creatorIsEligible ? [ctx.userId] : []
  }
  if (new Set(requested).size !== requested.length) {
    throw portalError(
      'responsible_manager_ineligible',
      'responsible manager selection contains duplicates',
    )
  }
  if (requested.length === 0) return []
  const eligible = new Set(
    (await listEligiblePortalManagers(deps, ctx.organizationId, propertyId)).map(
      (manager) => manager.userId,
    ),
  )
  if (requested.some((id) => !eligible.has(id))) {
    throw portalError(
      'responsible_manager_ineligible',
      'one or more selected managers are not eligible for this property',
    )
  }
  return requested.map(toUserId)
}

/** The Property's default guest languages, empty when it has no Brand Profile yet. */
export async function loadPropertyDefaultLocales(
  deps: Readonly<{
    experienceRepo: Pick<PortalExperienceRepository, 'getPropertyExperience'>
  }>,
  ctx: AuthContext,
  propertyId: string,
) {
  const { profile } = await deps.experienceRepo.getPropertyExperience(
    ctx.organizationId,
    toPropertyId(propertyId),
  )
  return profile?.defaultGuestLocales ?? []
}
