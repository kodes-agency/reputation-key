// Per-context executors for the manual rights request command. Each executor
// owns one context's data: it reports what it holds for a tenant, lists the
// export files it contributes, and (outside production) applies the erasure.
// The command contract decides whether a request may apply at all; this module
// only runs the executors that cover the requested scope.

import type { BackupErasureLedgerContext } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { OperatorIO } from '../operator-command'
import type { RightsJournal } from './rights-journal'
import type { RightsRequestPlan, RightsRequestScope } from './rights-request-command'

export type RightsExportFile = Readonly<{
  /** Relative, slash-separated path inside the export directory. */
  path: string
  bytes: Uint8Array
}>

export type RightsApplyOutcome =
  | Readonly<{ ok: true; lines: ReadonlyArray<string> }>
  | Readonly<{ ok: false; error: string }>

export type RightsPreflightOutcome =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>

export type RightsExecutor = Readonly<{
  name: string
  scopes: ReadonlyArray<RightsRequestScope>
  /** Lifecycle contexts whose erasure this executor journals before it applies. */
  journalContexts: ReadonlyArray<BackupErasureLedgerContext>
  /**
   * Read-only refusals that need no write: a missing argument, a scope the
   * executor cannot erase, a context that is not ready. Runs for every
   * covering executor before the first apply.
   */
  preflight?: (plan: RightsRequestPlan) => Promise<RightsPreflightOutcome>
  /** Content-free lines: counts, codes and ids only. */
  report: (plan: RightsRequestPlan) => Promise<ReadonlyArray<string>>
  /** The allowlisted files this context adds to an access or closure export. */
  exportFiles: (plan: RightsRequestPlan) => Promise<ReadonlyArray<RightsExportFile>>
  apply: (plan: RightsRequestPlan) => Promise<RightsApplyOutcome>
}>

export type RunRightsExecutorsInput = Readonly<{
  plan: RightsRequestPlan
  executors: ReadonlyArray<RightsExecutor>
  io: OperatorIO
  /** Apply is refused when the journal has no store. */
  journal: RightsJournal
  writeExportFile: (path: string, bytes: Uint8Array) => Promise<void>
}>

/** Whether any executor covers the plan's scope. */
export function rightsExecutorsFor(
  plan: RightsRequestPlan,
  executors: ReadonlyArray<RightsExecutor>,
): ReadonlyArray<RightsExecutor> {
  return executors.filter((executor) => executor.scopes.includes(plan.scope))
}

async function writeExports(
  input: RunRightsExecutorsInput,
  covering: ReadonlyArray<RightsExecutor>,
): Promise<number> {
  const { plan, io, writeExportFile } = input
  if (!plan.exportDir) {
    io.out('export: pass out=<dir> to write the export files')
    return 0
  }
  let written = 0
  for (const executor of covering) {
    for (const file of await executor.exportFiles(plan)) {
      await writeExportFile(`${plan.exportDir}/${file.path}`, file.bytes)
      io.out(`wrote ${file.path} (${file.bytes.byteLength} bytes)`)
      written += 1
    }
  }
  return written
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

/** The first refusal any covering executor or the journal gives, or null. */
async function firstPreflightRefusal(
  input: RunRightsExecutorsInput,
  covering: ReadonlyArray<RightsExecutor>,
): Promise<string | null> {
  const { plan, journal } = input
  for (const executor of covering) {
    const journalError = journal.check(plan, executor.journalContexts)
    if (journalError) return `${executor.name}: ${journalError}`
    try {
      const outcome = (await executor.preflight?.(plan)) ?? { ok: true as const }
      if (!outcome.ok) return `${executor.name}: ${outcome.error}`
    } catch (error) {
      return `${executor.name}: ${errorMessage(error)}`
    }
  }
  return null
}

async function applyJournaled(
  input: RunRightsExecutorsInput,
  executor: RightsExecutor,
): Promise<RightsApplyOutcome> {
  try {
    return await input.journal.run(input.plan, executor.journalContexts, () =>
      executor.apply(input.plan),
    )
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

async function applyAll(
  input: RunRightsExecutorsInput,
  covering: ReadonlyArray<RightsExecutor>,
): Promise<number> {
  const { plan, io } = input
  const refusal = await firstPreflightRefusal(input, covering)
  if (refusal) {
    io.err(`rights-request: ${refusal}; nothing was changed`)
    return 1
  }
  const applied: string[] = []
  for (const executor of covering) {
    const outcome = await applyJournaled(input, executor)
    if (!outcome.ok) {
      const done = applied.length > 0 ? applied.join(', ') : 'none'
      io.err(
        `rights-request: ${executor.name}: ${outcome.error}; executors applied before it: ${done}`,
      )
      return 1
    }
    applied.push(executor.name)
    for (const line of outcome.lines) io.out(`${executor.name}: ${line}`)
    io.out(
      `audit: ${executor.name} applied scope=${plan.scope} org=${plan.organizationId}` +
        `${plan.propertyId ? ` property=${plan.propertyId}` : ''}` +
        ` journal=${input.journal.entryIds(plan, executor.journalContexts).join(',')}`,
    )
  }
  return 0
}

/**
 * Report and export in report mode; apply in apply mode. Every covering
 * executor and the journal are checked before the first apply, so a refusal
 * changes nothing. A refusal after that point stops the run before the next
 * executor starts and names the executors that had already applied.
 */
export async function runRightsExecutors(
  input: RunRightsExecutorsInput,
): Promise<number> {
  const { plan, io } = input
  const covering = rightsExecutorsFor(plan, input.executors)
  if (covering.length === 0) {
    // A report for a scope nobody covers has nothing to add to the plan lines.
    if (plan.mode !== 'apply') return 0
    io.err(
      `rights-request: no executor is composed for ${plan.scope}; nothing was changed`,
    )
    return 1
  }
  if (plan.mode === 'apply') return applyAll(input, covering)
  for (const executor of covering) {
    for (const line of await executor.report(plan)) io.out(`${executor.name}: ${line}`)
  }
  if (plan.scope === 'access' || plan.scope === 'organization') {
    await writeExports(input, covering)
  }
  return 0
}
