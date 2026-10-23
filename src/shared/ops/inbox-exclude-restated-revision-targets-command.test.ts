import { describe, expect, it, vi } from 'vitest'
import {
  inboxExcludeRestatedRevisionTargetsCommandSpec,
  planInboxExcludeRestatedRevisionTargets,
  runInboxExcludeRestatedRevisionTargets,
  summarizeExclusionCandidates,
  type ExclusionCandidate,
  type ExclusionPorts,
} from './inbox-exclude-restated-revision-targets-command'
import {
  parseOperatorArgs,
  runOperatorCommand,
  validateOperatorArgs,
} from './operator-command'

const PROPERTY = 'e8c70000-0000-4000-8000-000000000001'
const ORG = 'org-exclusion-command'
const SPEC = inboxExcludeRestatedRevisionTargetsCommandSpec
const ACTION = 'exclude-restated-revision-targets'
const CORRELATION = '0b7a6e0e-6a8e-4f0e-9e43-3f0a6b2d6a01'
const NOW = new Date('2026-10-24T09:00:00.000Z')

function argsOf(...argv: string[]) {
  const parsed = parseOperatorArgs(argv, SPEC)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const candidate = (
  suffix: string,
  overrides: Partial<ExclusionCandidate> = {},
): ExclusionCandidate => ({
  inboxItemId: `e8c70000-0000-4000-8000-0000000001${suffix}`,
  cycleNumber: 2,
  reviewId: `e8c70000-0000-4000-8000-0000000002${suffix}`,
  revision: 2,
  itemStatus: 'open',
  targetState: 'open',
  pendingReminderSlots: 0,
  ...overrides,
})

type ApplyInput = Parameters<ExclusionPorts['apply']>[0]

const CANDIDATES = [
  candidate('01'),
  candidate('02', { pendingReminderSlots: 1 }),
  candidate('03', { itemStatus: 'closed', targetState: 'late' }),
  candidate('04', { itemStatus: 'closed', targetState: 'on_time' }),
]

function harness(overrides: Partial<ExclusionPorts> = {}) {
  const lines: string[] = []
  const errors: string[] = []
  const ports: ExclusionPorts = {
    findProperty: vi.fn(async () => ({ organizationId: ORG, propertyId: PROPERTY })),
    listRestatedRevisions: vi.fn(async () => [
      { reviewId: CANDIDATES[0]?.reviewId ?? '', sourceEpoch: 0, revision: 2 },
    ]),
    scan: vi.fn(async () => CANDIDATES),
    apply: vi.fn(async ({ candidates }: ApplyInput) =>
      candidates.map((one) => ({
        inboxItemId: one.inboxItemId,
        cycleNumber: one.cycleNumber,
        outcome: 'excluded' as const,
        cancelledReminderSlots: one.pendingReminderSlots,
      })),
    ),
    now: () => NOW,
    ...overrides,
  }
  return {
    lines,
    errors,
    ports,
    io: {
      out: (line: string) => lines.push(line),
      err: (line: string) => errors.push(line),
    },
  }
}

const ctx = (dryRun: boolean, extra: { ticket?: string } = {}) => ({
  dryRun,
  operatorId: 'denev',
  correlationId: CORRELATION,
  reason: dryRun ? undefined : 'Google restated the reviews on 2026-10-23',
  ticket: extra.ticket,
})

describe('ops inbox exclude-restated-revision-targets invocation', () => {
  it('takes one Property id after the action', () => {
    expect(
      planInboxExcludeRestatedRevisionTargets(
        argsOf(ACTION, PROPERTY, '--operator', 'denev'),
      ),
    ).toEqual({ ok: true, propertyId: PROPERTY })
  })

  it.each([
    [['other-action', PROPERTY], `the only action is '${ACTION}'`],
    [[ACTION], '<propertyId> is required'],
    [[ACTION, 'not-a-uuid'], '<propertyId> must be a UUID'],
    [[ACTION, PROPERTY, PROPERTY], 'one <propertyId> at a time'],
  ])('rejects %j', (positionals, error) => {
    expect(
      planInboxExcludeRestatedRevisionTargets(
        argsOf(...positionals, '--operator', 'denev'),
      ),
    ).toEqual({ ok: false, error })
  })

  it('is invoked as the guides spell it', () => {
    expect(SPEC.name).toBe('ops:inbox')
    expect(SPEC.usage).toBe(
      'pnpm ops inbox exclude-restated-revision-targets <propertyId> --operator <id> [--reason <text> --ticket <ref> --apply]',
    )
  })

  it('needs a reason with --apply, takes a ticket, and needs neither for the report', () => {
    const base = [ACTION, PROPERTY, '--operator', 'denev']

    expect(validateOperatorArgs(SPEC, argsOf(...base))).toBeNull()
    expect(validateOperatorArgs(SPEC, argsOf(...base, '--apply'))).toBe(
      '--reason <text> is required with --apply',
    )
    expect(
      validateOperatorArgs(
        SPEC,
        argsOf(...base, '--apply', '--reason', 'x', '--ticket', 'OPS-70'),
      ),
    ).toBeNull()
  })

  it('refuses --apply without --reason through the audited harness and writes nothing', async () => {
    const { ports, io, errors } = harness()
    const decide = vi.fn(async () => ({ allowed: true as const }))

    const result = await runOperatorCommand(
      SPEC,
      async () =>
        runInboxExcludeRestatedRevisionTargets({
          ctx: ctx(false),
          propertyId: PROPERTY,
          ports,
          io,
        }),
      { decide: decide as never },
      [ACTION, PROPERTY, '--operator', 'denev', '--apply'],
      io,
    )

    expect(result.exitCode).toBe(1)
    expect(decide).not.toHaveBeenCalled()
    expect(ports.apply).not.toHaveBeenCalled()
    expect(errors.join('\n')).toContain('--reason <text> is required with --apply')
  })
})

describe('summarizeExclusionCandidates', () => {
  it('counts candidates by item status and by target state, and totals the pending slots', () => {
    expect(summarizeExclusionCandidates(CANDIDATES)).toEqual({
      candidates: 4,
      byItemStatus: { open: 2, closed: 2 },
      byTargetState: { open: 2, on_time: 1, late: 1, cancelled: 0 },
      pendingReminderSlots: 1,
    })
  })

  it('counts nothing for no candidates', () => {
    expect(summarizeExclusionCandidates([])).toEqual({
      candidates: 0,
      byItemStatus: { open: 0, closed: 0 },
      byTargetState: { open: 0, on_time: 0, late: 0, cancelled: 0 },
      pendingReminderSlots: 0,
    })
  })
})

describe('ops inbox exclude-restated-revision-targets run', () => {
  it('reports the counts and the candidate ids on a dry run and writes nothing', async () => {
    const { lines, ports, io } = harness()

    const exitCode = await runInboxExcludeRestatedRevisionTargets({
      ctx: ctx(true),
      propertyId: PROPERTY,
      ports,
      io,
    })

    expect(exitCode).toBe(0)
    expect(ports.apply).not.toHaveBeenCalled()
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      outcome: 'would_exclude',
      organizationId: ORG,
      propertyId: PROPERTY,
      restatedRevisions: 1,
      candidates: 4,
      byItemStatus: { open: 2, closed: 2 },
      byTargetState: { open: 2, on_time: 1, late: 1, cancelled: 0 },
      pendingReminderSlots: 1,
      candidateIds: CANDIDATES.map((one) => ({
        inboxItemId: one.inboxItemId,
        cycleNumber: one.cycleNumber,
      })),
    })
    expect(lines[1]).toContain('report only')
    expect(lines[1]).toContain('--reason <text> --apply')
  })

  it('hands the scan only the restated revisions Review reports', async () => {
    const { ports, io } = harness()

    await runInboxExcludeRestatedRevisionTargets({
      ctx: ctx(true),
      propertyId: PROPERTY,
      ports,
      io,
    })

    expect(ports.listRestatedRevisions).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    expect(ports.scan).toHaveBeenCalledWith({
      scope: { organizationId: ORG, propertyId: PROPERTY },
      restated: [{ reviewId: CANDIDATES[0]?.reviewId, revision: 2 }],
    })
  })

  it('records the exclusions with the operator trail and prints it', async () => {
    const { lines, ports, io } = harness()

    const exitCode = await runInboxExcludeRestatedRevisionTargets({
      ctx: ctx(false, { ticket: 'OPS-70' }),
      propertyId: PROPERTY,
      ports,
      io,
    })

    expect(exitCode).toBe(0)
    expect(ports.apply).toHaveBeenCalledWith({
      scope: { organizationId: ORG, propertyId: PROPERTY },
      candidates: CANDIDATES,
      audit: {
        operatorId: 'denev',
        ticket: 'OPS-70',
        correlationId: CORRELATION,
        at: NOW,
      },
    })
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      outcome: 'excluded',
      operator: 'denev',
      reason: 'Google restated the reviews on 2026-10-23',
      ticket: 'OPS-70',
      correlationId: CORRELATION,
      candidates: 4,
      results: { excluded: 4, already_excluded: 0 },
      cancelledReminderSlots: 1,
    })
  })

  it('prints a null ticket when none was given', async () => {
    const { lines, ports, io } = harness()

    await runInboxExcludeRestatedRevisionTargets({
      ctx: ctx(false),
      propertyId: PROPERTY,
      ports,
      io,
    })

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ ticket: null })
  })

  it('finds nothing to do on a second run', async () => {
    const { lines, ports, io } = harness({ scan: vi.fn(async () => []) })

    const exitCode = await runInboxExcludeRestatedRevisionTargets({
      ctx: ctx(false),
      propertyId: PROPERTY,
      ports,
      io,
    })

    expect(exitCode).toBe(0)
    expect(ports.apply).not.toHaveBeenCalled()
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      outcome: 'nothing_to_exclude',
      candidates: 0,
      operator: 'denev',
    })
  })

  it('exits 1 and names the cycle when a candidate is refused', async () => {
    const { lines, errors, ports, io } = harness({
      apply: vi.fn(async ({ candidates }: ApplyInput) =>
        candidates.map((one, index) => ({
          inboxItemId: one.inboxItemId,
          cycleNumber: one.cycleNumber,
          outcome:
            index === 0 ? ('refused_cycle_changed' as const) : ('excluded' as const),
          cancelledReminderSlots: 0,
        })),
      ),
    })

    const exitCode = await runInboxExcludeRestatedRevisionTargets({
      ctx: ctx(false),
      propertyId: PROPERTY,
      ports,
      io,
    })

    expect(exitCode).toBe(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      outcome: 'partly_refused',
      results: { excluded: 3, refused_cycle_changed: 1 },
    })
    expect(errors.join('\n')).toContain(CANDIDATES[0]?.inboxItemId)
    expect(errors.join('\n')).toContain('no longer the one recorded')
  })

  it('refuses a Property that does not exist, on a dry run and on apply', async () => {
    for (const dryRun of [true, false]) {
      const { lines, errors, ports, io } = harness({
        findProperty: vi.fn(async () => null),
      })

      const exitCode = await runInboxExcludeRestatedRevisionTargets({
        ctx: ctx(dryRun),
        propertyId: PROPERTY,
        ports,
        io,
      })

      expect(exitCode).toBe(1)
      expect(JSON.parse(lines[0] ?? '{}')).toEqual({ outcome: 'property_not_found' })
      expect(errors[0]).toContain('no Property has that id')
      expect(ports.scan).not.toHaveBeenCalled()
      expect(ports.apply).not.toHaveBeenCalled()
    }
  })

  it('prints no Review or guest content', async () => {
    const { lines, ports, io } = harness()

    await runInboxExcludeRestatedRevisionTargets({
      ctx: ctx(true),
      propertyId: PROPERTY,
      ports,
      io,
    })

    expect(Object.keys(JSON.parse(lines[0] ?? '{}')).sort()).toEqual([
      'byItemStatus',
      'byTargetState',
      'candidateIds',
      'candidates',
      'organizationId',
      'outcome',
      'pendingReminderSlots',
      'propertyId',
      'restatedRevisions',
    ])
  })
})
