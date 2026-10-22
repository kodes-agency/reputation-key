import { describe, expect, it, vi } from 'vitest'
import type {
  OrphanSequenceRelease,
  OrphanSequenceScan,
} from '#/shared/db/review-analysis-orphan-sequences'
import {
  aiReleaseOrphanSequencesCommandSpec,
  planAiReleaseOrphanSequences,
  runAiReleaseOrphanSequences,
  type OrphanSequenceStore,
} from './ai-release-orphan-sequences-command'
import { parseOperatorArgs, validateOperatorArgs } from './operator-command'

const PROPERTY = '5eed0100-0000-4000-8000-000000000001'
const SPEC = aiReleaseOrphanSequencesCommandSpec

function argsOf(...argv: string[]) {
  const parsed = parseOperatorArgs(argv, SPEC)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const SCANNED: Extract<OrphanSequenceScan, { status: 'scanned' }> = {
  status: 'scanned',
  organizationId: 'org-1',
  propertyId: PROPERTY,
  sourceEpoch: 0,
  reviewAnalysisEpoch: 1,
  analysisStartSequence: 200,
  headSequence: 210,
  breakdown: { settled: 6, held: 1, announced: 0, released: 0, orphaned: 3 },
  orphans: [203, 204, 205],
}

function harness(overrides: Partial<OrphanSequenceStore> = {}) {
  const lines: string[] = []
  const errors: string[] = []
  const store: OrphanSequenceStore = {
    scan: vi.fn(async () => SCANNED),
    release: vi.fn(async (): Promise<OrphanSequenceRelease> => ({
      status: 'released',
      scan: SCANNED,
      recorded: 3,
    })),
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

const ctx = (dryRun: boolean) => ({
  dryRun,
  operatorId: 'denev',
  correlationId: 'corr-1',
  reason: dryRun ? undefined : 'leaked by replays',
})

describe('ops ai release-orphan-sequences invocation', () => {
  it('takes one Property id after the action', () => {
    expect(
      planAiReleaseOrphanSequences(
        argsOf('release-orphan-sequences', PROPERTY, '--operator', 'denev'),
      ),
    ).toEqual({ ok: true, propertyId: PROPERTY })
  })

  it.each([
    [['other-action', PROPERTY], "the only action is 'release-orphan-sequences'"],
    [['release-orphan-sequences'], '<propertyId> is required'],
    [['release-orphan-sequences', 'not-a-uuid'], '<propertyId> must be a UUID'],
    [['release-orphan-sequences', PROPERTY, PROPERTY], 'one <propertyId> at a time'],
  ])('rejects %j', (positionals, error) => {
    expect(
      planAiReleaseOrphanSequences(argsOf(...positionals, '--operator', 'denev')),
    ).toEqual({ ok: false, error })
  })

  it('needs a reason with --apply and none without', () => {
    const base = ['release-orphan-sequences', PROPERTY, '--operator', 'denev']

    expect(validateOperatorArgs(SPEC, argsOf(...base))).toBeNull()
    expect(validateOperatorArgs(SPEC, argsOf(...base, '--apply'))).toBe(
      '--reason <text> is required with --apply',
    )
    expect(
      validateOperatorArgs(SPEC, argsOf(...base, '--apply', '--reason', 'x')),
    ).toBeNull()
  })
})

describe('ops ai release-orphan-sequences run', () => {
  it('reports the orphans and their count on a dry run and writes nothing', async () => {
    const { lines, store, io } = harness()

    const exitCode = await runAiReleaseOrphanSequences({
      ctx: ctx(true),
      propertyId: PROPERTY,
      store,
      io,
    })

    expect(exitCode).toBe(0)
    expect(store.release).not.toHaveBeenCalled()
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      outcome: 'would_release',
      orphans: [203, 204, 205],
      breakdown: { orphaned: 3 },
    })
    expect(lines[1]).toContain('3 orphan sequence(s)')
  })

  it('prints the operator, reason and correlation id when it records', async () => {
    const { lines, store, io } = harness()

    const exitCode = await runAiReleaseOrphanSequences({
      ctx: ctx(false),
      propertyId: PROPERTY,
      store,
      io,
    })

    expect(exitCode).toBe(0)
    expect(store.release).toHaveBeenCalledWith(PROPERTY)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      outcome: 'released',
      operator: 'denev',
      reason: 'leaked by replays',
      correlationId: 'corr-1',
      recorded: 3,
    })
  })

  it('says nothing was released when the second run finds no orphan', async () => {
    const { lines, store, io } = harness({
      release: async () => ({
        status: 'released',
        scan: { ...SCANNED, orphans: [] },
        recorded: 0,
      }),
    })

    const exitCode = await runAiReleaseOrphanSequences({
      ctx: ctx(false),
      propertyId: PROPERTY,
      store,
      io,
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      outcome: 'nothing_to_release',
      recorded: 0,
    })
  })

  it('exits 1 and says when to retry while the head is still moving', async () => {
    const headUpdatedAt = new Date('2026-10-22T10:00:00.000Z')
    const { errors, io } = harness()

    const exitCode = await runAiReleaseOrphanSequences({
      ctx: ctx(false),
      propertyId: PROPERTY,
      store: {
        scan: async () => SCANNED,
        release: async () => ({
          status: 'head_recently_updated',
          headUpdatedAt,
          quietAfter: new Date('2026-10-22T10:15:00.000Z'),
        }),
      },
      io,
    })

    expect(exitCode).toBe(1)
    expect(errors.join('\n')).toContain('2026-10-22T10:15:00.000Z')
  })

  it.each(['property_not_found', 'not_enabled', 'no_head'] as const)(
    'exits 1 on a dry run when the scan answers %s',
    async (status) => {
      const { lines, store, io } = harness({ scan: async () => ({ status }) })

      const exitCode = await runAiReleaseOrphanSequences({
        ctx: ctx(true),
        propertyId: PROPERTY,
        store,
        io,
      })

      expect(exitCode).toBe(1)
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ outcome: status })
    },
  )
})
