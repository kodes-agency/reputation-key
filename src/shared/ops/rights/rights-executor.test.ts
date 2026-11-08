import { describe, expect, it, vi } from 'vitest'
import {
  runRightsExecutors,
  type RightsApplyOutcome,
  type RightsExecutor,
} from './rights-executor'
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
    report: vi.fn(async () => [`${name} report`]),
    exportFiles: vi.fn(async () => [
      { path: `${name}/data.json`, bytes: Buffer.from('{}') },
    ]),
    apply: vi.fn(async () => outcome ?? { ok: true as const, lines: ['done'] }),
    ...rest,
  }
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
      writeExportFile: h.writeExportFile,
    })
    expect(withoutDir).toBe(0)
    expect(h.out).toContain('a: a report')
    expect(h.written).toEqual([])

    await runRightsExecutors({
      plan: planOf({ exportDir: '/tmp/export' }),
      executors: [covering],
      io: h.io,
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
        writeExportFile: h.writeExportFile,
      }),
    ).toBe(0)
    expect(
      await runRightsExecutors({
        plan: planOf({ scope: 'participant', mode: 'apply' }),
        executors: [uncovered],
        io: h.io,
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
      plan: planOf({ mode: 'apply' }),
      executors: [refusing, later],
      io: h.io,
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(1)
    expect(h.err[0]).toContain('first: not ready (live_connections=1)')
    expect(later.apply).not.toHaveBeenCalled()
  })

  it('applies every covering executor in order', async () => {
    const h = harness()
    const first = executor('first')
    const second = executor('second')

    const exit = await runRightsExecutors({
      plan: planOf({ mode: 'apply' }),
      executors: [first, second],
      io: h.io,
      writeExportFile: h.writeExportFile,
    })

    expect(exit).toBe(0)
    expect(h.out).toEqual(['first: done', 'second: done'])
  })
})
