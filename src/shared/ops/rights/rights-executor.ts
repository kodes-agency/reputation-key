// Per-context executors for the manual rights request command. Each executor
// owns one context's data: it reports what it holds for a tenant, lists the
// export files it contributes, and applies the erasure after command preflight.
// The command contract decides whether a request may apply at all; this module
// only runs the executors that cover the requested scope.

import type { BackupErasureLedgerContext } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { OperatorIO } from '../operator-command'
import { rightsAuditEvent, type RightsAudit } from './rights-audit'
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
  /**
   * Every table the executor reports on and changes, per scope it erases,
   * including rows that go by cascade. The rights coverage gate joins these
   * to the data-fate authority.
   */
  tables: Readonly<Partial<Record<RightsRequestScope, ReadonlyArray<string>>>>
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
  /** Why the request's Organization or Property does not exist, or null. */
  subjectRefusal?: (plan: RightsRequestPlan) => Promise<string | null>
  writeExportFile: (path: string, bytes: Uint8Array) => Promise<void>
  /** Records each apply run, whatever its outcome. */
  audit?: RightsAudit
}>

/** Whether any executor covers the plan's scope. */
function rightsExecutorsFor(
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

async function subjectRefusalOf(input: RunRightsExecutorsInput): Promise<string | null> {
  try {
    return (await input.subjectRefusal?.(input.plan)) ?? null
  } catch (error) {
    return `subject check: ${errorMessage(error)}`
  }
}

async function applyJournaled(
  input: RunRightsExecutorsInput,
  executor: RightsExecutor,
  planContexts: ReadonlyArray<BackupErasureLedgerContext>,
): Promise<RightsApplyOutcome> {
  try {
    return await input.journal.run(
      input.plan,
      executor.journalContexts,
      planContexts,
      () => executor.apply(input.plan),
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
  const refusal =
    (await subjectRefusalOf(input)) ?? (await firstPreflightRefusal(input, covering))
  if (refusal) {
    io.err(`rights-request: ${refusal}; nothing was changed`)
    return 1
  }
  const planContexts = covering.flatMap((executor) => executor.journalContexts)
  const applied: string[] = []
  let failure: string | null = null
  for (const executor of covering) {
    const outcome = await applyJournaled(input, executor, planContexts)
    if (!outcome.ok) {
      const done = applied.length > 0 ? applied.join(', ') : 'none'
      failure = `rights-request: ${executor.name}: ${outcome.error}; executors applied before it: ${done}`
      break
    }
    applied.push(executor.name)
    for (const line of outcome.lines) io.out(`${executor.name}: ${line}`)
    io.out(
      `audit: ${executor.name} applied scope=${plan.scope} org=${plan.organizationId}` +
        `${plan.propertyId ? ` property=${plan.propertyId}` : ''}` +
        ` journal=${input.journal.entryIds(plan, executor.journalContexts).join(',')}`,
    )
  }
  if (failure) io.err(failure)
  const recorded = await recordRun(input, covering, failure === null)
  return failure === null && recorded ? 0 : 1
}

/** Writes the run's audit event; false when it could not be written. */
async function recordRun(
  input: RunRightsExecutorsInput,
  covering: ReadonlyArray<RightsExecutor>,
  succeeded: boolean,
): Promise<boolean> {
  const { audit, plan, io } = input
  if (!audit) return true
  const erases = covering.some((executor) => executor.journalContexts.length > 0)
  try {
    await audit.write(
      rightsAuditEvent(audit, plan, {
        erases,
        outcome: succeeded ? 'succeeded' : 'failed',
      }),
    )
    return true
  } catch (error) {
    io.err(
      `rights-request: the audit event could not be written (${errorMessage(error)}); record this run by hand`,
    )
    return false
  }
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
