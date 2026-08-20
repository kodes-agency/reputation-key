import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_OAUTH_V1_STATE_DRAIN_MS,
  createGoogleImportCompatibilityLifecycle,
  type GoogleImportCompatibilityControl,
  type GoogleImportCompatibilityInspection,
  type GoogleImportCompatibilityPort,
} from './google-import-compatibility-lifecycle'

const NOW = new Date('2026-08-12T12:00:00.000Z')
const OPERATOR = {
  operatorId: 'release@example.com',
  reason: 'GOOGLE-42 contract cutover',
  now: NOW,
} as const

function openControl(): GoogleImportCompatibilityControl {
  return {
    state: 'open',
    generation: 1,
    connectedEventIssuance: 'v1',
    oauthStateIssuance: 'signed-v1',
    connectedEventConvergedAt: null,
    oauthStateConvergedAt: null,
    v1StateDrainNotBefore: null,
    v1EventsDrainedAt: null,
    quiescingAt: null,
    closedAt: null,
    operatorId: null,
    reason: null,
    updatedAt: new Date('2026-08-12T11:00:00.000Z'),
  }
}

function emptyInspection(
  control: GoogleImportCompatibilityControl,
): GoogleImportCompatibilityInspection {
  return {
    control,
    legacyRows: {
      total: 0,
      nonterminal: 0,
      statuses: {},
    },
    outbox: {
      pendingConnectedV1: 0,
    },
    leases: {
      active: 0,
    },
    queues: {
      legacyJobs: {
        waiting: 0,
        active: 0,
        delayed: 0,
        prioritized: 0,
        waitingChildren: 0,
        paused: 0,
        completed: 0,
        failed: 0,
      },
      legacySchedulers: 0,
      legacyRepeatables: 0,
      pendingConnectedV1: 0,
    },
  }
}

function harness(initial = openControl()) {
  let control = initial
  let inspection = emptyInspection(control)
  const port: GoogleImportCompatibilityPort = {
    inspect: vi.fn(async () => inspection),
    advanceConnectedEventIssuance: vi.fn(async (input) => {
      control = {
        ...control,
        generation: control.generation + 1,
        connectedEventIssuance: 'v2',
        connectedEventConvergedAt: input.now,
        operatorId: input.operatorId,
        reason: input.reason,
        updatedAt: input.now,
      }
      inspection = { ...inspection, control }
      return control
    }),
    advanceOauthStateIssuance: vi.fn(async (input) => {
      control = {
        ...control,
        generation: control.generation + 1,
        oauthStateIssuance: 'opaque-v2',
        oauthStateConvergedAt: input.now,
        v1StateDrainNotBefore: input.drainNotBefore,
        operatorId: input.operatorId,
        reason: input.reason,
        updatedAt: input.now,
      }
      inspection = { ...inspection, control }
      return control
    }),
    markV1EventsDrained: vi.fn(async (input) => {
      control = {
        ...control,
        generation: control.generation + 1,
        v1EventsDrainedAt: input.now,
        operatorId: input.operatorId,
        reason: input.reason,
        updatedAt: input.now,
      }
      inspection = { ...inspection, control }
      return control
    }),
    beginQuiescing: vi.fn(async (input) => {
      control = {
        ...control,
        state: 'quiescing',
        generation: control.generation + 1,
        quiescingAt: input.now,
        operatorId: input.operatorId,
        reason: input.reason,
        updatedAt: input.now,
      }
      inspection = { ...inspection, control }
      return control
    }),
    removeDormantLegacyQueueEntries: vi.fn(async () => {
      inspection = {
        ...inspection,
        queues: emptyInspection(control).queues,
      }
    }),
    close: vi.fn(async (input) => {
      control = {
        ...control,
        state: 'closed',
        generation: control.generation + 1,
        closedAt: input.now,
        operatorId: input.operatorId,
        reason: input.reason,
        updatedAt: input.now,
      }
      inspection = { ...inspection, control }
      return control
    }),
    archiveTerminalRows: vi.fn(async () => ({
      sourceCount: 3,
      archivedCount: 3,
      deletedCount: 3,
      sourceDigest: 'a'.repeat(64),
      archivedDigest: 'a'.repeat(64),
    })),
  }
  const lifecycle = createGoogleImportCompatibilityLifecycle(port)
  return {
    lifecycle,
    port,
    getControl: () => control,
    setInspection: (patch: Partial<GoogleImportCompatibilityInspection>) => {
      inspection = { ...inspection, ...patch, control }
    },
  }
}

function convergedControl(
  overrides: Partial<GoogleImportCompatibilityControl> = {},
): GoogleImportCompatibilityControl {
  return {
    ...openControl(),
    connectedEventIssuance: 'v2',
    connectedEventConvergedAt: new Date('2026-08-12T10:00:00.000Z'),
    oauthStateIssuance: 'opaque-v2',
    oauthStateConvergedAt: new Date('2026-08-12T10:05:00.000Z'),
    v1StateDrainNotBefore: new Date('2026-08-12T10:16:00.000Z'),
    v1EventsDrainedAt: new Date('2026-08-12T10:20:00.000Z'),
    ...overrides,
  }
}

describe('Google import compatibility lifecycle', () => {
  it('reports the durable control row and every close blocker', async () => {
    const h = harness()
    h.setInspection({
      legacyRows: { total: 4, nonterminal: 1, statuses: { completed: 3, queued: 1 } },
      outbox: { pendingConnectedV1: 2 },
      leases: { active: 1 },
      queues: {
        legacyJobs: {
          waiting: 1,
          active: 1,
          delayed: 0,
          prioritized: 0,
          waitingChildren: 0,
          paused: 0,
          completed: 2,
          failed: 0,
        },
        legacySchedulers: 1,
        legacyRepeatables: 1,
        pendingConnectedV1: 1,
      },
    })

    const result = await h.lifecycle.inspect()

    expect(result.blockers).toEqual([
      'connected_event_v1_issuance',
      'oauth_state_v1_issuance',
      'v1_events_not_drained',
      'legacy_rows_nonterminal',
      'legacy_queue_not_empty',
      'legacy_scheduler_not_empty',
      'legacy_repeatable_not_empty',
      'v1_event_queue_not_drained',
      'legacy_effect_lease_active',
      'v1_outbox_not_drained',
    ])
  })

  it('switches connected-event issuance once and replays idempotently', async () => {
    const h = harness()

    await expect(h.lifecycle.switchConnectedEvents(OPERATOR)).resolves.toMatchObject({
      connectedEventIssuance: 'v2',
    })
    await expect(h.lifecycle.switchConnectedEvents(OPERATOR)).resolves.toMatchObject({
      connectedEventIssuance: 'v2',
    })
    expect(h.port.advanceConnectedEventIssuance).toHaveBeenCalledTimes(1)
  })

  it('requires connected-event convergence before opaque OAuth issuance', async () => {
    const h = harness()
    await expect(h.lifecycle.switchOauthState(OPERATOR)).rejects.toThrow(
      'connected-event issuance is not v2',
    )

    await h.lifecycle.switchConnectedEvents(OPERATOR)
    await h.lifecycle.switchOauthState(OPERATOR)

    expect(h.port.advanceOauthStateIssuance).toHaveBeenCalledWith({
      ...OPERATOR,
      expectedGeneration: 2,
      drainNotBefore: new Date(NOW.getTime() + GOOGLE_OAUTH_V1_STATE_DRAIN_MS),
    })
  })

  it('will not mark v1 events drained while outbox or Bull delivery remains', async () => {
    const h = harness(convergedControl({ v1EventsDrainedAt: null }))
    h.setInspection({
      outbox: { pendingConnectedV1: 1 },
      queues: {
        ...emptyInspection(h.getControl()).queues,
        pendingConnectedV1: 1,
      },
    })

    await expect(h.lifecycle.markV1EventsDrained(OPERATOR)).rejects.toThrow(
      'v1 connected events remain',
    )
    expect(h.port.markV1EventsDrained).not.toHaveBeenCalled()
  })

  it('waits the full v1 state lifetime before quiescing', async () => {
    const control = convergedControl({
      v1StateDrainNotBefore: new Date('2026-08-12T12:00:00.001Z'),
    })
    const h = harness(control)

    await expect(h.lifecycle.quiesce(OPERATOR)).rejects.toThrow('v1 OAuth state drain')
    expect(h.port.beginQuiescing).not.toHaveBeenCalled()
  })

  it('removes dormant Bull entries only after quiescing and terminal convergence', async () => {
    const h = harness(
      convergedControl({
        state: 'quiescing',
        quiescingAt: new Date('2026-08-12T11:00:00.000Z'),
      }),
    )
    h.setInspection({
      legacyRows: { total: 2, nonterminal: 1, statuses: { queued: 1, completed: 1 } },
    })
    await expect(h.lifecycle.drainLegacyQueues(OPERATOR)).rejects.toThrow(
      'legacy rows are not terminal',
    )

    h.setInspection({
      legacyRows: { total: 2, nonterminal: 0, statuses: { completed: 2 } },
    })
    await expect(h.lifecycle.drainLegacyQueues(OPERATOR)).resolves.toBeUndefined()
    expect(h.port.removeDormantLegacyQueueEntries).toHaveBeenCalledWith({
      ...OPERATOR,
      expectedGeneration: 1,
    })
  })

  it('closes only after queues, outbox, leases, and rows are converged', async () => {
    const h = harness(
      convergedControl({
        state: 'quiescing',
        quiescingAt: new Date('2026-08-12T11:00:00.000Z'),
      }),
    )
    h.setInspection({ leases: { active: 1 } })

    await expect(h.lifecycle.close(OPERATOR)).rejects.toThrow(
      'compatibility close blocked: legacy_effect_lease_active',
    )

    h.setInspection({ leases: { active: 0 } })
    await expect(h.lifecycle.close(OPERATOR)).resolves.toMatchObject({ state: 'closed' })
    expect(h.port.close).toHaveBeenCalledWith({
      ...OPERATOR,
      expectedGeneration: 1,
    })
  })

  it('archives terminal rows only after close and requires count/digest parity', async () => {
    const h = harness(
      convergedControl({
        state: 'closed',
        quiescingAt: new Date('2026-08-12T11:00:00.000Z'),
        closedAt: new Date('2026-08-12T11:30:00.000Z'),
      }),
    )

    await expect(h.lifecycle.archive(OPERATOR)).resolves.toMatchObject({
      sourceCount: 3,
      archivedCount: 3,
      deletedCount: 3,
    })

    vi.mocked(h.port.archiveTerminalRows).mockResolvedValueOnce({
      sourceCount: 3,
      archivedCount: 2,
      deletedCount: 3,
      sourceDigest: 'a'.repeat(64),
      archivedDigest: 'b'.repeat(64),
    })
    await expect(h.lifecycle.archive(OPERATOR)).rejects.toThrow('archive parity failed')
  })
})
