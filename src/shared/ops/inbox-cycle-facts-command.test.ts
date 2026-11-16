import { describe, expect, it, vi } from 'vitest'
import type {
  CycleHeadFactsBatch,
  CycleHeadFactsParity,
  CycleHeadFactsStore,
} from './inbox-cycle-facts-command'
import {
  inboxCycleFactsCommandSpec,
  planInboxCycleFacts,
  runInboxCycleFactsBackfill,
} from './inbox-cycle-facts-command'
import { parseOperatorArgs } from './operator-command'

const argsOf = (...argv: string[]) => {
  const parsed = parseOperatorArgs(argv, inboxCycleFactsCommandSpec)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const PARITY_BEFORE: CycleHeadFactsParity = {
  items: 10,
  withHead: 9,
  factsDiffer: 9,
  statusDiffers: 0,
}
const PARITY_AFTER: CycleHeadFactsParity = { ...PARITY_BEFORE, factsDiffer: 0 }

function harness(parities: ReadonlyArray<CycleHeadFactsParity>) {
  const lines: string[] = []
  const errors: string[] = []
  let parityCall = 0
  const batches: ReadonlyArray<CycleHeadFactsBatch> = [
    { rows: 5, last: 'item-e' },
    { rows: 4, last: 'item-j' },
    { rows: 0, last: null },
  ]
  let batchCall = 0
  const backfill = vi.fn(async () => batches[Math.min(batchCall++, batches.length - 1)]!)
  const store: CycleHeadFactsStore = {
    parity: vi.fn(async () => parities[Math.min(parityCall++, parities.length - 1)]!),
    scan: vi.fn(async () => ({ rows: 0, last: null })),
    backfill,
  }
  return {
    lines,
    errors,
    store,
    backfill,
    io: {
      out: (line: string) => lines.push(line),
      err: (line: string) => errors.push(line),
    },
  }
}

const ctxOf = (
  overrides: Partial<Parameters<typeof runInboxCycleFactsBackfill>[0]['ctx']>,
) => ({
  dryRun: true,
  operatorId: 'op-1',
  correlationId: 'corr-1',
  reason: undefined,
  batchSize: undefined,
  ...overrides,
})

describe('planInboxCycleFacts', () => {
  it('accepts only the backfill action without arguments', () => {
    expect(planInboxCycleFacts(argsOf('backfill', '--operator', 'op-1'))).toEqual({
      ok: true,
    })
    expect(planInboxCycleFacts(argsOf('purge', '--operator', 'op-1'))).toMatchObject({
      ok: false,
    })
    expect(
      planInboxCycleFacts(argsOf('backfill', 'extra', '--operator', 'op-1')),
    ).toMatchObject({ ok: false })
  })
})

describe('runInboxCycleFactsBackfill', () => {
  it('reports the differing rows and writes nothing on a dry run', async () => {
    const { store, io, lines, backfill } = harness([PARITY_BEFORE])

    const code = await runInboxCycleFactsBackfill({ ctx: ctxOf({}), store, io })

    expect(code).toBe(0)
    expect(backfill).not.toHaveBeenCalled()
    expect(lines[0]).toContain('"outcome": "would_backfill"')
    expect(lines[0]).toContain('"factsDiffer": 9')
  })

  it('walks every batch on apply and reports the parity afterwards', async () => {
    const { store, io, lines, backfill } = harness([PARITY_AFTER])

    const code = await runInboxCycleFactsBackfill({
      ctx: ctxOf({ dryRun: false, reason: 'dual write', batchSize: 5 }),
      store,
      io,
    })

    expect(code).toBe(0)
    expect(backfill).toHaveBeenCalledTimes(3)
    expect(backfill).toHaveBeenNthCalledWith(2, { after: 'item-e', limit: 5 })
    expect(lines[0]).toContain('"outcome": "backfilled"')
    expect(lines[0]).toContain('"rowsCopied": 9')
  })

  it('exits 1 when rows still differ after the walk', async () => {
    const { store, io, lines } = harness([PARITY_BEFORE])

    const code = await runInboxCycleFactsBackfill({
      ctx: ctxOf({ dryRun: false }),
      store,
      io,
    })

    expect(code).toBe(1)
    expect(lines[0]).toContain('"outcome": "rows_remain"')
  })
})
