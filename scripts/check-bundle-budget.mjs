#!/usr/bin/env node
// BQC-6.8 — client bundle budget gate.
//
// Enforces the client performance budgets on the production build output
// (.output/public/assets). Runs after `pnpm build` (CI: ci.yml "Web build"
// step; local: `pnpm check:bundles`). Exits 1 naming every offending chunk.
//
// Budgets — calibrated 2026-07-29 against a fresh local build with ~10-16%
// headroom over the measured actuals:
//
//   budget                         actual (gzip)   budget (gzip)   headroom
//   main entry chunk (index-*.js)      118,132 B       133,120 B (130 KiB)  11.3%
//   initial payload (entry + CSS)      137,746 B       158,720 B (155 KiB)  13.2%
//   any single lazy chunk              110,806 B       128,000 B (125 KiB)  13.4%
//     (largest today: vendor-charts — recharts, route-split)
//
// When this fails: shrink the chunk (dynamic import / route split / dependency
// diet) — do NOT raise the budget without recording the new measurement date
// and actuals in this header.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = join(ROOT, '.output/public/assets')

const BUDGETS = {
  mainEntryGzip: 130 * 1024, // 133,120
  initialPayloadGzip: 155 * 1024, // 158,720 (entry + global CSS)
  lazyChunkGzip: 125 * 1024, // 128,000
}

if (!existsSync(ASSETS_DIR)) {
  console.error(
    `[bundle-budget] ${ASSETS_DIR} not found — run \`pnpm build\` first (the budgets measure the production output).`,
  )
  process.exit(1)
}

const files = readdirSync(ASSETS_DIR)
const jsFiles = files.filter((f) => f.endsWith('.js'))
const cssFiles = files.filter((f) => f.endsWith('.css'))
const entryFiles = jsFiles.filter((f) => /^index-[^/]*\.js$/.test(f))

if (entryFiles.length !== 1) {
  console.error(
    `[bundle-budget] expected exactly 1 entry chunk (index-*.js), found ${entryFiles.length}: ${entryFiles.join(', ') || '(none)'}. ` +
      'The build shape changed — recalibrate the entry detection in this script.',
  )
  process.exit(1)
}

const gzipSize = (file) => gzipSync(readFileSync(join(ASSETS_DIR, file))).length

const sizes = new Map()
for (const f of [...jsFiles, ...cssFiles]) sizes.set(f, gzipSize(f))

const failures = []
const fmt = (n) => `${n.toLocaleString('en-US')} B`
const over = (what, actual, budget) =>
  failures.push(`${what}: ${fmt(actual)} exceeds budget ${fmt(budget)}`)

const entry = entryFiles[0]
const entrySize = sizes.get(entry)
if (entrySize > BUDGETS.mainEntryGzip) {
  over(`main entry chunk ${entry}`, entrySize, BUDGETS.mainEntryGzip)
}

const initialPayload = entrySize + cssFiles.reduce((sum, f) => sum + sizes.get(f), 0)
if (initialPayload > BUDGETS.initialPayloadGzip) {
  over(
    `initial payload (${entry} + ${cssFiles.length} css)`,
    initialPayload,
    BUDGETS.initialPayloadGzip,
  )
}

for (const f of jsFiles) {
  if (f === entry) continue
  if (sizes.get(f) > BUDGETS.lazyChunkGzip) {
    over(`lazy chunk ${f}`, sizes.get(f), BUDGETS.lazyChunkGzip)
  }
}

if (failures.length > 0) {
  console.error(`[bundle-budget] FAILED — ${failures.length} budget violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}

console.log('[bundle-budget] OK — all chunks within budget:')
console.log(`  entry ${entry}: ${fmt(entrySize)} / ${fmt(BUDGETS.mainEntryGzip)} gzip`)
console.log(
  `  initial payload: ${fmt(initialPayload)} / ${fmt(BUDGETS.initialPayloadGzip)} gzip`,
)
const largestLazy = [...sizes.entries()]
  .filter(([f]) => f !== entry && f.endsWith('.js'))
  .sort((a, b) => b[1] - a[1])[0]
console.log(
  `  largest lazy chunk ${largestLazy[0]}: ${fmt(largestLazy[1])} / ${fmt(BUDGETS.lazyChunkGzip)} gzip`,
)
