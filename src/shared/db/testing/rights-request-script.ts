// Drives the rights executors the way scripts/ops/rights-request.ts does after
// the operator harness: parse the argv, plan, run, and capture what was written.

import { parseOperatorArgs, type OperatorContext } from '#/shared/ops/operator-command'
import {
  runRightsExecutors,
  type RightsExecutor,
} from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  type RightsJournalStore,
} from '#/shared/ops/rights/rights-journal'
import {
  planRightsRequest,
  rightsRequestCommandSpec,
} from '#/shared/ops/rights/rights-request-command'

export const RIGHTS_VERIFIED_ARGS = [
  'verified=2026-11-01T10:00:00Z',
  'verification=ticket:123',
]

export const quietJournalStore: RightsJournalStore = {
  put: async () => {},
  alert: () => {},
}

export function putInto(journal: Map<string, string>): RightsJournalStore {
  return {
    put: async (key, bytes) => {
      journal.set(key, bytes)
    },
    alert: () => {},
  }
}

/** A journal store that keeps every entry and alert for the test to read. */
export function recordingRightsJournal(): {
  store: RightsJournalStore
  puts: Map<string, string>
  alerts: unknown[]
} {
  const puts = new Map<string, string>()
  const alerts: unknown[] = []
  return {
    puts,
    alerts,
    store: {
      ...putInto(puts),
      alert: (input) => {
        alerts.push(input)
      },
    },
  }
}

export function organizationApplyArgv(organizationId: string, ticket = 'T-1'): string[] {
  return [
    'organization',
    '--org',
    organizationId,
    ...RIGHTS_VERIFIED_ARGS,
    '--reason',
    'closure request',
    '--ticket',
    ticket,
    `confirm=ERASE ORGANIZATION ${organizationId}`,
    '--apply',
    '--yes',
    'ops:rights-request',
  ]
}

export function propertyReportArgv(organizationId: string, propertyId: string): string[] {
  return ['property', '--org', organizationId, '--property', propertyId]
}

export function propertyApplyArgv(
  organizationId: string,
  propertyId: string,
  ticket: string,
): string[] {
  return [
    ...propertyReportArgv(organizationId, propertyId),
    ...RIGHTS_VERIFIED_ARGS,
    '--reason',
    'erasure request',
    '--ticket',
    ticket,
    `confirm=ERASE PROPERTY ${propertyId}`,
    '--apply',
    '--yes',
    'ops:rights-request',
  ]
}

export function planRightsArgv(argv: string[]) {
  const parsed = parseOperatorArgs(
    ['--operator', 'op', ...argv],
    rightsRequestCommandSpec,
  )
  if (!parsed.ok) throw new Error(parsed.error)
  const ctx = {
    operatorId: 'op',
    correlationId: 'c',
    organizationId: parsed.args.organizationId,
    propertyId: parsed.args.propertyId,
    dryRun: !parsed.args.apply,
    batchSize: parsed.args.batchSize,
  } as unknown as OperatorContext
  return planRightsRequest(ctx, parsed.args)
}

export async function runRightsRequestScript(options: {
  executors: readonly RightsExecutor[]
  argv: string[]
  store?: RightsJournalStore
}) {
  const planned = planRightsArgv(options.argv)
  const out: string[] = []
  const err: string[] = []
  const files = new Map<string, string>()
  if (!planned.ok) return { exit: 1, out, err: [planned.error], files }
  const exit = await runRightsExecutors({
    plan: planned.plan,
    executors: options.executors,
    journal: createRightsJournal(options.store ?? quietJournalStore),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async (path, bytes) => {
      files.set(path, Buffer.from(bytes).toString('utf8'))
    },
  })
  return { exit, out, err, files }
}
