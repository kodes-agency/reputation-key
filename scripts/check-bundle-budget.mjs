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
// Budgets — measured 2026-09-08 against a fresh local build after WP5.1:
//
//   budget                              actual (gzip)   budget (gzip)
//   main entry chunk (index-*.js)            68,725 B       70,100 B (+2.0%)
//   initial static closure (JS + all CSS)   319,519 B      329,105 B (+3.0%)
//   largest lazy chunk (vendor-charts)       93,053 B      128,000 B (125 KiB)
//
// The closure budget is a RATCHET above the measured floor, not an aspirational
// number. The measured target is 319,519 B (312 KiB), replacing the unmeasured
// 204,800 B target. Fully deferring the 29,257 B Sentry chunk would move the
// floor to about 290,000 B; it remains in this closure because src/start.ts
// statically imports the browser middleware even though instrument.client.ts
// now retains its dynamic import.
//
// Two mechanisms had pinned lazy feature code into first paint: route config and
// loader value-imports from component barrels, and one broad `app-shared` group
// that welded `src/contexts/*/server/*` stubs to `src/components/*`. Routes now
// import their small leaves, server stubs have their own group, and components
// use Rolldown's default route-aware splitting. A broad components group would
// rejoin eager validation leaves to the lazy feature trees.
//
// When this fails: resolve the new static importer and cut that source edge. Do
// NOT raise the budget without recording a fresh production measurement here.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = join(ROOT, '.output/public/assets')

const BUDGETS = {
  mainEntryGzip: 70_100, // measured 68,725 + 2%
  initialClosureGzip: 329_105, // measured 319,519 + 3%
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
