// The handler behind `pnpm ops rights-request`, with its effects injected so
// it runs under test. scripts/ops/rights-request.ts supplies the real ones.

import { decodeErasureJournalExport } from '#/shared/db/lifecycle/erasure-journal.server'
import type { OperatorArgs, OperatorContext, OperatorIO } from '../operator-command'
import {
  describeRightsReport,
  planRightsReplay,
  planRightsRequest,
  RIGHTS_REQUEST_COMMAND,
  type RightsRequestPlan,
} from './rights-request-command'

export type NotificationRightsRun = Readonly<{
  scope: 'access' | 'property' | 'organization'
  mode: 'report' | 'apply'
  organizationId: string
  propertyId?: string
  batchSize: number
  finalWarning: boolean
  requestRef?: string
}>

export type RightsRequestEffects = Readonly<{
  production: boolean
  readFile: (path: string) => Promise<string>
  /** Writes an export private to the operator. */
  writeExport: (path: string, text: string) => Promise<void>
  notification: (
    run: NotificationRightsRun,
  ) => Promise<Readonly<{ lines: readonly string[]; exportJson?: string }>>
}>

const FINAL_WARNING = 'final-warning'
const EXPORT_FILE = 'export-file='

function tokenValue(args: OperatorArgs, prefix: string): string | undefined {
  return args.positionals.find((token) => token.startsWith(prefix))?.slice(prefix.length)
}

async function replay(
  effects: RightsRequestEffects,
  plan: RightsRequestPlan,
  io: OperatorIO,
): Promise<number> {
  const journal = decodeErasureJournalExport(
    await effects.readFile(plan.journalFile ?? ''),
  )
  for (const item of planRightsReplay(plan, journal.entries)) {
    io.out(`${item.journalId} ${item.scope} ${item.disposition}`)
  }
  return 0
}

async function notificationExecutor(
  effects: RightsRequestEffects,
  plan: RightsRequestPlan,
  args: OperatorArgs,
  io: OperatorIO,
): Promise<void> {
  if (
    plan.scope !== 'access' &&
    plan.scope !== 'property' &&
    plan.scope !== 'organization'
  ) {
    return
  }
  const result = await effects.notification({
    scope: plan.scope,
    mode: plan.mode === 'apply' ? 'apply' : 'report',
    organizationId: plan.organizationId,
    ...(plan.propertyId ? { propertyId: plan.propertyId } : {}),
    batchSize: plan.batchSize,
    finalWarning: args.positionals.includes(FINAL_WARNING),
    ...(plan.verificationRef ? { requestRef: plan.verificationRef } : {}),
  })
  for (const line of result.lines) io.out(`notification ${line}`)
  const exportFile = tokenValue(args, EXPORT_FILE)
  if (result.exportJson && exportFile) {
    await effects.writeExport(exportFile, `${result.exportJson}\n`)
    io.out(`notification export written to ${exportFile}`)
  }
}

/** Scopes whose apply some executor has been composed for. */
const APPLY_COMPOSED: ReadonlySet<string> = new Set(['property', 'organization'])

export async function handleRightsRequest(
  effects: RightsRequestEffects,
  ctx: OperatorContext,
  args: OperatorArgs,
  io: OperatorIO,
): Promise<number> {
  const planned = planRightsRequest(ctx, args, { production: effects.production })
  if (!planned.ok) {
    io.err(`${RIGHTS_REQUEST_COMMAND}: ${planned.error}`)
    return 1
  }
  const { plan } = planned
  for (const line of describeRightsReport(plan)) io.out(line)

  if (plan.mode === 'replay' && plan.journalFile) return replay(effects, plan, io)
  if (plan.mode === 'apply' && !APPLY_COMPOSED.has(plan.scope)) {
    io.err(
      `${RIGHTS_REQUEST_COMMAND}: no executor is composed for ${plan.scope} yet; nothing was changed`,
    )
    return 1
  }
  await notificationExecutor(effects, plan, args, io)
  return 0
}
