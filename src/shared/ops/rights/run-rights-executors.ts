// Runs the composed executors for one rights plan. The script supplies the
// executors and the file writer; the decisions live here so tests cover them.

import { join } from 'node:path'
import type { RightsExecutor } from './rights-executor'
import type { RightsRequestPlan } from './rights-request-command'

export type RightsFileWriter = (path: string, bytes: Uint8Array) => Promise<void>

/** Write every executor's export under `<out>/<organization>/`. Reads only. */
export async function writeRightsExport(
  executors: readonly RightsExecutor[],
  plan: RightsRequestPlan,
  write: RightsFileWriter,
): Promise<readonly string[]> {
  if (!plan.outDir) return []
  const lines: string[] = []
  for (const executor of executors) {
    const files = await executor.access({ organizationId: plan.organizationId })
    for (const file of files) {
      await write(join(plan.outDir, plan.organizationId, file.path), file.bytes)
    }
    lines.push(`${executor.context}: wrote ${files.length} export file(s)`)
  }
  return lines
}

/**
 * Purge the Organization through every executor and print the erasure record:
 * context, evidence line and rows per table, never content. Apply is already
 * refused in production by the plan.
 */
export async function purgeRightsOrganization(
  executors: readonly RightsExecutor[],
  plan: RightsRequestPlan,
  occurredAt: Date,
): Promise<readonly string[]> {
  if (plan.scope !== 'organization') return []
  const lines: string[] = []
  for (const executor of executors) {
    const outcome = await executor.purgeOrganization({
      organizationId: plan.organizationId,
      occurredAt,
    })
    lines.push(
      `erasure record ${executor.context} org=${plan.organizationId} ${outcome.evidenceRef}`,
      ...Object.entries(outcome.deleted).map(([table, rows]) => `  ${table} ${rows}`),
    )
  }
  return lines
}
