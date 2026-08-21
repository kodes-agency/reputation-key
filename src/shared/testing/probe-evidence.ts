// Local-stack fault harness — evidence selection for fault-operation.ts probes.
//
// The probe writes its verdict with `process.stdout.write`, but it also loads
// application code, and the application logger writes to the same stdout.
// pino's default destination is a buffered SonicBoom that is flushed by an
// exit handler (pino/lib/tools.js buildSafeSonicBoom), so a span error record
// is NOT ordered against the probe's own write: it can land after it. Taking
// the last line of stdout as the verdict therefore read a log record as
// evidence, which left `observed` undefined — silently satisfying
// `unavailable` (`observed !== 'success'`) while failing `failClosed`
// (`observed === 'failed-closed'`).
//
// Select the probe's own envelope instead, identified by the dependency and
// phase it was invoked with.

export type ProbeEvidence = Readonly<Record<string, unknown>> &
  Readonly<{ dependency: string; phase: string; observed: string }>

/**
 * The last line of `output` that is the probe's verdict envelope for
 * `dependency`/`phase`, or null when the probe produced none.
 */
export function selectProbeEvidence(
  output: string,
  dependency: string,
  phase: string,
): ProbeEvidence | null {
  for (const line of output.trim().split('\n').reverse()) {
    const candidate = line.trim()
    if (!candidate.startsWith('{')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const record = parsed as Record<string, unknown>
    if (
      record.dependency === dependency &&
      record.phase === phase &&
      typeof record.observed === 'string'
    ) {
      return record as ProbeEvidence
    }
  }
  return null
}
