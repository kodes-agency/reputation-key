// Shared core of the per-file ratchet gates (check-file-length.ts,
// check-unchecked-indexed-access.ts).
//
// A baseline maps a repository path to the count that file may still carry; a
// path that is absent may carry none. A gate fails when any file's count rises
// above its entry, and passes when counts fall — printing the entries to lower
// so the improvement is locked in. The baselines are generated, never edited
// by hand: `--write-baseline` rewrites one from the current tree.

import { readFileSync, writeFileSync } from 'node:fs'

export type RatchetCounts = Readonly<Record<string, number>>

export type RatchetChange = Readonly<{
  file: string
  baseline: number
  current: number
}>

export type RatchetComparison = Readonly<{
  /** Counts above their entry (an absent entry is zero). These fail the gate. */
  regressions: readonly RatchetChange[]
  /** Counts below their entry. The gate passes; the entry should come down. */
  improvements: readonly RatchetChange[]
}>

export function compareWithBaseline(
  baseline: RatchetCounts,
  current: RatchetCounts,
): RatchetComparison {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()
  const changes = files.map((file) => ({
    file,
    baseline: baseline[file] ?? 0,
    current: current[file] ?? 0,
  }))
  return {
    regressions: changes.filter((change) => change.current > change.baseline),
    improvements: changes.filter((change) => change.current < change.baseline),
  }
}

/** Parse a committed baseline, accepting only path → positive integer. */
export function parseBaseline(json: string): RatchetCounts {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('a ratchet baseline must be a JSON object of path → count')
  }
  for (const [file, count] of Object.entries(parsed)) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
      throw new TypeError(
        `baseline entry ${file} must be a positive integer, got ${JSON.stringify(count)}`,
      )
    }
  }
  return parsed as RatchetCounts
}

/** Baseline bytes: non-zero entries sorted by path, so a rewrite diffs cleanly. */
export function serializeBaseline(counts: RatchetCounts): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
}

export function formatChanges(changes: readonly RatchetChange[]): string {
  return changes
    .map(({ file, baseline, current }) => `  ${file}: ${baseline} → ${current}`)
    .join('\n')
}

export type RatchetGate = Readonly<{
  /** Log prefix, e.g. `file-length`. */
  name: string
  /** Absolute path of the committed baseline. */
  baselinePath: string
  /** The command that rewrites the baseline, quoted in every hint. */
  writeCommand: string
  /** What rose and how to fix it, printed under the failure line. */
  explainRegressions: (regressions: readonly RatchetChange[]) => string
  /** Tail of the success line, e.g. `12 files over the limit, none grew`. */
  summary: string
}>

/** Compare, report and return the process exit code (or rewrite the baseline). */
export function runRatchetGate(
  gate: RatchetGate,
  current: RatchetCounts,
  args: readonly string[],
): number {
  if (args.includes('--write-baseline')) {
    writeFileSync(gate.baselinePath, serializeBaseline(current), 'utf8')
    process.stdout.write(
      `[${gate.name}] baseline rewritten: ${Object.keys(current).length} files. Review the diff before committing it.\n`,
    )
    return 0
  }

  let baseline: RatchetCounts
  try {
    baseline = parseBaseline(readFileSync(gate.baselinePath, 'utf8'))
  } catch (error) {
    process.stderr.write(
      `[${gate.name}] cannot read the baseline ${gate.baselinePath}: ${error instanceof Error ? error.message : String(error)}\n` +
        `Create it with: ${gate.writeCommand}\n`,
    )
    return 1
  }

  const { regressions, improvements } = compareWithBaseline(baseline, current)
  if (regressions.length > 0) {
    process.stderr.write(
      `[${gate.name}] FAILED — ${regressions.length} file(s) above the baseline:\n` +
        `${gate.explainRegressions(regressions)}\n`,
    )
    return 1
  }
  if (improvements.length > 0) {
    process.stdout.write(
      `[${gate.name}] ${improvements.length} file(s) fell below the baseline. Lock the gain in: run \`${gate.writeCommand}\` and commit the result.\n` +
        `${formatChanges(improvements)}\n`,
    )
  }
  process.stdout.write(`[${gate.name}] OK — ${gate.summary}\n`)
  return 0
}
