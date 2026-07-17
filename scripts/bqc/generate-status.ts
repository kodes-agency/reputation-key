// Generate STATUS.md from the live BQC status manifest.
// Usage: pnpm bqc:generate-status

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateBqcStatusManifest } from '../../src/shared/bqc/status-schema'
import { generateBqcStatusMarkdown } from '../../src/shared/bqc/generate-status-md'

const ROOT = resolve(
  process.cwd(),
  'docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/completion-program-2026-07',
)
const MANIFEST = resolve(ROOT, 'status/bqc-status.json')
const OUTPUT = resolve(ROOT, 'STATUS.md')

function main(): void {
  const raw = JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown
  const result = validateBqcStatusManifest(raw)
  if (!result.ok) {
    console.error('Cannot generate STATUS.md — manifest invalid:')
    for (const error of result.errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  const md = generateBqcStatusMarkdown(result.manifest)
  writeFileSync(OUTPUT, md, 'utf8')
  console.log(`Wrote ${OUTPUT}`)
}

main()
