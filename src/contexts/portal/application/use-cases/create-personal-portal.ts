import {
  assertPersonalPropertySource,
  assertPersonalPublicationReady,
} from '../personal-portal-property-source'
import { listEligiblePortalManagers } from '../portal-manager-eligibility'
import {
  assertPropertyAllowsPublication,
  loadVerifiedGoogleReviewDestination,
} from '../portal-publication-readiness'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/application/public-api'
import type { PortalResponsibleManagerRepository } from '../ports/portal-responsible-manager.repository'
import type { PortalPrintWordingRepository } from '../ports/portal-print-wording.repository'
import type { PortalLastPrintRepository } from '../ports/portal-last-print.repository'
import {
  printFinalOpeningWording,
  PRINT_FINAL_DEFAULT_WORDING,
} from '#/shared/domain/portal-print-final-wording'
import { assertPersonalPortalPublicText } from '../../domain/personal-portal-public-text'
import { loadCopySource, loadTargetGroup } from '../create-portal-resolvers'
import { linksToCopy } from '../portal-content-copy'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, propertyId, type PropertyId } from '#/shared/domain/ids'
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
    managerRepo: Pick<PortalResponsibleManagerRepository, 'listActive'>
    printWordingRepo: Pick<PortalPrintWordingRepository, 'find'>
    lastPrintRepo: Pick<PortalLastPrintRepository, 'find'>
    propertyLifecycleApi: PropertyLifecyclePublicApi
    propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
    addressRecoverable: boolean
    checkGroupTarget: (
      scope: Readonly<{
        organizationId: string
        propertyId: string
        portalGroupId: string
        at: Date
        skipsPrivateRating: boolean
      }>,
    ) => Promise<void>
  }>

export const checkPersonalPortalSource =
  (deps: CreatePersonalPortalDeps) =>
  async (
    input: Readonly<{
      displayNames?: readonly string[]
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
    if (input.portalGroupId) await loadTargetGroup(deps, ctx, pid, input.portalGroupId)
    const checkGroupTarget = async (skipsPrivateRating: boolean) => {
      if (!input.portalGroupId) return
      await deps.checkGroupTarget({
        organizationId: ctx.organizationId,
        propertyId: pid,
        portalGroupId: input.portalGroupId,
        at: deps.clock(),
        skipsPrivateRating,
      })
    }
    if (!deps.addressRecoverable) {
      throw portalError(
        'address_keyring_missing',
        'Configure Portal address recovery before adding staff',
      )
    }
    // Publishing runs these two first. A check that passes must mean publish won't
    // refuse, or the person ends up with a draft Portal and an unfinished setup.
    await assertPropertyAllowsPublication(deps, ctx.organizationId, { propertyId: pid })
    await loadVerifiedGoogleReviewDestination(deps, ctx.organizationId, {
      propertyId: pid,
    })
    if (!input.sourcePortalId) {
      await checkGroupTarget(false)
      await assertPersonalPropertySource(deps, ctx, pid, input.displayNames)
      return null
    }
    const source = await readPersonalCopySource(
      deps,
      ctx,
      pid,
      input.sourcePortalId,
      input.displayNames,
    )
    await checkGroupTarget(source.skipPrivateRating)
    return source
  }

/** The live, reviewed Portal a person's guest page may take its content from. */
export async function readPersonalCopySource(
  deps: CreatePersonalPortalDeps,
  ctx: AuthContext,
  pid: PropertyId,
  sourcePortalId: string,
  displayNames?: readonly string[],
) {
  const source = await deps.portalRepo.findById(
    ctx.organizationId,
    portalId(sourcePortalId),
  )
  if (!source || source.propertyId !== pid || source.deletedAt) {
    throw portalError('portal_not_found', 'Choose a Portal at this Property')
  }
  if (source.publicationState === 'archived') {
    throw portalError('source_archived', 'Choose a Portal that is not archived')
  }
  const [working, snapshot] = await Promise.all([
    deps.publicationRepo.loadWorkingCopy(ctx.organizationId, source.id),
    deps.publicationRepo.findActiveForPortal(ctx.organizationId, source.id),
  ])
  if (working) assertPersonalPublicationReady(working, displayNames)
  if (!working || !snapshot || !workingCopyMatchesSnapshot(working, snapshot)) {
    throw portalError(
      'source_has_unpublished_changes',
      'Publish the changes on the Portal being copied first',
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
    const managerIds = source
      ? await copiedManagerIds(deps, ctx, input.propertyId, source.id)
      : undefined
    const printWording = source
      ? await copiedPrintWording(deps, ctx, source.id, input.displayName)
      : null
    return createPortal({
      ...deps,
      idGen: () => portalId(input.portalId),
      personalPortal: {
        publicName,
        ...(printWording ? { printWording } : {}),
        ...(source ? { copySource: source.copy, sourceFence: source.sourceFence } : {}),
      },
    })(
      {
        propertyId: input.propertyId,
        name: input.displayName,
        ...(managerIds ? { responsibleManagerUserIds: managerIds } : {}),
        ...(input.sourcePortalId
          ? { startFrom: { kind: 'portal', portalId: input.sourcePortalId } }
          : {}),
        ...(input.portalGroupId ? { groupId: input.portalGroupId } : {}),
      },
      ctx,
    )
  }

async function copiedManagerIds(
  deps: CreatePersonalPortalDeps,
  ctx: AuthContext,
  pid: string,
  sourceId: string,
) {
  const [assigned, eligible] = await Promise.all([
    deps.managerRepo.listActive(ctx.organizationId, sourceId),
    listEligiblePortalManagers(deps, ctx.organizationId, propertyId(pid)),
  ])
  const ids = assigned
    .filter((row) => eligible.some((manager) => manager.userId === row.userId))
    .map((row) => row.userId)
  return ids.length ? ids : undefined
}

export async function copiedPrintWording(
  deps: CreatePersonalPortalDeps,
  ctx: AuthContext,
  sourceId: string,
  name: string,
) {
  const [saved, last] = await Promise.all([
    deps.printWordingRepo.find(ctx.organizationId, portalId(sourceId)),
    deps.lastPrintRepo.find(ctx.organizationId, portalId(sourceId)),
  ])
  const wording = printFinalOpeningWording(saved, last?.settings ?? null)
  if (
    wording.callToAction === PRINT_FINAL_DEFAULT_WORDING.callToAction &&
    !wording.customWords
  )
    return null
  try {
    assertPersonalPortalPublicText({ kind: 'personal', name }, wording.customWords)
    return wording
  } catch {
    return null
  }
}
