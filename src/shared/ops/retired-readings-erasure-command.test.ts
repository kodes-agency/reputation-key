import { describe, expect, it, vi } from 'vitest'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import {
  retiredReadingsConfirmationText,
  retiredReadingsErasureCommandSpec,
  retiredReadingsJournalEntry,
  runRetiredReadingsErasure,
  type RetiredReadingsAuditEvent,
  type RetiredReadingsStore,
} from './retired-readings-erasure-command'
import {
  parseOperatorArgs,
  validateOperatorArgs,
  type OperatorContext,
} from './operator-command'

const SPEC = retiredReadingsErasureCommandSpec
const ORG = 'org-1'
const VERIFIED = '2026-11-10T09:00:00.000Z'
const READING = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function parse(...argv: string[]) {
  const parsed = parseOperatorArgs(argv, SPEC)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const APPLY = [
  '--operator',
  'op-1',
  '--org',
  ORG,
  '--reason',
  'retire stars',
  '--ticket',
  'T-1',
  '--apply',
  '--yes',
  SPEC.name,
  `verified=${VERIFIED}`,
  'verification=ID-CHECK-1',
  `confirm=${retiredReadingsConfirmationText(ORG)}`,
]

function ctxOf(args: ReturnType<typeof parse>): OperatorContext {
  return {
    operatorId: args.operator,
    correlationId: 'corr-1',
    organizationId: args.organizationId,
    dryRun: !args.apply,
    reason: args.reason,
    ticket: args.ticket,
    batchSize: args.batchSize ?? SPEC.batchSize?.default,
    decision: { allowed: true } as OperatorContext['decision'],
  }
}

function memoryStore(total: number): RetiredReadingsStore & { left: string[] } {
  const left = Array.from({ length: total }, (_, i) => READING(i + 1))
  return {
    left,
    count: async () => [{ organizationId: ORG, readings: left.length, corrections: 2 }],
    nextBatch: async (_org, limit) => left.slice(0, limit),
    erase: async (_org, ids) => {
      for (const id of ids) left.splice(left.indexOf(id), 1)
      return { readings: ids.length, corrections: 0 }
    },
  }
}

function harness() {
  const out: string[] = []
  const err: string[] = []
  const audit: RetiredReadingsAuditEvent[] = []
  return {
    out,
    err,
    audit,
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
  }
}

describe('erase-retired-readings invocation', () => {
  it('refuses an apply without a ticket, reason or typed --yes', () => {
    for (const drop of ['--ticket', '--reason', '--yes']) {
      const argv = [...APPLY]
      const at = argv.indexOf(drop)
      argv.splice(at, 2)
      expect(validateOperatorArgs(SPEC, parse(...argv))).not.toBeNull()
    }
  })

  it('runs as a dry run without --apply and needs no Organization', () => {
    const args = parse('--operator', 'op-1')
    expect(validateOperatorArgs(SPEC, args)).toBeNull()
    expect(ctxOf(args).dryRun).toBe(true)
  })
})

describe('runRetiredReadingsErasure', () => {
  it('prints counts and deletes nothing by default', async () => {
    const store = memoryStore(3)
    const erase = vi.spyOn(store, 'erase')
    const h = harness()
    const args = parse('--operator', 'op-1')
    const code = await runRetiredReadingsErasure(
      { store, journal: { put: vi.fn(), alert: vi.fn() }, audit: async () => {} },
      ctxOf(args),
      args,
      h.io,
    )
    expect(code).toBe(0)
    expect(h.out.join('\n')).toContain('org=org-1 readings=3 corrections=2')
    expect(erase).not.toHaveBeenCalled()
  })

  it.each([
    ['verified=', 'verified=<iso> and verification=<ref>'],
    ['confirm=', 'typed confirmation required'],
  ])('refuses an apply missing %s', async (prefix, message) => {
    const h = harness()
    const args = parse(...APPLY.filter((token) => !token.startsWith(prefix)))
    const store = memoryStore(1)
    const code = await runRetiredReadingsErasure(
      { store, journal: { put: vi.fn(), alert: vi.fn() }, audit: async () => {} },
      ctxOf(args),
      args,
      h.io,
    )
    expect(code).toBe(1)
    expect(h.err.join('\n')).toContain(message)
    expect(store.left).toHaveLength(1)
  })

  it('refuses an apply without an Organization', async () => {
    const h = harness()
    const args = parse(
      ...APPLY.filter((_, i) => APPLY[i] !== '--org' && APPLY[i - 1] !== '--org'),
    )
    const code = await runRetiredReadingsErasure(
      {
        store: memoryStore(1),
        journal: { put: vi.fn(), alert: vi.fn() },
        audit: async () => {},
      },
      ctxOf(args),
      args,
      h.io,
    )
    expect(code).toBe(1)
    expect(h.err.join('\n')).toContain('--org is required')
  })

  it('journals each batch before deleting it and audits once', async () => {
    const store = memoryStore(5)
    const events: string[] = []
    const h = harness()
    const args = parse(...APPLY, '--batch-size', '2')
    const code = await runRetiredReadingsErasure(
      {
        store: {
          ...store,
          erase: async (org, ids) => {
            events.push(`erase ${ids.length}`)
            return store.erase(org, ids)
          },
        },
        journal: {
          put: async (key, bytes) => {
            const entry = decodeErasureJournalEntry(bytes)
            events.push(`journal ${entry.journalTargets?.ids.length}`)
            expect(key).toContain(entry.id)
            expect(entry.context).toBe('metric')
          },
          alert: vi.fn(),
        },
        audit: async (event) => {
          h.audit.push(event)
        },
        runId: () => 'run-1',
      },
      ctxOf(args),
      args,
      h.io,
    )
    expect(code).toBe(0)
    expect(events).toEqual([
      'journal 2',
      'erase 2',
      'journal 2',
      'erase 2',
      'journal 1',
      'erase 1',
    ])
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({
      actorId: 'op-1',
      outcome: 'succeeded',
      organizationId: ORG,
      resourceId: 'ID-CHECK-1',
    })
  })

  it('stops, alerts and deletes nothing when the journal write fails', async () => {
    const store = memoryStore(3)
    const alert = vi.fn()
    const h = harness()
    const args = parse(...APPLY)
    const code = await runRetiredReadingsErasure(
      {
        store,
        journal: {
          put: async () => {
            throw new Error('bucket down')
          },
          alert,
        },
        audit: async (event) => {
          h.audit.push(event)
        },
      },
      ctxOf(args),
      args,
      h.io,
    )
    expect(code).toBe(1)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(store.left).toHaveLength(3)
    expect(h.audit.map((event) => event.outcome)).toEqual(['failed'])
    expect(h.err.join('\n')).toContain('run the same command again')
  })
})

describe('retiredReadingsJournalEntry', () => {
  const plan = {
    mode: 'apply' as const,
    organizationId: ORG,
    batchSize: 50,
    verifiedAt: new Date(VERIFIED),
    verificationRef: 'ID-CHECK-1',
  }

  it('is IDs-only and identical when the same batch is journaled again', () => {
    const a = retiredReadingsJournalEntry(plan, [READING(2), READING(1)])
    const b = retiredReadingsJournalEntry(plan, [READING(1), READING(2)])
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toContain('property.review')
  })

  it('names a different object for a different batch', () => {
    expect(retiredReadingsJournalEntry(plan, [READING(1)]).id).not.toBe(
      retiredReadingsJournalEntry(plan, [READING(2)]).id,
    )
  })
})
