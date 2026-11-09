// Lowers the ceilings in file-length.baseline.json to the sizes the files have
// now, counted the way the `max-lines` rule counts them (blank and comment
// lines are free). A ceiling never rises; an entry whose file is back under
// the common limit, or gone, is dropped. Run it through
// `pnpm file-length:tighten` after shrinking a file and commit the result.

import { ESLint } from 'eslint'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isEntryPoint } from './entry-point'
import { parseBaseline, serializeBaseline, type RatchetCounts } from './ratchet-baseline'

export const COMMON_LIMIT = 800
const BASELINE_PATH = resolve('scripts/ci/file-length.baseline.json')
const COUNT_PATTERN = /too many lines \((\d+)\)/u

/** Each ceiling lowered to the file's current count; never raised. */
export function tightenCeilings(
  baseline: RatchetCounts,
  current: Readonly<Record<string, number | undefined>>,
  limit: number = COMMON_LIMIT,
): RatchetCounts {
  const next: Record<string, number> = {}
  for (const [file, ceiling] of Object.entries(baseline)) {
    const count = current[file]
    if (count === undefined || count <= limit) continue
    next[file] = Math.min(ceiling, count)
  }
  return next
}

async function countLines(files: readonly string[]): Promise<Record<string, number>> {
  const eslint = new ESLint({
    allowInlineConfig: false,
    overrideConfig: {
      rules: {
        'max-lines': ['error', { max: 0, skipBlankLines: true, skipComments: true }],
      },
    },
  })
  const counts: Record<string, number> = {}
  for (const file of files) {
    const [result] = await eslint.lintFiles([file])
    const message = result?.messages.find((entry) => entry.ruleId === 'max-lines')
    const count = message ? Number(COUNT_PATTERN.exec(message.message)?.[1]) : 0
    if (
      !result ||
      result.fatalErrorCount > 0 ||
      result.warningCount > 0 ||
      Number.isNaN(count)
    ) {
      throw new Error(`cannot count the lines of ${file}`)
    }
    counts[file] = count
  }
  return counts
}

async function main() {
  const baseline = parseBaseline(readFileSync(BASELINE_PATH, 'utf8'))
  const files = Object.keys(baseline).filter((file) => existsSync(resolve(file)))
  const next = tightenCeilings(baseline, await countLines(files))
  writeFileSync(BASELINE_PATH, serializeBaseline(next), 'utf8')
  process.stdout.write('[file-length] baseline tightened; no ceiling raised\n')
  for (const file of Object.keys(baseline)) {
    const after = next[file]
    if (after !== baseline[file]) {
      process.stdout.write(`  ${file}: ${baseline[file]} → ${after ?? 'removed'}\n`)
    }
  }
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
