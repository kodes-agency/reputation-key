// Per-context executors for the manual rights request command. Each executor
// owns one context's data: it reports what it holds for a tenant, lists the
// export files it contributes, and (outside production) applies the erasure.
// The command contract decides whether a request may apply at all; this module
// only runs the executors that cover the requested scope.

import type { OperatorIO } from '../operator-command'
import type { RightsRequestPlan, RightsRequestScope } from './rights-request-command'

export type RightsExportFile = Readonly<{
  /** Relative, slash-separated path inside the export directory. */
  path: string
  bytes: Uint8Array
}>

export type RightsApplyOutcome =
  | Readonly<{ ok: true; lines: ReadonlyArray<string> }>
  | Readonly<{ ok: false; error: string }>

export type RightsExecutor = Readonly<{
  name: string
  scopes: ReadonlyArray<RightsRequestScope>
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

/**
 * Report and export in report mode; apply in apply mode. A refusal from one
 * executor stops the run before the next one starts, so a closure never
 * continues past a context that is not ready.
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
  if (plan.mode === 'apply') {
    for (const executor of covering) {
      const outcome = await executor.apply(plan)
      if (!outcome.ok) {
        io.err(`rights-request: ${executor.name}: ${outcome.error}; nothing was changed`)
        return 1
      }
      for (const line of outcome.lines) io.out(`${executor.name}: ${line}`)
    }
    return 0
  }
  for (const executor of covering) {
    for (const line of await executor.report(plan)) io.out(`${executor.name}: ${line}`)
  }
  if (plan.scope === 'access' || plan.scope === 'organization') {
    await writeExports(input, covering)
  }
  return 0
}
