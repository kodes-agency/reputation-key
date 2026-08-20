import { describe, expect, it, vi } from 'vitest'
import {
  createAdmittedExecutionPermit,
  fenceElapsedStartDeadlinePermit,
  startExecutionPermit,
  type AdmitAuthorizationExecutionPermitInput,
  type AuthorizationExecutionPermit,
} from './authorization-execution-permit'
import {
  createExecutionPermitStartDeadlineSweeper,
  EXECUTION_PERMIT_START_DEADLINE_SWEEP_BATCH_SIZE,
  type ExecutionPermitStartDeadlineSweepStore,
} from './execution-permit-start-deadline-sweep'
import { GOOGLE_CONTENT_CAPABILITIES } from './google-content-contract'

const ADMITTED_AT = new Date('2026-08-10T10:00:00.000Z')
/** createAdmittedExecutionPermit sets startDeadlineAt = admittedAt + 10s. */
const DEADLINE_AT = new Date('2026-08-10T10:00:10.000Z')

const admissionInput = (id: string): AdmitAuthorizationExecutionPermitInput =>
  ({
    id,
    capability: 'property.read_gbp_performance',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    connectionId: 'conn-1',
    initiatorUserId: 'user-1',
    operationKey: 'performance-report',
    routeKey: 'performance.multi-daily-metrics',
    routeCatalogVersion: '2026-08-16',
    quotaPolicyId: 'google-performance-v1',
    policyVersion: 1,
    emergencyKillVersion: 1,
    approvalBindingId: 'approval-1',
    permitGeneration: 1,
    startVectorMode: 'full',
    commitVectorMode: 'full',
  }) satisfies AdmitAuthorizationExecutionPermitInput

function admitted(id: string): AuthorizationExecutionPermit {
  return createAdmittedExecutionPermit(admissionInput(id), ADMITTED_AT)
}

/**
 * In-memory store with the same contract as the Postgres repository: the
 * candidate scan is `state = 'admitted' AND start_deadline_at < before`, ordered
 * oldest deadline first and bounded by `limit`; `lockPermit` re-reads current
 * state so the sweeper's re-check is a real CAS.
 */
function createStore(rows: AuthorizationExecutionPermit[]) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const updates: AuthorizationExecutionPermit[] = []
  const store: ExecutionPermitStartDeadlineSweepStore<'tx'> = {
    transaction: (run) => run('tx'),
    listElapsedAdmittedPermitIds: async (_tx, input) =>
      [...byId.values()]
        .filter(
          (row) =>
            input.capabilities.includes(row.capability) &&
            row.state === 'admitted' &&
            row.startDeadlineAt.getTime() < input.before.getTime(),
        )
        .sort(
          (left, right) =>
            left.startDeadlineAt.getTime() - right.startDeadlineAt.getTime(),
        )
        .slice(0, input.limit)
        .map((row) => row.id),
    lockPermit: async (_tx, id) => {
      const row = byId.get(id)
      return row ? { permit: row } : null
    },
    updatePermit: async (_tx, permit) => {
      byId.set(permit.id, permit)
      updates.push(permit)
    },
  }
  return { store, byId, updates }
}

describe('execution-permit start-deadline sweep', () => {
  it('fences only admitted permits whose start deadline is already past', async () => {
    const past = admitted('past')
    const future = { ...admitted('future') }
    const rows = [
      past,
      // Deadline strictly after `now` — the scan must not select it.
      { ...future, startDeadlineAt: new Date('2026-08-10T10:05:00.000Z') },
    ]
    const { store, byId, updates } = createStore(rows)
    const now = new Date('2026-08-10T10:00:30.000Z')

    const outcome = await createExecutionPermitStartDeadlineSweeper({
      store,
      clock: () => now,
    })()

    expect(outcome).toEqual({
      scanned: 1,
      fenced: 1,
      retained: { state_not_admitted: 0, start_deadline_pending: 0 },
      vanished: 0,
      batchFull: false,
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 'past', state: 'fenced', fencedAt: now })
    expect(byId.get('future')).toMatchObject({ state: 'admitted', fencedAt: null })
  })

  it('leaves started, completed and already-fenced permits untouched', async () => {
    const started = startExecutionPermit(admitted('started'), {
      now: new Date('2026-08-10T10:00:05.000Z'),
      policyVersion: 1,
      emergencyKillVersion: 1,
      approvalBindingId: 'approval-1',
    })
    if (started.kind !== 'started') throw new Error('expected start')
    const { store, updates } = createStore([
      started.permit,
      { ...admitted('completed'), state: 'completed' },
      { ...admitted('fenced'), state: 'fenced', fencedAt: DEADLINE_AT },
    ])

    const outcome = await createExecutionPermitStartDeadlineSweeper({
      store,
      clock: () => new Date('2026-08-10T11:00:00.000Z'),
    })()

    expect(outcome.scanned).toBe(0)
    expect(outcome.fenced).toBe(0)
    expect(updates).toEqual([])
  })

  it('retains a candidate that was started between the scan and the row lock', async () => {
    const { store } = createStore([admitted('raced')])
    const now = new Date('2026-08-10T10:00:30.000Z')
    // The scan saw `admitted`; by the time the row lock is taken another
    // transaction has moved it on. The domain re-check must retain it rather
    // than force-fence, which is exactly the CAS guarantee.
    const raced: AuthorizationExecutionPermit = {
      ...admitted('raced'),
      state: 'started',
      startedAt: new Date('2026-08-10T10:00:05.000Z'),
      operationDeadlineAt: new Date('2026-08-10T10:00:35.000Z'),
    }
    const lockPermit = vi.fn(async () => ({ permit: raced }))

    const outcome = await createExecutionPermitStartDeadlineSweeper({
      store: { ...store, lockPermit },
      clock: () => now,
    })()

    expect(lockPermit).toHaveBeenCalledTimes(1)
    expect(outcome.scanned).toBe(1)
    expect(outcome.fenced).toBe(0)
    expect(outcome.retained.state_not_admitted).toBe(1)
  })

  it('counts a candidate row that disappeared before the lock', async () => {
    const { store } = createStore([admitted('gone')])

    const outcome = await createExecutionPermitStartDeadlineSweeper({
      store: { ...store, lockPermit: async () => null },
      clock: () => new Date('2026-08-10T10:00:30.000Z'),
    })()

    expect(outcome).toMatchObject({ scanned: 1, fenced: 0, vanished: 1 })
  })

  it('bounds each run and reports a full batch so the backlog drains across runs', async () => {
    const rows = Array.from({ length: 5 }, (_unused, index) => ({
      ...admitted(`permit-${index}`),
      startDeadlineAt: new Date(DEADLINE_AT.getTime() + index),
    }))
    const { store, byId } = createStore(rows)
    const sweep = createExecutionPermitStartDeadlineSweeper({
      store,
      clock: () => new Date('2026-08-10T10:00:30.000Z'),
      batchSize: 2,
    })

    const first = await sweep()
    expect(first).toMatchObject({ scanned: 2, fenced: 2, batchFull: true })
    // Oldest deadline first — deterministic drain order across runs.
    expect(byId.get('permit-0')!.state).toBe('fenced')
    expect(byId.get('permit-1')!.state).toBe('fenced')
    expect(byId.get('permit-2')!.state).toBe('admitted')

    expect(await sweep()).toMatchObject({ scanned: 2, fenced: 2, batchFull: true })
    expect(await sweep()).toMatchObject({ scanned: 1, fenced: 1, batchFull: false })
    expect(await sweep()).toMatchObject({ scanned: 0, fenced: 0, batchFull: false })
    expect([...byId.values()].every((row) => row.state === 'fenced')).toBe(true)
  })

  it('routes the fence through the domain helper rather than a store-local update', async () => {
    // The permit written back must be byte-identical to what the domain helper
    // produces for the same (permit, now) pair. A raw UPDATE that set only
    // `state`/`fenced_at` — or that used a different deadline comparison — would
    // diverge here.
    const permit = admitted('domain-routed')
    const now = new Date('2026-08-10T10:00:30.000Z')
    const { store, updates } = createStore([permit])

    await createExecutionPermitStartDeadlineSweeper({ store, clock: () => now })()

    const expected = fenceElapsedStartDeadlinePermit(permit, now)
    if (expected.kind !== 'fenced') throw new Error('expected fence')
    expect(expected.reason).toBe('start_deadline_elapsed')
    expect(updates[0]).toEqual(expected.permit)
  })

  it('scans every Google Content capability by default, at the published ceiling', async () => {
    const listElapsedAdmittedPermitIds = vi.fn(async () => [] as readonly string[])
    const { store } = createStore([])

    await createExecutionPermitStartDeadlineSweeper({
      store: { ...store, listElapsedAdmittedPermitIds },
      clock: () => new Date('2026-08-10T10:00:30.000Z'),
    })()

    expect(listElapsedAdmittedPermitIds).toHaveBeenCalledWith('tx', {
      capabilities: GOOGLE_CONTENT_CAPABILITIES,
      before: new Date('2026-08-10T10:00:30.000Z'),
      limit: EXECUTION_PERMIT_START_DEADLINE_SWEEP_BATCH_SIZE,
    })
  })

  it('never fences a permit outside the scanned capability scope', async () => {
    const { store, byId } = createStore([
      admitted('performance'),
      { ...admitted('import'), capability: 'property.import_gbp_v2' },
    ])

    const outcome = await createExecutionPermitStartDeadlineSweeper({
      store,
      clock: () => new Date('2026-08-10T10:00:30.000Z'),
      capabilities: ['property.read_gbp_performance'],
    })()

    expect(outcome).toMatchObject({ scanned: 1, fenced: 1 })
    expect(byId.get('performance')!.state).toBe('fenced')
    expect(byId.get('import')!.state).toBe('admitted')
  })
})

describe('fenceElapsedStartDeadlinePermit', () => {
  it('treats deadline equality as elapsed, exactly like startExecutionPermit', () => {
    const permit = admitted('equality')
    const started = startExecutionPermit(permit, {
      now: DEADLINE_AT,
      policyVersion: 1,
      emergencyKillVersion: 1,
      approvalBindingId: 'approval-1',
    })

    expect(started).toMatchObject({ kind: 'fenced', reason: 'start_deadline_elapsed' })
    expect(fenceElapsedStartDeadlinePermit(permit, DEADLINE_AT)).toMatchObject({
      kind: 'fenced',
      reason: 'start_deadline_elapsed',
    })
    expect(
      fenceElapsedStartDeadlinePermit(permit, new Date(DEADLINE_AT.getTime() - 1)),
    ).toEqual({ kind: 'retained', reason: 'start_deadline_pending' })
  })
})
