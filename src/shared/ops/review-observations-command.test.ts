import { describe, expect, it, vi } from 'vitest'
import {
  planReviewObservations,
  reviewObservationsCommandSpec,
  runReviewObservationsPrune,
  type RepeatBatchResult,
  type RepeatPruneStore,
} from './review-observations-command'
import { parseOperatorArgs, validateOperatorArgs } from './operator-command'

const SPEC = reviewObservationsCommandSpec
const ORG = 'org-observations-1'

function argsOf(...argv: string[]) {
  const parsed = parseOperatorArgs(argv, SPEC)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

/** Three batches of Reviews, then none left. */
const BATCHES: ReadonlyArray<RepeatBatchResult> = [
  { reviews: 2, observations: 600, repeats: 596, last: 'review-b' },
  { reviews: 2, observations: 500, repeats: 495, last: 'review-d' },
  { reviews: 1, observations: 3, repeats: 0, last: 'review-e' },
  { reviews: 0, observations: 0, repeats: 0, last: null },
]

function harness(overrides: Partial<RepeatPruneStore> = {}) {
  const lines: string[] = []
  const errors: string[] = []
  const walk = () => {
    let call = 0
    return vi.fn(async () => BATCHES[Math.min(call++, BATCHES.length - 1)]!)
  }
  const store: RepeatPruneStore = {
    scan: walk(),
    prune: walk(),
    openEvidence: vi.fn(async () => 'run-1'),
    closeEvidence: vi.fn(async () => undefined),
    failEvidence: vi.fn(async () => undefined),
    ...overrides,
  }
  return {
    lines,
    errors,
    store,
    io: {
      out: (line: string) => lines.push(line),
      err: (line: string) => errors.push(line),
    },
  }
}

const ctx = (dryRun: boolean, organizationId?: string) => ({
  dryRun,
  operatorId: 'denev',
  correlationId: 'corr-1',
  batchSize: 2,
  ...(organizationId === undefined ? {} : { organizationId }),
  ...(dryRun ? {} : { reason: 'observation backlog' }),
})

const lastJson = (lines: string[]) =>
  JSON.parse(lines.filter((line) => line.startsWith('{')).at(-1)!) as Record<
    string,
    unknown
  >

describe('ops review-observations invocation', () => {
  it('takes the one action and nothing after it', () => {
    expect(planReviewObservations(argsOf('prune', '--operator', 'denev'))).toEqual({
      ok: true,
    })
    expect(planReviewObservations(argsOf('--operator', 'denev'))).toMatchObject({
      ok: false,
    })
    expect(
      planReviewObservations(argsOf('prune', 'extra', '--operator', 'denev')),
    ).toMatchObject({ ok: false })
  })

  it('is a destructive mutation: --apply needs a reason and the typed name', () => {
    expect(
      validateOperatorArgs(
        SPEC,
        argsOf('prune', '--operator', 'denev', '--reason', 'backlog', '--apply'),
      ),
    ).not.toBeNull()
    expect(
      validateOperatorArgs(
        SPEC,
        argsOf(
          'prune',
          '--operator',
          'denev',
          '--reason',
          'backlog',
          '--yes',
          SPEC.name,
          '--apply',
        ),
      ),
    ).toBeNull()
  })
})

describe('ops review-observations prune', () => {
  it('reports by default: walks every batch, deletes nothing and records no evidence', async () => {
    const { store, io, lines } = harness()

    const code = await runReviewObservationsPrune({ ctx: ctx(true), store, io })

    expect(code).toBe(0)
    expect(store.scan).toHaveBeenNthCalledWith(1, { after: null, limit: 2 })
    expect(store.scan).toHaveBeenNthCalledWith(2, { after: 'review-b', limit: 2 })
    expect(store.scan).toHaveBeenCalledTimes(4)
    expect(store.prune).not.toHaveBeenCalled()
    expect(store.openEvidence).not.toHaveBeenCalled()
    expect(lastJson(lines)).toMatchObject({
      outcome: 'would_delete',
      organizationId: 'all',
      reviews: 5,
      observations: 1103,
      repeats: 1091,
      kept: 12,
      batches: 3,
    })
  })

  it('applies batch by batch inside one evidence record', async () => {
    const { store, io, lines } = harness()

    const code = await runReviewObservationsPrune({ ctx: ctx(false, ORG), store, io })

    expect(code).toBe(0)
    expect(store.scan).not.toHaveBeenCalled()
    expect(store.prune).toHaveBeenNthCalledWith(1, {
      after: null,
      limit: 2,
      organizationId: ORG,
    })
    expect(store.openEvidence).toHaveBeenCalledWith(2)
    expect(store.closeEvidence).toHaveBeenCalledWith('run-1', {
      batches: 3,
      rowsDeleted: 1091,
    })
    expect(lastJson(lines)).toMatchObject({
      outcome: 'deleted',
      organizationId: ORG,
      repeats: 1091,
      kept: 12,
      operator: 'denev',
      reason: 'observation backlog',
      correlationId: 'corr-1',
    })
  })

  it('stops on a failed batch, closes the evidence as failed and says how far it got', async () => {
    let call = 0
    const { store, io, lines, errors } = harness({
      prune: vi.fn(async () => {
        call += 1
        if (call === 2) throw new Error('lock timeout')
        return BATCHES[0]!
      }),
    })

    const code = await runReviewObservationsPrune({ ctx: ctx(false), store, io })

    expect(code).toBe(1)
    expect(store.failEvidence).toHaveBeenCalledWith('run-1', expect.any(Error))
    expect(store.closeEvidence).not.toHaveBeenCalled()
    expect(lastJson(lines)).toMatchObject({
      outcome: 'failed',
      repeats: 596,
      resumeAfter: 'review-b',
    })
    expect(errors.join('\n')).toContain('lock timeout')
  })
})
