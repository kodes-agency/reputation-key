// The handler behind `pnpm ops rights-request`, with its effects injected so
// it runs under test. scripts/ops/rights-request.ts supplies the real ones.

import { decodeErasureJournalExport } from '#/shared/db/lifecycle/erasure-journal.server'
import type { OperatorArgs, OperatorContext, OperatorIO } from '../operator-command'
import { runRightsExecutors, type RightsExecutor } from './rights-executor'
import type { RightsAudit } from './rights-audit'
import type { RightsJournal } from './rights-journal'
import {
  describeRightsReport,
  planRightsReplay,
  planRightsRequest,
  type RightsRequestPlan,
  RIGHTS_REQUEST_COMMAND,
} from './rights-request-command'

export const FINAL_WARNING_TOKEN = 'final-warning'

export type RightsRequestEffects = Readonly<{
  readFile: (path: string) => Promise<string>
  writeExportFile: (path: string, bytes: Uint8Array) => Promise<void>
  journal: RightsJournal
  /** The write for the audit event of each apply run. */
  auditWrite: RightsAudit['write']
  subjectRefusal: (plan: RightsRequestPlan) => Promise<string | null>
  /** Executors for the request; a final warning runs the notification one alone. */
  executors: (finalWarning: boolean) => ReadonlyArray<RightsExecutor>
}>

export async function handleRightsRequest(
  effects: RightsRequestEffects,
  ctx: OperatorContext,
  args: OperatorArgs,
  io: OperatorIO,
): Promise<number> {
  const planned = planRightsRequest(ctx, args)
  if (!planned.ok) {
    io.err(`${RIGHTS_REQUEST_COMMAND}: ${planned.error}`)
    return 1
  }
  const { plan } = planned
  for (const line of describeRightsReport(plan)) io.out(line)

  if (plan.mode === 'replay' && plan.journalFile) {
    const journal = decodeErasureJournalExport(await effects.readFile(plan.journalFile))
    for (const item of planRightsReplay(plan, journal.entries)) {
      io.out(`${item.journalId} ${item.scope} ${item.disposition}`)
    }
    return 0
  }
  return runRightsExecutors({
    plan,
    io,
    journal: effects.journal,
    audit: { operatorId: ctx.operatorId, write: effects.auditWrite },
    subjectRefusal: effects.subjectRefusal,
    executors: effects.executors(args.positionals.includes(FINAL_WARNING_TOKEN)),
    writeExportFile: effects.writeExportFile,
  })
}
