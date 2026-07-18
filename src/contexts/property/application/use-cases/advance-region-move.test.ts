// BQC-4.5 — advance region move stepper (unit, in-memory ports + fake queues).
//
// Proves the operator-driven stepper semantics: per-step effects (real queue
// pause/resume via the BQC-0.4 primitive, real depth verification via the
// BQC-3.7 reader, policy gates, the guarded authority swap), idempotent
// retry per step, the not-drained stay, rollback effects, and the machine
// guards (no illegal jumps, no failed after erasure).

import { describe, it, expect } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { QuarantineQueuePort } from '#/shared/jobs/queue-quarantine'
import { isPropertyError } from '../../domain/errors'
import {
  authoritativeCellFor,
  type RegionMoveRecord,
  type RegionMoveState,
} from '../../domain/region-move-workflow'
import type {
  RegionMoveStateUpdate,
  RegionMoveStore,
} from '../ports/region-move-store.port'
import { advanceRegionMove } from './advance-region-move'

const T0 = new Date('2026-07-18T12:00:00.000Z')
const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

function makeMove(state: RegionMoveState = 'requested'): RegionMoveRecord {
  return {
    id: 'b0000000-0000-4000-8000-000000000001',
    propertyId: 'a0000000-0000-0000-0000-0000000000aa',
    organizationId: ctx.organizationId,
    fromRegion: 'us',
    toRegion: 'europe',
    state,
    denialReason: null,
    requestedBy: ctx.userId,
    requestedAt: T0,
    stateChangedAt: T0,
    completedAt: null,
    error: null,
  }
}

function createFakeQueue(counts: Record<string, number> = {}) {
  const state = { paused: false, pauseCalls: 0, resumeCalls: 0 }
  const port: QuarantineQueuePort = {
    pause: async () => {
      state.pauseCalls += 1
      state.paused = true
    },
    resume: async () => {
      state.resumeCalls += 1
      state.paused = false
    },
    isPaused: async () => state.paused,
    getJobCounts: async () => ({ ...counts }),
    close: async () => {},
  }
  return { port, state }
}

function setup(move: RegionMoveRecord, queueCounts: Record<string, number> = {}) {
  const rows: RegionMoveRecord[] = [move]
  const queue = createFakeQueue(queueCounts)
  const calls = { activate: 0, restore: 0 }
  let now = T0
  const store: RegionMoveStore = {
    insertMove: async (m) => {
      rows.push(m)
    },
    findMoveById: async (_orgId, moveId) => rows.find((r) => r.id === moveId) ?? null,
    findActiveMoveForProperty: async () => null,
    updateMoveState: async (_orgId, moveId, update: RegionMoveStateUpdate) => {
      const i = rows.findIndex((r) => r.id === moveId)
      if (i >= 0) rows[i] = { ...rows[i], ...update }
    },
    activateTargetRegion: async () => {
      calls.activate += 1
      return 'swapped'
    },
    restoreSourceRegion: async () => {
      calls.restore += 1
      return 'already_active'
    },
  }
  const useCase = advanceRegionMove({
    moveStore: store,
    queues: [{ name: 'default', queue: queue.port }],
    clock: () => now,
  })
  return {
    useCase,
    rows,
    queue,
    calls,
    advanceTime: (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
    getNow: () => now,
  }
}

const advance = (
  useCase: ReturnType<typeof advanceRegionMove>,
  toState: RegionMoveState,
  extra: { error?: string; confirmedBy?: string } = {},
) =>
  useCase(
    {
      moveId: 'b0000000-0000-4000-8000-000000000001',
      toState,
      confirmedBy: extra.confirmedBy ?? ctx.userId,
      error: extra.error,
    },
    ctx,
  )

describe('advanceRegionMove (BQC-4.5 stepper)', () => {
  it('drives the full happy path requested → … → completed', async () => {
    const { useCase, rows, calls, advanceTime, getNow } = setup(makeMove())
    const path: ReadonlyArray<RegionMoveState> = [
      'writes_paused',
      'queues_drained',
      'data_copied',
      'verified',
      'target_activated',
      'source_erased',
      'completed',
    ]
    for (const toState of path) {
      advanceTime(60_000)
      const result = await advance(useCase, toState)
      expect(result.advanced).toBe(true)
      expect(result.note).toBeNull()
      expect(result.move.state).toBe(toState)
      expect(result.move.stateChangedAt).toEqual(getNow())
    }
    const final = rows[0]
    expect(final.state).toBe('completed')
    expect(final.completedAt).toEqual(getNow())
    // The authority swap executed exactly once, from us to europe.
    expect(calls.activate).toBe(1)
    expect(calls.restore).toBe(0)
  })

  it('requested → writes_paused pauses the property-scoped queues (jobs preserved)', async () => {
    const { useCase, queue } = setup(makeMove())

    const result = await advance(useCase, 'writes_paused')

    expect(result.advanced).toBe(true)
    expect(queue.state.paused).toBe(true)
    expect(queue.state.pauseCalls).toBe(1)
  })

  it('queues_drained stays + reports when a queue still holds work', async () => {
    const { useCase, rows } = setup(makeMove('writes_paused'), { waiting: 2 })

    const result = await advance(useCase, 'queues_drained')

    expect(result.advanced).toBe(false)
    expect(result.note).toBe('queues_not_drained')
    expect(result.move.state).toBe('writes_paused')
    expect(rows[0].state).toBe('writes_paused')
  })

  it('queues_drained advances once depths read zero', async () => {
    const { useCase } = setup(makeMove('writes_paused'), {
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 3, // failed jobs are preserved evidence, not pending work
      paused: 0,
    })

    const result = await advance(useCase, 'queues_drained')

    expect(result.advanced).toBe(true)
    expect(result.move.state).toBe('queues_drained')
  })

  it('is idempotent per step: retrying a reached state is a no-op (crash/retry)', async () => {
    const { useCase, queue, calls } = setup(makeMove())

    await advance(useCase, 'writes_paused')
    const retry = await advance(useCase, 'writes_paused')

    expect(retry.advanced).toBe(false)
    expect(retry.note).toBe('already_in_state')
    expect(queue.state.pauseCalls).toBe(1) // pause effect not duplicated
    await advance(useCase, 'queues_drained')
    await advance(useCase, 'data_copied')
    await advance(useCase, 'verified')
    await advance(useCase, 'target_activated')
    const retryActivation = await advance(useCase, 'target_activated')
    expect(retryActivation.advanced).toBe(false)
    expect(calls.activate).toBe(1) // authority swap not duplicated
  })

  it('records the confirming operator on every step (policy gate evidence)', async () => {
    const { useCase, rows, advanceTime } = setup(makeMove('queues_drained'))

    advanceTime(1_000)
    await advance(useCase, 'data_copied', { confirmedBy: 'operator-2' })

    expect(rows[0].requestedBy).toBe('operator-2')
  })

  it('throws invalid_transition on a skipped step', async () => {
    const { useCase } = setup(makeMove())

    await expect(advance(useCase, 'completed')).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && e.code === 'invalid_transition',
    )
  })

  it('throws property_not_found for an unknown move', async () => {
    const { useCase } = setup(makeMove())

    await expect(
      useCase(
        {
          moveId: 'b0000000-0000-4000-8000-00000000dead',
          toState: 'failed',
          confirmedBy: ctx.userId,
          error: 'x',
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && e.code === 'property_not_found',
    )
  })

  it('failed requires an error and records only the content-free first line', async () => {
    const { useCase, rows } = setup(makeMove('queues_drained'))

    await expect(advance(useCase, 'failed')).rejects.toThrow(/error/i)

    const result = await advance(useCase, 'failed', {
      error: 'drain stalled after 30m\nwaiting=2 active=1',
    })

    expect(result.advanced).toBe(true)
    expect(rows[0].state).toBe('failed')
    expect(rows[0].error).toBe('drain stalled after 30m')
  })

  it('source_erased is the point of no return — failed after it throws', async () => {
    const { useCase } = setup(makeMove('source_erased'))

    await expect(advance(useCase, 'failed', { error: 'late failure' })).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && e.code === 'invalid_transition',
    )
  })

  it('rolls back: failed → rolling_back resumes queues + restores source, rolled_back is terminal', async () => {
    const { useCase, queue, calls, rows } = setup(makeMove('writes_paused'))
    await queue.port.pause()
    const authorities: string[] = []

    await advance(useCase, 'failed', { error: 'drain stalled' })
    authorities.push(authoritativeCellFor(rows[0].state, 'us', 'europe'))
    const rolling = await advance(useCase, 'rolling_back')
    authorities.push(authoritativeCellFor(rolling.move.state, 'us', 'europe'))

    expect(rolling.advanced).toBe(true)
    expect(queue.state.resumeCalls).toBe(1)
    expect(queue.state.paused).toBe(false)
    expect(calls.restore).toBe(1)

    const done = await advance(useCase, 'rolled_back')
    authorities.push(authoritativeCellFor(done.move.state, 'us', 'europe'))
    expect(done.move.state).toBe('rolled_back')
    // The source stayed the single authority throughout the rollback.
    expect(authorities).toEqual(['us', 'us', 'us'])

    await expect(advance(useCase, 'requested')).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && e.code === 'invalid_transition',
    )
  })
})
