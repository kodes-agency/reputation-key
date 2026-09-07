import { describe, expect, it, vi } from 'vitest'
import {
  recentActivityEntryId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { ProjectableRecentActivityReplayFact } from '../../domain/recent-activity-replay-fact'
import type { ActivityRecoveryStore } from '../../ports/activity-recovery-store.port'
import {
  getRecentActivityReadiness,
  recoverRecentActivity,
} from './recover-recent-activity'

const OBSERVED_AT = new Date('2026-08-28T12:00:00.000Z')

const fact = (suffix: string, occurredAt: Date): ProjectableRecentActivityReplayFact => ({
  replayKey: `event:org-recovery:event-${suffix}`,
  sourceKind: 'durable_fact',
  sourceEventId: `event-${suffix}`,
  sourceEventType: 'property.updated',
  sourceEventVersion: 1,
  sourceContext: 'property',
  sourceAggregateId: `property-${suffix}`,
  organizationId: organizationId('org-recovery'),
  propertyId: propertyId(`property-${suffix}`),
  sourceOccurredAt: occurredAt,
  disposition: 'projectable',
  projectionId: recentActivityEntryId(`00000000-0000-4000-8000-0000000008${suffix}`),
  actorSubjectId: userId('user-recovery'),
  actorLabelRedactedAt: null,
  action: 'changed',
  resourceType: 'property',
  resourceId: `property-${suffix}`,
  payload: { subject: 'property', from: null, to: null, detail: null },
  source: 'web',
})

const deps = (facts: readonly ProjectableRecentActivityReplayFact[]) => {
  const restoreProjection = vi.fn(async () => 'applied' as const)
  const store: ActivityRecoveryStore = {
    listMissing: vi.fn(async () => facts),
    restoreProjection,
    readGap: vi.fn(async () => ({
      missingCount: 0,
      oldestMissingAt: null,
      newestSourceAt: null,
      replayFactCount: 0,
      legacySnapshotCount: 0,
    })),
  }
  return {
    store,
    restoreProjection,
    userLookup: {
      lookup: vi.fn(async () => ({
        name: 'Current actor label',
        avatarUrl: null,
        role: 'PropertyManager' as const,
        rawRole: 'PropertyManager',
      })),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
  }
}

describe('Recent Activity recovery', () => {
  it('rebuilds a bounded batch from canonical facts at source time', async () => {
    const source = fact('01', new Date('2026-08-28T11:58:00.000Z'))
    const dependencies = deps([source])

    const result = await recoverRecentActivity(dependencies)({
      observedAt: OBSERVED_AT,
      limit: 500,
    })

    expect(dependencies.store.listMissing).toHaveBeenCalledWith({
      observedAt: OBSERVED_AT,
      after: undefined,
      limit: 100,
    })
    expect(dependencies.restoreProjection).toHaveBeenCalledWith({
      fact: source,
      entry: expect.objectContaining({
        id: source.projectionId,
        eventId: source.sourceEventId,
        actorName: 'Current actor label',
        createdAt: source.sourceOccurredAt,
      }),
    })
    expect(result).toMatchObject({
      processed: 1,
      applied: 1,
      duplicate: 0,
      failed: 0,
      complete: true,
    })
  })

  it('stops at a failed fact without advancing the durable cursor past it', async () => {
    const first = fact('02', new Date('2026-08-28T11:57:00.000Z'))
    const failed = fact('03', new Date('2026-08-28T11:58:00.000Z'))
    const afterFailure = fact('04', new Date('2026-08-28T11:59:00.000Z'))
    const dependencies = deps([first, failed, afterFailure])
    dependencies.restoreProjection
      .mockResolvedValueOnce('applied')
      .mockRejectedValueOnce(new Error('database unavailable'))

    const result = await recoverRecentActivity(dependencies)({
      observedAt: OBSERVED_AT,
      limit: 3,
    })

    expect(dependencies.restoreProjection).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      observedAt: OBSERVED_AT,
      processed: 1,
      applied: 1,
      duplicate: 0,
      failed: 1,
      complete: false,
      nextCursor: {
        sourceOccurredAt: first.sourceOccurredAt,
        replayKey: first.replayKey,
      },
    })
  })

  it('never restores an actor label once the replay authority is redacted', async () => {
    const source = {
      ...fact('05', new Date('2026-08-28T11:59:00.000Z')),
      actorSubjectId: null,
      actorLabelRedactedAt: new Date('2026-08-28T11:59:30.000Z'),
    }
    const dependencies = deps([source])

    await recoverRecentActivity(dependencies)({ observedAt: OBSERVED_AT })

    expect(dependencies.userLookup.lookup).not.toHaveBeenCalled()
    expect(dependencies.restoreProjection).toHaveBeenCalledWith({
      fact: source,
      entry: expect.objectContaining({
        actorId: userId('system'),
        actorName: 'Former member',
        actorAvatarUrl: null,
      }),
    })
  })
})

describe('Recent Activity readiness', () => {
  it.each([
    [0, null, 'ready', 'projection_current'],
    [1, new Date('2026-08-28T11:58:00.000Z'), 'updating', 'within_visibility_target'],
    [
      1,
      new Date('2026-08-28T11:54:59.999Z'),
      'unavailable',
      'visibility_target_exceeded',
    ],
  ] as const)(
    'maps %s missing facts to %s',
    async (missingCount, oldestMissingAt, state, reason) => {
      const dependencies = deps([])
      vi.mocked(dependencies.store.readGap).mockResolvedValueOnce({
        missingCount,
        oldestMissingAt,
        newestSourceAt: new Date('2026-08-28T11:59:00.000Z'),
        replayFactCount: 2,
        legacySnapshotCount: 1,
      })

      await expect(
        getRecentActivityReadiness({ store: dependencies.store })({
          observedAt: OBSERVED_AT,
        }),
      ).resolves.toMatchObject({ state, reason, missingCount })
    },
  )

  it('fails visibly without claiming zero when the authority store is unavailable', async () => {
    const dependencies = deps([])
    vi.mocked(dependencies.store.readGap).mockRejectedValueOnce(
      new Error('database unavailable'),
    )

    await expect(
      getRecentActivityReadiness({ store: dependencies.store })({
        observedAt: OBSERVED_AT,
      }),
    ).resolves.toEqual({
      state: 'unavailable',
      reason: 'authority_store_unavailable',
      observedAt: OBSERVED_AT,
      missingCount: null,
      oldestMissingAt: null,
      newestSourceAt: null,
      replayFactCount: null,
      legacySnapshotCount: null,
    })
  })
})
