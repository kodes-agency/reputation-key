import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type {
  PortalPublicationActivationRecord,
  PortalPublicationRepository,
} from '../ports/portal-publication.repository'
import type {
  PortalPublicationSnapshot,
  PortalPublicationSource,
} from '../../domain/portal-publication-snapshot'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { portalError } from '../../domain/errors'

export type PortalPublicationHistoryItem = Readonly<{
  activationSequence: number
  version: number
  kind: 'publish' | 'rollback'
  activatedAt: string
  deactivatedAt: string | null
  deactivationReason: 'disabled' | 'archived' | 'replaced' | null
}>

export type PortalPublicationHistory = Readonly<{
  current: PortalPublicationHistoryItem | null
  priorActivations: ReadonlyArray<PortalPublicationHistoryItem>
  hasPendingChanges: boolean
}>

type Deps = Readonly<{
  portalRepo: PortalRepository
  publicationRepo: PortalPublicationRepository
  staffPublicApi: StaffPublicApi
}>

function publishedContent(snapshot: PortalPublicationSnapshot) {
  return {
    portal: snapshot.configuration.portal,
    categories: snapshot.configuration.categories,
    links: snapshot.configuration.links,
    privateFeedbackThreshold:
      snapshot.configuration.reviewGateway.privateFeedbackThreshold,
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
  } satisfies PortalPublicationSource
}

function workingCopyMatches(
  workingCopy: PortalPublicationSource,
  snapshot: PortalPublicationSnapshot,
): boolean {
  return (
    canonicalizeRfc8785(workingCopy) === canonicalizeRfc8785(publishedContent(snapshot))
  )
}

function historyItem(
  record: PortalPublicationActivationRecord,
): PortalPublicationHistoryItem {
  return {
    activationSequence: record.activation.activationSequence,
    version: record.snapshot.version,
    kind: record.activation.kind,
    activatedAt: record.activation.activatedAt.toISOString(),
    deactivatedAt: record.activation.deactivatedAt?.toISOString() ?? null,
    deactivationReason: record.activation.deactivationReason,
  }
}

export const getPortalPublicationHistory =
  (deps: Deps) =>
  async (
    input: Readonly<{ portalId: string }>,
    ctx: AuthContext,
  ): Promise<PortalPublicationHistory> => {
    const pid = portalId(input.portalId)
    const portal = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to view Portal publication history',
    })
    const [workingCopy, records] = await Promise.all([
      deps.publicationRepo.loadWorkingCopy(ctx.organizationId, pid),
      deps.publicationRepo.listActivationHistory(
        ctx.organizationId,
        portal.propertyId,
        pid,
      ),
    ])
    if (!workingCopy) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Portal publication details are temporarily unavailable',
      )
    }

    const currentRecord = records.find(
      ({ activation }) => activation.deactivatedAt === null,
    )
    const baseline = currentRecord ?? records[0]
    return {
      current: currentRecord ? historyItem(currentRecord) : null,
      priorActivations: records
        .filter((record) => record !== currentRecord)
        .map(historyItem),
      hasPendingChanges: baseline
        ? !workingCopyMatches(workingCopy, baseline.snapshot)
        : false,
    }
  }

export type GetPortalPublicationHistory = ReturnType<typeof getPortalPublicationHistory>
