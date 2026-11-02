import { loadCopySource, loadTargetGroup } from '../create-portal-resolvers'
import { linksToCopy } from '../portal-content-copy'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, propertyId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { workingCopyMatchesSnapshot } from '../portal-working-copy-match'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import { createPortal, type CreatePortalDeps } from './create-portal'

export type CreatePersonalPortalDeps = CreatePortalDeps &
  Readonly<{
    publicationRepo: Pick<
      PortalPublicationRepository,
      'loadWorkingCopy' | 'findActiveForPortal'
    >
    addressRecoverable: boolean
    checkGroupTarget: (
      scope: Readonly<{
        organizationId: string
        propertyId: string
        portalGroupId: string
        at: Date
      }>,
    ) => Promise<void>
  }>

export const checkPersonalPortalSource =
  (deps: CreatePersonalPortalDeps) =>
  async (
    input: Readonly<{
      propertyId: string
      sourcePortalId?: string
      portalGroupId?: string
    }>,
    ctx: AuthContext,
  ) => {
    const pid = await assertNewPortalPropertyAccess(
      deps,
      ctx,
      input.propertyId,
      'This account cannot add staff at this Property',
    )
    if (input.portalGroupId) {
      await loadTargetGroup(deps, ctx, pid, input.portalGroupId)
      await deps.checkGroupTarget({
        organizationId: ctx.organizationId,
        propertyId: pid,
        portalGroupId: input.portalGroupId,
        at: deps.clock(),
      })
    }
    if (!deps.addressRecoverable) {
      throw portalError(
        'address_keyring_missing',
        'Configure Portal address recovery before adding staff',
      )
    }
    if (!input.sourcePortalId) {
      const { profile } = await deps.experienceRepo.getPropertyExperience(
        ctx.organizationId,
        pid,
      )
      if (!profile?.displayName)
        throw portalError(
          'brand_profile_missing',
          'Set the Property public display name before adding staff',
        )
      if (profile.displayName.length > 100)
        throw portalError(
          'invalid_name',
          'Shorten the Property public display name to 100 characters before adding staff',
        )
      return null
    }
    const source = await deps.portalRepo.findById(
      ctx.organizationId,
      portalId(input.sourcePortalId),
    )
    if (!source || source.propertyId !== input.propertyId || source.deletedAt) {
      throw portalError('portal_not_found', 'Choose a Portal at this Property')
    }
    if (source.publicationState === 'archived') {
      throw portalError('source_archived', 'Choose a Portal that is not archived')
    }
    const [working, snapshot] = await Promise.all([
      deps.publicationRepo.loadWorkingCopy(ctx.organizationId, source.id),
      deps.publicationRepo.findActiveForPortal(ctx.organizationId, source.id),
    ])
    if (!working || !snapshot || !workingCopyMatchesSnapshot(working, snapshot)) {
      throw portalError(
        'source_has_unpublished_changes',
        'Publish the source Portal changes before adding staff',
      )
    }
    const copy = await loadCopySource(deps, ctx, pid, source.id)
    const copied = new Set(linksToCopy(copy).map((link) => link.id))
    return {
      ...source,
      copy,
      sourceFence: { portalId: source.id, updatedAt: source.updatedAt, snapshot },
      omittedLinks: copy.links
        .filter((link) => !copied.has(link.id))
        .map((link) => ({ id: String(link.id), label: link.label })),
    }
  }

/** Uses the ordinary copy command with a caller-reserved Portal id. */
export const createPersonalPortal =
  (deps: CreatePersonalPortalDeps) =>
  async (
    input: Readonly<{
      portalId: string
      propertyId: string
      displayName: string
      sourcePortalId?: string
      portalGroupId?: string
    }>,
    ctx: AuthContext,
  ) => {
    await assertNewPortalPropertyAccess(
      deps,
      ctx,
      input.propertyId,
      'This account cannot add staff at this Property',
    )
    const existing = await deps.portalRepo.findById(
      ctx.organizationId,
      portalId(input.portalId),
    )
    if (existing) {
      if (existing.kind !== 'personal' || existing.propertyId !== input.propertyId) {
        throw portalError('forbidden', 'The reserved Portal belongs to another operation')
      }
      return existing
    }
    const source = await checkPersonalPortalSource(deps)(input, ctx)
    const { profile } = await deps.experienceRepo.getPropertyExperience(
      ctx.organizationId,
      propertyId(input.propertyId),
    )
    const publicName = source?.publicName ?? source?.name ?? profile?.displayName
    if (!publicName)
      throw portalError(
        'brand_profile_missing',
        'Set the Property public display name before adding staff',
      )
    return createPortal({
      ...deps,
      idGen: () => portalId(input.portalId),
      personalPortal: {
        publicName,
        ...(source ? { copySource: source.copy, sourceFence: source.sourceFence } : {}),
      },
    })(
      {
        propertyId: input.propertyId,
        name: input.displayName,
        ...(input.sourcePortalId
          ? { startFrom: { kind: 'portal', portalId: input.sourcePortalId } }
          : {}),
        ...(input.portalGroupId ? { groupId: input.portalGroupId } : {}),
      },
      ctx,
    )
  }
