#!/usr/bin/env node
// Client bundle budget gate.
//
// Enforces the client performance budgets on the production build output
// (.output/public/assets). Runs after `pnpm build` (CI: ci.yml "Bundle budget"
// step; local: `pnpm check:bundles`). Exits 1 naming every offending chunk.
//
// What "initial closure" means: the set of chunks the browser MUST download
// before the app can render, computed by walking STATIC import specifiers from
// the single entry chunk. Dynamic `import("./x.js")` edges are deliberately not
// followed — those are the route/lazy splits. The previous model called every
// non-entry chunk "lazy", which was false: a statically imported chunk is part
// of the initial payload no matter how the bundler names it.
//
// Budgets — measured 2026-09-05 against a fresh local build:
//
//   budget                              actual (gzip)   budget (gzip)
//   main entry chunk (index-*.js)            37,896 B      133,120 B (130 KiB)
//   initial static closure (JS + all CSS)   682,203 B      689,152 B (673 KiB)
//   any single chunk outside the closure     14,412 B      128,000 B (125 KiB)
//
// The closure budget is a RATCHET at the measured actual, not a target. The
// target is 200 KiB (204,800 B). The gap is not chunk grouping — TanStack Start
// already route-splits (43 output chunks carry `tsr-split`). It is 53 static
// edges where a route's NON-component code (loader, `validateSearch`,
// `beforeLoad`, and the sibling `-*.ts` / `-*-fns.ts` modules) imports a
// component barrel at module scope, which pins that component chunk — and its
// npm dependencies — into the first paint. Fix pattern: import the leaf module
// instead (see `inbox-search-schema.ts`, extracted from `inbox-page-v2.tsx`).
// The remaining clusters are named in LEAN_TRANSFORMATION_PLAN.md WP0.2 step 4.
//
// When this fails: cut the offending route -> component edge the failure list
// names. Do NOT raise the budget without recording the new measurement here.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = join(ROOT, '.output/public/assets')

const BUDGETS = {
  mainEntryGzip: 130 * 1024, // 133,120
  initialClosureGzip: 673 * 1024, // 689,152 — ratchet at the 2026-09-05 actual; target 204,800
  lazyChunkGzip: 125 * 1024, // 128,000 (chunks outside the closure)
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

// Static specifiers only. `from"./x.js"` / `from'./x.js'` covers minified
// `import{a}from"./x.js"` and `export{a}from"./x.js"`; `import"./x.js"` covers
// side-effect-only imports. A dynamic `import("./x.js")` never matches because
// the parenthesis sits between the keyword and the quote.
const STATIC_SPECIFIER = /(?:\bfrom|\bimport)\s*["']([^"']+)["']/g

function staticDependencies(file) {
  const source = readFileSync(join(ASSETS_DIR, file), 'utf8')
  const dependencies = new Set()
  for (const [, specifier] of source.matchAll(STATIC_SPECIFIER)) {
    if (!specifier.endsWith('.js')) continue
    const name = basename(specifier)
    if (name !== file && jsFiles.includes(name)) dependencies.add(name)
  }
  return dependencies
}

const entry = entryFiles[0]
const closure = new Set([entry])
const queue = [entry]
while (queue.length > 0) {
  for (const dependency of staticDependencies(queue.pop())) {
    if (closure.has(dependency)) continue
    closure.add(dependency)
    queue.push(dependency)
  }
}

const failures = []
const fmt = (n) => `${n.toLocaleString('en-US')} B`
const over = (what, actual, budget) =>
  failures.push(`${what}: ${fmt(actual)} exceeds budget ${fmt(budget)}`)

const entrySize = sizes.get(entry)
if (entrySize > BUDGETS.mainEntryGzip) {
  over(`main entry chunk ${entry}`, entrySize, BUDGETS.mainEntryGzip)
}

const closureMembers = [...closure, ...cssFiles]
  .map((f) => [f, sizes.get(f)])
  .sort((a, b) => b[1] - a[1])
const initialClosure = closureMembers.reduce((sum, [, size]) => sum + size, 0)

if (initialClosure > BUDGETS.initialClosureGzip) {
  over(
    `initial static closure (${closure.size} js + ${cssFiles.length} css)`,
    initialClosure,
    BUDGETS.initialClosureGzip,
  )
  for (const [file, size] of closureMembers) {
    failures.push(`  closure member ${file}: ${fmt(size)}`)
  }
}

for (const f of jsFiles) {
  if (closure.has(f)) continue
  if (sizes.get(f) > BUDGETS.lazyChunkGzip) {
    over(`lazy chunk ${f}`, sizes.get(f), BUDGETS.lazyChunkGzip)
  }
}

if (failures.length > 0) {
  console.error(`[bundle-budget] FAILED — ${failures.length} line(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}

console.log('[bundle-budget] OK — all chunks within budget:')
console.log(`  entry ${entry}: ${fmt(entrySize)} / ${fmt(BUDGETS.mainEntryGzip)} gzip`)
console.log(
  `  initial closure (${closure.size} js + ${cssFiles.length} css): ${fmt(initialClosure)} / ${fmt(BUDGETS.initialClosureGzip)} gzip`,
)
for (const [file, size] of closureMembers) {
  console.log(`    ${file}: ${fmt(size)}`)
}
const largestLazy = [...sizes.entries()]
  .filter(([f]) => f.endsWith('.js') && !closure.has(f))
  .sort((a, b) => b[1] - a[1])[0]
if (largestLazy) {
  console.log(
    `  largest chunk outside the closure ${largestLazy[0]}: ${fmt(largestLazy[1])} / ${fmt(BUDGETS.lazyChunkGzip)} gzip`,
  )
}
