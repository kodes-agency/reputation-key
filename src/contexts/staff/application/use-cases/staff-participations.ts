import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type {
  ResponsibilitySelection,
  StaffParticipationRepository,
} from '../ports/staff-participation.repository'
import {
  createParticipation,
  type StaffParticipation,
} from '../../domain/staff-participation'
import { createStaffParticipant } from '../../domain/staff-participant'
import { staffError } from '../../domain/errors'

export type StaffParticipationDeps = Readonly<{
  repo: StaffParticipationRepository
  accessibleProperties: (
    organizationId: OrganizationId,
    userId: UserId,
  ) => Promise<readonly PropertyId[]>
  clock: () => Date
  idGen: () => string
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

async function requirePropertyManage(
  deps: StaffParticipationDeps,
  ctx: AuthContext,
  rawPropertyId: string,
): Promise<void> {
  if (!canForContext(ctx, 'staff.manage')) {
    throw staffError('forbidden', 'staff participation management is not permitted')
  }
  if (scopeForPermission(ctx, 'staff.manage') === 'organization') return
  const property = toPropertyId(rawPropertyId)
  const accessible = await deps.accessibleProperties(ctx.organizationId, ctx.userId)
  if (!accessible.includes(property)) {
    throw staffError('forbidden', 'no access to this property')
  }
}

export const createStaffParticipation =
  (deps: StaffParticipationDeps) =>
  async (
    input: Readonly<{ propertyId: string; displayName: string }>,
    ctx: AuthContext,
  ): Promise<StaffParticipation> => {
    await requirePropertyManage(deps, ctx, input.propertyId)
    const displayName = input.displayName.trim()
    if (displayName.length === 0 || displayName.length > 255) {
      throw staffError(
        'invalid_input',
        'display name must be between 1 and 255 characters',
      )
    }
    const now = deps.clock()
    const participant = createStaffParticipant({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      displayName,
      createdBy: ctx.userId,
      now,
    })
    const participation = createParticipation({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      staffParticipantId: participant.id,
      displayName,
      createdBy: ctx.userId,
      now,
    })
    return deps.repo.createParticipantWithParticipation({ participant, participation })
  }

export type StaffResponsibilitySelectionView = Readonly<{
  staffParticipationId: string
  primaryPortalId: string | null
  supportingPortalIds: readonly string[]
  revision: number
}>

export const listStaffParticipations =
  (deps: StaffParticipationDeps) =>
  async (
    input: Readonly<{ propertyId?: string; userId?: string; activeOnly?: boolean }>,
    ctx: AuthContext,
  ): Promise<
    Readonly<{
      participations: readonly StaffParticipation[]
      responsibilities: readonly StaffResponsibilitySelectionView[]
    }>
  > => {
    if (!canForContext(ctx, 'staff.read')) {
      throw staffError('forbidden', 'staff participation read is not permitted')
    }

    let participations: readonly StaffParticipation[]
    if (input.propertyId) {
      if (scopeForPermission(ctx, 'staff.read') !== 'organization') {
        const accessible = await deps.accessibleProperties(ctx.organizationId, ctx.userId)
        if (!accessible.includes(toPropertyId(input.propertyId))) {
          throw staffError('forbidden', 'no access to this property')
        }
      }
      participations = await deps.repo.list(ctx.organizationId, input)
    } else if (scopeForPermission(ctx, 'staff.read') === 'organization') {
      participations = await deps.repo.list(ctx.organizationId, input)
    } else {
      const accessible = await deps.accessibleProperties(ctx.organizationId, ctx.userId)
      const rows = await Promise.all(
        accessible.map((propertyId) =>
          deps.repo.list(ctx.organizationId, {
            ...input,
            propertyId,
          }),
        ),
      )
      participations = rows.flat()
    }

    const responsibilities = await Promise.all(
      participations.map(async (participation) => {
        const rows = await deps.repo.listActiveResponsibilities(
          ctx.organizationId,
          participation.id,
        )
        return {
          staffParticipationId: participation.id,
          primaryPortalId: rows.find((row) => row.kind === 'primary')?.portalId ?? null,
          supportingPortalIds: rows
            .filter((row) => row.kind === 'supporting')
            .map((row) => row.portalId),
          revision: participation.revision,
        } satisfies StaffResponsibilitySelectionView
      }),
    )

    return { participations, responsibilities }
  }

export const archiveStaffParticipation =
  (deps: StaffParticipationDeps) =>
  async (
    input: Readonly<{
      staffParticipationId: string
      reason: string
      expectedRevision: number
    }>,
    ctx: AuthContext,
  ): Promise<StaffParticipation> => {
    const participation = await deps.repo.findById(
      ctx.organizationId,
      input.staffParticipationId,
    )
    if (!participation) {
      throw staffError('participation_not_found', 'staff participation not found')
    }
    await requirePropertyManage(deps, ctx, participation.propertyId)
    if (participation.status === 'archived') {
      // The archive write and cross-context eligibility reconciliation cannot
      // share one transaction. Re-run the idempotent reconciliation when an
      // operator retries after a post-commit failure.
      if (participation.linkedUserId) {
        await deps.reconcileResponsibleManagerEligibility?.(
          ctx.organizationId,
          participation.linkedUserId,
          ctx.userId,
        )
      }
      return participation
    }
    const reason = input.reason.trim()
    if (reason.length === 0) {
      throw staffError('invalid_input', 'archive reason is required')
    }
    const archived = await deps.repo.archive(
      ctx.organizationId,
      participation.id,
      deps.clock(),
      reason,
      input.expectedRevision,
    )
    if (!archived) {
      throw staffError('participation_not_found', 'staff participation not found')
    }
    if (archived.linkedUserId) {
      await deps.reconcileResponsibleManagerEligibility?.(
        ctx.organizationId,
        archived.linkedUserId,
        ctx.userId,
      )
    }
    return archived
  }

export const updatePortalResponsibilities =
  (deps: StaffParticipationDeps) =>
  async (
    input: Readonly<{
      staffParticipationId: string
      primaryPortalId: string | null
      supportingPortalIds: readonly string[]
      expectedRevision: number
    }>,
    ctx: AuthContext,
  ) => {
    const participation = await deps.repo.findById(
      ctx.organizationId,
      input.staffParticipationId,
    )
    if (!participation) {
      throw staffError('participation_not_found', 'staff participation not found')
    }
    await requirePropertyManage(deps, ctx, participation.propertyId)
    if (participation.status !== 'active') {
      throw staffError(
        'participation_archived',
        'responsibilities require active participation',
      )
    }

    const supporting = [...new Set(input.supportingPortalIds)]
    if (input.primaryPortalId && supporting.includes(input.primaryPortalId)) {
      throw staffError('invalid_input', 'primary portal cannot also be supporting')
    }
    const selections: ResponsibilitySelection[] = [
      ...(input.primaryPortalId
        ? [{ portalId: input.primaryPortalId, kind: 'primary' as const }]
        : []),
      ...supporting.map((portalId) => ({ portalId, kind: 'supporting' as const })),
    ]

    return deps.repo.replaceResponsibilities({
      organizationId: ctx.organizationId,
      propertyId: participation.propertyId,
      staffParticipationId: participation.id,
      selections,
      actorId: ctx.userId,
      at: deps.clock(),
      expectedRevision: input.expectedRevision,
    })
  }
