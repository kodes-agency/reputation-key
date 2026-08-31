import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../../ports/user-lookup.port'
import type {
  ActivityRecoveryStore,
  RecentActivityRecoveryCursor,
} from '../../ports/activity-recovery-store.port'
import {
  RECENT_ACTIVITY_REBUILD_BATCH_MAX,
  RECENT_ACTIVITY_VISIBILITY_TARGET_MS,
  type ProjectableRecentActivityReplayFact,
} from '../../domain/recent-activity-replay-fact'
import {
  prepareRecentActivityEntry,
  type ProjectRecentActivityInput,
} from './project-recent-activity'
import { withRedactedRecentActivityActor } from '../../domain/constructors'

const replayFactToActivityInput = (
  fact: ProjectableRecentActivityReplayFact,
): ProjectRecentActivityInput => ({
  action: fact.action,
  resourceType: fact.resourceType,
  resourceId: fact.resourceId,
  propertyId: fact.propertyId,
  organizationId: fact.organizationId,
  userId: fact.actorSubjectId,
  source: fact.source,
  eventId: fact.sourceEventId ?? `legacy-replay:${fact.projectionId as string}`,
  occurredAt: fact.sourceOccurredAt,
  payload: fact.payload,
})

type RecoverRecentActivityDeps = Readonly<{
  store: ActivityRecoveryStore
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export type RecoverRecentActivityResult = Readonly<{
  observedAt: Date
  processed: number
  applied: number
  duplicate: number
  failed: number
  complete: boolean
  nextCursor?: RecentActivityRecoveryCursor
}>

const assertObservationTime = (observedAt: Date): void => {
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error('Recent Activity recovery observation time is invalid')
  }
}

export const recoverRecentActivity =
  (deps: RecoverRecentActivityDeps) =>
  async (
    input: Readonly<{
      observedAt: Date
      after?: RecentActivityRecoveryCursor
      limit?: number
    }>,
  ): Promise<RecoverRecentActivityResult> => {
    assertObservationTime(input.observedAt)
    const limit = Math.min(
      RECENT_ACTIVITY_REBUILD_BATCH_MAX,
      Math.max(1, Math.trunc(input.limit ?? RECENT_ACTIVITY_REBUILD_BATCH_MAX)),
    )
    const facts = await deps.store.listMissing({
      observedAt: input.observedAt,
      after: input.after,
      limit,
    })
    let applied = 0
    let duplicate = 0
    let failed = 0
    let nextCursor = input.after

    for (const fact of facts) {
      try {
        const prepared = await prepareRecentActivityEntry(
          {
            userLookup: deps.userLookup,
            logger: deps.logger,
            clock: () => input.observedAt,
            idGen: () => fact.projectionId,
          },
          replayFactToActivityInput(fact),
        )
        if (prepared.isErr()) throw prepared.error
        const entry = fact.actorLabelRedactedAt
          ? withRedactedRecentActivityActor(prepared.value)
          : prepared.value
        const outcome = await deps.store.restoreProjection({
          fact,
          entry,
        })
        if (outcome === 'applied') applied += 1
        else duplicate += 1
        nextCursor = {
          sourceOccurredAt: fact.sourceOccurredAt,
          replayKey: fact.replayKey,
        }
      } catch {
        // Stop on the first failed fact and do not advance beyond it. The next
        // bounded invocation therefore retries the same authority record.
        failed = 1
        break
      }
    }

    return {
      observedAt: input.observedAt,
      processed: applied + duplicate,
      applied,
      duplicate,
      failed,
      complete: failed === 0 && facts.length < limit,
      ...(nextCursor ? { nextCursor } : {}),
    }
  }

export type RecentActivityReadiness = Readonly<{
  state: 'ready' | 'updating' | 'unavailable'
  reason:
    | 'projection_current'
    | 'within_visibility_target'
    | 'visibility_target_exceeded'
    | 'authority_store_unavailable'
  observedAt: Date
  missingCount: number | null
  oldestMissingAt: Date | null
  newestSourceAt: Date | null
  replayFactCount: number | null
  legacySnapshotCount: number | null
}>

export const getRecentActivityReadiness =
  (deps: Readonly<{ store: ActivityRecoveryStore }>) =>
  async (input: Readonly<{ observedAt: Date }>): Promise<RecentActivityReadiness> => {
    assertObservationTime(input.observedAt)
    try {
      const gap = await deps.store.readGap(input)
      if (gap.missingCount === 0) {
        return {
          state: 'ready',
          reason: 'projection_current',
          observedAt: input.observedAt,
          ...gap,
        }
      }
      const lagMs = gap.oldestMissingAt
        ? input.observedAt.getTime() - gap.oldestMissingAt.getTime()
        : Number.POSITIVE_INFINITY
      return {
        state: lagMs <= RECENT_ACTIVITY_VISIBILITY_TARGET_MS ? 'updating' : 'unavailable',
        reason:
          lagMs <= RECENT_ACTIVITY_VISIBILITY_TARGET_MS
            ? 'within_visibility_target'
            : 'visibility_target_exceeded',
        observedAt: input.observedAt,
        ...gap,
      }
    } catch {
      return {
        state: 'unavailable',
        reason: 'authority_store_unavailable',
        observedAt: input.observedAt,
        missingCount: null,
        oldestMissingAt: null,
        newestSourceAt: null,
        replayFactCount: null,
        legacySnapshotCount: null,
      }
    }
  }
