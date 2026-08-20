import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type {
  PortalApprovedDestinationRatioRecorded,
  PortalConfigurationCompletenessRecorded,
  PortalContentReviewCompleted,
} from '../../domain/events'
import { portalError } from '../../domain/errors'
import type { PortalRepository } from '../ports/portal.repository'
import { assertPropertyAccess } from '../assert-property-access'

export type PortalWorkflowSupersedes = Readonly<{
  contentReviewSourceEventId: string
  configurationSourceEventId: string
  destinationRatioSourceEventId: string
}>

export type PortalWorkflowFactCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  reviewId: string
  revision: number
  supersedes: PortalWorkflowSupersedes | null
  occurredAt: Date
}>

export type PortalWorkflowFactEvent =
  | PortalContentReviewCompleted
  | PortalConfigurationCompletenessRecorded
  | PortalApprovedDestinationRatioRecorded

export type PortalWorkflowFactResult = Readonly<{
  status: 'recorded' | 'duplicate'
  events: readonly PortalWorkflowFactEvent[]
}>

export type PortalWorkflowFactStore = Readonly<{
  recordCompletedReview(
    command: PortalWorkflowFactCommand,
  ): Promise<PortalWorkflowFactResult>
}>

export type CompleteContentReviewInput = Readonly<{
  portalId: string
  reviewId: string
  revision: number
  supersedes?: PortalWorkflowSupersedes | null
}>

type PortalGroupLookup = Readonly<{
  findGroupForPortal(
    organizationId: OrganizationId,
    portalId: PortalId,
    asOf: Date,
  ): Promise<Readonly<{ id: PortalGroupId; propertyId: PropertyId }> | null>
}>

export type CompleteContentReviewDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  portalGroupLookup: PortalGroupLookup
  factStore: PortalWorkflowFactStore
  clock: () => Date
}>

export const completeContentReview = (deps: CompleteContentReviewDeps) => {
  return async (
    input: CompleteContentReviewInput,
    ctx: AuthContext,
  ): Promise<PortalWorkflowFactResult> => {
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot complete Portal content review')
    }
    if (input.reviewId.trim().length === 0) {
      throw portalError('invalid_name', 'reviewId must be non-empty')
    }
    if (!Number.isInteger(input.revision) || input.revision < 1) {
      throw portalError('invalid_name', 'revision must be a positive integer')
    }
    if (input.revision > 1 && !input.supersedes) {
      throw portalError('invalid_name', 'a correction must identify all superseded facts')
    }
    if (input.revision === 1 && input.supersedes) {
      throw portalError('invalid_name', 'an initial review cannot supersede another fact')
    }

    const portal = await deps.portalRepo.findById(
      ctx.organizationId,
      toPortalId(input.portalId),
    )
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.update',
      portal.propertyId,
    )
    if (portal.publicationState !== 'published') {
      throw portalError(
        'invalid_publication_transition',
        'content review can only be completed for published Portal content',
      )
    }

    const occurredAt = deps.clock()
    const group = await deps.portalGroupLookup.findGroupForPortal(
      ctx.organizationId,
      portal.id,
      occurredAt,
    )
    if (group && group.propertyId !== portal.propertyId) {
      throw portalError('forbidden', 'Portal group attribution crosses property scope')
    }

    return deps.factStore.recordCompletedReview({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      portalGroupId: group?.id ?? null,
      reviewId: input.reviewId,
      revision: input.revision,
      supersedes: input.supersedes ?? null,
      occurredAt,
    })
  }
}
