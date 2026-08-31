// ARC-03-T15 — the content-free process boot report.
//
// A deployed cell-us process should be able to answer "did exactly one
// Application Container boot here, and what did it register?" from a log line,
// without exposing any tenant, review, guest or credential value. That is what
// this schema is: NAMES and COUNTS only.
//
// The same shape is emitted by the local process fixtures and (once the
// deployed evidence step runs) by the real entry points, so the deployed check
// is a log query against a schema already validated in this repository.
// Nothing here fabricates external evidence: a fixture that cannot boot exits
// non-zero and emits no report.

import { z } from 'zod/v4'

const BOOT_REPORT_MARKER = '__REPKEY_BOOT_REPORT__ '

const nameList = z.array(z.string()).readonly()

const bootReportSchema = z
  .object({
    /** Which deployable this process is. */
    deployable: z.enum(['web', 'worker', 'operator', 'sidecar', 'simulation']),
    /** Complete Application Containers (or sidecar composition units) built. */
    containerBoots: z.number().int().min(0),
    /** Registered job handler names. */
    jobNames: nameList,
    /** Registered durable outbox consumer names. */
    consumerNames: nameList,
    /** Reconciled job scheduler identifiers. */
    schedulerIds: nameList,
    /** Process-level policy installations performed by this process. */
    policyBindings: nameList,
    /** Named long-lived handles the composition holds (never values). */
    openHandleNames: nameList,
  })
  .strict()

export type BootReport = z.infer<typeof bootReportSchema>

/**
 * Sort and de-duplicate every list so two runs of the same deployable produce
 * byte-identical reports. Registration ORDER is an implementation detail, and a
 * consumer registered for three event types is still one consumer: the SET of
 * names is the fact this report states.
 */
function normalizeBootReport(report: BootReport): BootReport {
  const sorted = (values: readonly string[]): readonly string[] =>
    [...new Set(values)].sort()
  return Object.freeze({
    deployable: report.deployable,
    containerBoots: report.containerBoots,
    jobNames: sorted(report.jobNames),
    consumerNames: sorted(report.consumerNames),
    schedulerIds: sorted(report.schedulerIds),
    policyBindings: sorted(report.policyBindings),
    openHandleNames: sorted(report.openHandleNames),
  })
}

/** Emit one marker-prefixed JSON line on stdout. */
export function emitBootReport(report: BootReport): void {
  const validated = bootReportSchema.parse(normalizeBootReport(report))
  process.stdout.write(`${BOOT_REPORT_MARKER}${JSON.stringify(validated)}\n`)
}

/**
 * Read the single boot report from a process's stdout. Fails loudly on zero or
 * more than one — "how many containers booted" is the question being answered,
 * so a missing or duplicated report is a result, not a parsing inconvenience.
 */
export function parseBootReport(stdout: string): BootReport {
  const lines = stdout
    .split('\n')
    .filter((line) => line.startsWith(BOOT_REPORT_MARKER))
    .map((line) => line.slice(BOOT_REPORT_MARKER.length))
  if (lines.length !== 1) {
    throw new Error(`expected exactly one boot report, found ${lines.length}`)
  }
  return bootReportSchema.parse(JSON.parse(lines[0]!))
}
