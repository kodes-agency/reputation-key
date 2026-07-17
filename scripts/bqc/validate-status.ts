// CI entry: validate BQC status manifest against the shared schema.
// Usage: pnpm bqc:validate-status
// Exit 1 on any schema or invariant failure.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateBqcStatusManifest } from '../../src/shared/bqc/status-schema'

const DEFAULT_PATH = resolve(
  process.cwd(),
  'docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/completion-program-2026-07/status/bqc-status.json',
)

function main(): void {
  const path = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_PATH
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (err) {
    console.error(`Failed to read/parse ${path}:`, err)
    process.exit(1)
  }

  const result = validateBqcStatusManifest(raw)
  if (!result.ok) {
    console.error(`BQC status invalid (${path}):`)
    for (const error of result.errors) {
      console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  console.log(
    `BQC status OK: ${result.manifest.entries.length} entries (updated ${result.manifest.updatedAt})`,
  )
}

main()
