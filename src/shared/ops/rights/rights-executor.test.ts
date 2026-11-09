import { describe, expect, it, vi } from 'vitest'
import {
  runRightsExecutors,
  type RightsApplyOutcome,
  type RightsExecutor,
} from './rights-executor'
import { createRightsJournal, type RightsJournalStore } from './rights-journal'
import type { RightsRequestPlan } from './rights-request-command'

function planOf(overrides: Partial<RightsRequestPlan>): RightsRequestPlan {
  return {
    scope: 'organization',
    mode: 'report',
    organizationId: 'org-1',
    batchSize: 50,
    ...overrides,
  }
}

function executor(
  name: string,
  overrides: Partial<RightsExecutor> & { outcome?: RightsApplyOutcome } = {},
): RightsExecutor {
  const { outcome, ...rest } = overrides
  return {
    name,
    scopes: ['access', 'organization'],
    journalContexts: ['review'],
    tables: { organization: [], property: [] },
    report: vi.fn(async () => [`${name} report`]),
    exportFiles: vi.fn(async () => [
      { path: `${name}/data.json`, bytes: Buffer.from('{}') },
    ]),
    apply: vi.fn(async () => outcome ?? { ok: true as const, lines: ['done'] }),
    ...rest,
  }
}

function applyPlan(overrides: Partial<RightsRequestPlan> = {}): RightsRequestPlan {
  return planOf({
    mode: 'apply',
    receivedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  })
}

function storeOf(overrides: Partial<RightsJournalStore> = {}) {
  const puts: Array<{ key: string; bytes: string }> = []
  const alert = vi.fn()
  const store: RightsJournalStore = {
    put: async (key, bytes) => {
      puts.push({ key, bytes })
    },
    alert,
    ...overrides,
  }
  return { store, puts, alert }
}

function harness() {
  const out: string[] = []
  const err: string[] = []
  const written: string[] = []
  return {
    out,
    err,
    written,
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    writeExportFile: async (path: string) => {
      written.push(path)
    },
  }
}

describe('runRightsExecutors', () => {
  it('prints each report and writes export files only when out= is given', async () => {
    const h = harness()
    const covering = executor('a')

    const withoutDir = await runRightsExecutors({
      plan: planOf({}),
      executors: [covering],
      io: h.io,
      journal: createRightsJournal(storeOf().store),
      writeExportFile: h.writeExportFile,
    })
    expect(withoutDir).toBe(0)
    expect(h.out).toContain('a: a report')
    expect(h.written).toEqual([])

    await runRightsExecutors({
      plan: planOf({ exportDir: '/tmp/export' }),
      executors: [covering],
      io: h.io,
      journal: createRightsJournal(storeOf().store),
      writeExportFile: h.writeExportFile,
    })
    expect(h.written).toEqual(['/tmp/export/a/data.json'])
  })

  it('does not export for a scope that has no export', async () => {
    const h = harness()
    const covering = executor('a', { scopes: ['property'] })

    await runRightsExecutors({
      plan: planOf({ scope: 'property', exportDir: '/tmp/export' }),
      executors: [covering],
      io: h.io,
      journal: createRightsJournal(storeOf().store),
      writeExportFile: h.writeExportFile,
    })

    expect(covering.exportFiles).not.toHaveBeenCalled()
    expect(h.written).toEqual([])
  })

  it('reports an uncovered scope without failing, and refuses to apply it', async () => {
    const h = harness()
    const uncovered = executor('a', { scopes: ['organization'] })

    expect(
      await runRightsExecutors({
        plan: planOf({ scope: 'participant' }),
        executors: [uncovered],
        io: h.io,
        journal: createRightsJournal(storeOf().store),
        writeExportFile: h.writeExportFile,
      }),
    ).toBe(0)
    expect(
      await runRightsExecutors({
        plan: applyPlan({ scope: 'participant' }),
        executors: [uncovered],
        io: h.io,
        journal: createRightsJournal(storeOf().store),
        writeExportFile: h.writeExportFile,
      }),
    ).toBe(1)
    expect(h.err[0]).toContain('no executor is composed for participant')
    expect(uncovered.apply).not.toHaveBeenCalled()
  })

  it('stops at the first refusal so later executors never run', async () => {
    const h = harness()
    const refusing = executor('first', {
      outcome: { ok: false, error: 'not ready (live_connections=1)' },
    })
    const later = executor('second')

    const exit = await runRightsExecutors({
      plan: applyPlan(),
      executors: [refusing, later],
      io: h.io,
      journal: createRightsJournal(storeOf().store),
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(1)
    expect(h.err[0]).toContain('first: not ready (live_connections=1)')
    expect(h.err[0]).toContain('executors applied before it: none')
    expect(later.apply).not.toHaveBeenCalled()
  })

  it('names the executors that already applied when a later one refuses', async () => {
    const h = harness()
    const first = executor('first')
    const refusing = executor('second', { outcome: { ok: false, error: 'not ready' } })

    await runRightsExecutors({
      plan: applyPlan(),
      executors: [first, refusing],
      io: h.io,
      journal: createRightsJournal(storeOf().store),
      writeExportFile: h.writeExportFile,
    })

    expect(h.err[0]).toBe(
      'rights-request: second: not ready; executors applied before it: first',
    )
  })

  it('refuses every apply when any executor refuses in preflight', async () => {
    const h = harness()
    const first = executor('first')
    const refusing = executor('second', {
      preflight: async () => ({ ok: false, error: 'not ready (live_connections=1)' }),
    })
    const { store, puts } = storeOf()

    const exit = await runRightsExecutors({
      plan: applyPlan(),
      executors: [first, refusing],
      io: h.io,
      journal: createRightsJournal(store),
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(1)
    expect(h.err).toEqual([
      'rights-request: second: not ready (live_connections=1); nothing was changed',
    ])
    expect(first.apply).not.toHaveBeenCalled()
    expect(refusing.apply).not.toHaveBeenCalled()
    expect(puts).toEqual([])
  })

  it('refuses every apply when the plan cannot be journaled', async () => {
    const h = harness()
    const covering = executor('a')
    const { store, puts } = storeOf()

    const exit = await runRightsExecutors({
      plan: applyPlan({ receivedAt: undefined }),
      executors: [covering],
      io: h.io,
      journal: createRightsJournal(store),
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(1)
    expect(h.err).toEqual([
      'rights-request: a: received=<iso> is required to journal an apply; nothing was changed',
    ])
    expect(covering.apply).not.toHaveBeenCalled()
    expect(puts).toEqual([])
  })

  it('reports a thrown preflight as a refusal and applies nothing', async () => {
    const h = harness()
    const first = executor('first')
    const throwing = executor('second', {
      preflight: async () => {
        throw new Error('database unavailable')
      },
    })

    const exit = await runRightsExecutors({
      plan: applyPlan(),
      executors: [first, throwing],
      io: h.io,
      journal: createRightsJournal(storeOf().store),
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(1)
    expect(h.err).toEqual([
      'rights-request: second: database unavailable; nothing was changed',
    ])
    expect(first.apply).not.toHaveBeenCalled()
  })

  it('refuses to apply without a journal store and changes nothing', async () => {
    const h = harness()
    const covering = executor('a')

    const exit = await runRightsExecutors({
      plan: applyPlan(),
      executors: [covering],
      io: h.io,
      journal: createRightsJournal(undefined),
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(1)
    expect(h.err[0]).toContain('no erasure journal store is configured')
    expect(h.err[0]).toContain('nothing was changed')
    expect(covering.apply).not.toHaveBeenCalled()
  })

  it('journals before it applies and prints one audit line per apply', async () => {
    const h = harness()
    const order: string[] = []
    const covering = executor('a', {
      apply: vi.fn(async () => {
        order.push('apply')
        return { ok: true as const, lines: ['done'] }
      }),
    })
    const { store, puts } = storeOf({
      put: async () => {
        order.push('put')
      },
    })

    await runRightsExecutors({
      plan: applyPlan(),
      executors: [covering],
      io: h.io,
      journal: createRightsJournal(store),
      writeExportFile: h.writeExportFile,
    })

    expect(order).toEqual(['put', 'apply'])
    expect(puts).toEqual([])
    expect(h.out.filter((line) => line.startsWith('audit: '))).toHaveLength(1)
    expect(h.out[1]).toMatch(/^audit: a applied scope=organization org=org-1 journal=/u)
  })

  it('does not call apply, and alerts, when the journal write is rejected', async () => {
    const h = harness()
    const covering = executor('a')
    const { store, alert } = storeOf({
      put: async () => {
        throw new Error('bucket down')
      },
    })

    const exit = await runRightsExecutors({
      plan: applyPlan(),
      executors: [covering],
      io: h.io,
      journal: createRightsJournal(store),
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(1)
    expect(covering.apply).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledTimes(1)
    expect(h.err[0]).toContain('erasure was blocked')
  })

  it('applies every covering executor in order', async () => {
    const h = harness()
    const first = executor('first')
    const second = executor('second')

    const exit = await runRightsExecutors({
      plan: applyPlan(),
      executors: [first, second],
      io: h.io,
      journal: createRightsJournal(storeOf().store),
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(0)
    expect(h.out.filter((line) => !line.startsWith('audit: '))).toEqual([
      'first: done',
      'second: done',
    ])
    expect(h.out.filter((line) => line.startsWith('audit: '))).toHaveLength(2)
  })
})
