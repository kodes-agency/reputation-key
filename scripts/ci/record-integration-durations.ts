// Rewrites integration-durations.json, the per-file test times the integration
// shards are balanced by (integration-shards.ts), from a green CI run's log:
//
//   gh run view <run id> --log | pnpm exec tsx scripts/ci/record-integration-durations.ts
//
// It reads Vitest's per-file lines, "✓ integration <file> (N tests) 1234ms",
// from every integration shard in the log. Re-record when a shard runs a
// minute or more longer than the others; a stale record only costs balance.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { isEntryPoint } from './entry-point'

export const DURATIONS_PATH = 'scripts/ci/integration-durations.json'

const FILE_LINE =
  /[✓×❯↓]\s+integration\s+(\S+\.test\.ts)\s+\(\d+ tests?[^)]*\)\s*(\d+(?:\.\d+)?)(ms|s)\b/

/** Each integration file's test time in milliseconds, rounded to 100 ms. */
export function parseIntegrationDurations(log: string): Record<string, number> {
  const durations = new Map<string, number>()
  for (const line of stripVTControlCharacters(log).split('\n')) {
    const match = FILE_LINE.exec(line)
    if (!match) continue
    const [, file, amount, unit] = match
    const ms = Number(amount) * (unit === 's' ? 1_000 : 1)
    durations.set(file!, Math.round(ms / 100) * 100)
  }
  return Object.fromEntries(
    [...durations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
}

function main(): number {
  const durations = parseIntegrationDurations(readFileSync(0, 'utf8'))
  const files = Object.keys(durations).length
  if (files === 0) {
    console.error(
      'No integration file lines in the log: pass a CI run log with the integration shards.',
    )
    return 1
  }
  writeFileSync(resolve(DURATIONS_PATH), `${JSON.stringify(durations, null, 2)}\n`)
  console.log(`[integration-durations] recorded ${files} files in ${DURATIONS_PATH}`)
  return 0
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = main()
}
