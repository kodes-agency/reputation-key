import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import type {
  PortalPublicationActivationRecord,
  PortalPublicationRepository,
} from '../ports/portal-publication.repository'
import { workingCopyMatchesSnapshot } from '../portal-working-copy-match'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  namedVersionActor,
  resolveVersionActors,
  versionActor,
  type PortalVersionActor,
} from '../portal-version-actors'
import { portalError } from '../../domain/errors'

export type PortalPublicationHistoryItem = Readonly<{
  activationSequence: number
  version: number
  kind: 'publish' | 'rollback'
  /** Who published or restored this version. A person the directory cannot name has no name. */
  activatedBy: PortalVersionActor
  activatedAt: string
  deactivatedAt: string | null
  deactivationReason: 'disabled' | 'archived' | 'replaced' | null
}>

export type PortalPublicationHistory = Readonly<{
  current: PortalPublicationHistoryItem | null
  priorActivations: ReadonlyArray<PortalPublicationHistoryItem>
  hasPendingChanges: boolean
  pendingChanges?: ReadonlyArray<
    Readonly<{
      kind: import('../ports/portal-publication.repository').PortalPendingContentChange['kind']
      key: string
      changedAt: string
      /** Who made the change; null for the system and for a change made before it was recorded. */
      changedBy: PortalVersionActor | null
    }>
  >
  nextCursor: number | null
}>

const DEFAULT_HISTORY_PAGE_SIZE = 20
const MAX_HISTORY_PAGE_SIZE = 50

type Deps = Readonly<{
  portalRepo: PortalRepository
  publicationRepo: PortalPublicationRepository
  staffPublicApi: StaffPublicApi
  actorDirectory: PortalActorDirectory
}>

function historyItem(
  record: PortalPublicationActivationRecord,
  names: ReadonlyMap<string, string>,
): PortalPublicationHistoryItem {
  return {
    activationSequence: record.activation.activationSequence,
    version: record.snapshot.version,
    kind: record.activation.kind,
    activatedBy: namedVersionActor(record.activation.activatedBy, names),
    activatedAt: record.activation.activatedAt.toISOString(),
    deactivatedAt: record.activation.deactivatedAt?.toISOString() ?? null,
    deactivationReason: record.activation.deactivationReason,
  }
}

export const getPortalPublicationHistory =
  (deps: Deps) =>
  async (
    input: Readonly<{ portalId: string; cursor?: number; limit?: number }>,
    ctx: AuthContext,
  ): Promise<PortalPublicationHistory> => {
    const pid = portalId(input.portalId)
    const portal = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to view Portal publication history',
    })
    const requestedLimit = input.limit ?? DEFAULT_HISTORY_PAGE_SIZE
    const limit = Number.isSafeInteger(requestedLimit)
      ? Math.min(MAX_HISTORY_PAGE_SIZE, Math.max(1, requestedLimit))
      : DEFAULT_HISTORY_PAGE_SIZE
    const beforeSequence =
      input.cursor !== undefined && Number.isSafeInteger(input.cursor) && input.cursor > 0
        ? input.cursor
        : null
    const [workingCopy, page, pendingChanges] = await Promise.all([
      deps.publicationRepo.loadWorkingCopy(ctx.organizationId, pid),
      deps.publicationRepo.listActivationHistoryPage(
        ctx.organizationId,
        portal.propertyId,
        pid,
        { beforeSequence, limit },
      ),
      deps.publicationRepo.listOpenPendingContentChanges?.(
        ctx.organizationId,
        portal.propertyId,
        pid,
      ) ?? Promise.resolve([]),
    ])
    if (!workingCopy) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Portal publication details are temporarily unavailable',
      )
    }

    const currentRecord = page.current
    const baseline = page.current ?? page.latest
    const names = await resolveVersionActors(deps.actorDirectory, ctx.organizationId, [
      ...(currentRecord ? [currentRecord.activation.activatedBy] : []),
      ...page.records.map((record) => record.activation.activatedBy),
      ...pendingChanges.map((change) => change.changedBy),
    ])
    return {
      current: currentRecord ? historyItem(currentRecord, names) : null,
      priorActivations: page.records
        .filter(
          (record) =>
            record.activation.activationSequence !==
            currentRecord?.activation.activationSequence,
        )
        .map((record) => historyItem(record, names)),
      hasPendingChanges:
        pendingChanges.length > 0 ||
        (baseline ? !workingCopyMatchesSnapshot(workingCopy, baseline.snapshot) : false),
      pendingChanges: pendingChanges.map((change) => ({
        kind: change.kind,
        key: change.key,
        changedAt: change.changedAt.toISOString(),
        changedBy: versionActor(change.changedBy, names),
      })),
      nextCursor: page.nextCursor,
    }
  }

export type GetPortalPublicationHistory = ReturnType<typeof getPortalPublicationHistory>
