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
// Closure re-measured 2026-09-15 after the property setup work (settings hub,
// setup wizard, AI admission lanes, reply publication fix): 334,563 B (99 js +
// 1 css), and the budget was re-based to 344,600 B. Raw first-paint code grew
// only ~12 KB, nearly all route configuration. The rest was chunk count: every
// Router and Query internal shared by first paint and a lazy route became its
// own shared chunk, the new routes multiplied those (70 → 99 closure chunks),
// and each chunk is gzipped alone.
//
// Re-measured 2026-09-16 on a fresh production build with the `vendor-tanstack`
// group in vite.config.ts: 326,719 B (75 js + 1 css), so the closure budget is
// back to 329,105 B (326,719 + 3% would exceed it). The entry chunk measured
// 33,474 B and vendor-charts 93,034 B; their budgets are unchanged. The group
// puts every first-paint module of Router, Query, Store, Start's client core,
// seroval, cookie-es and use-sync-external-store into one 52,004 B chunk. It
// replaces 20 closure chunks (createServerFn, link, Match, useStore, …) and
// takes 22,168 B out of the entry chunk. app-server-fns now merges subgroups
// under 16 KiB, which folds its seven closure chunks into one. A rebuild of
// 6de210a6d reproduced the 2026-09-15 numbers exactly; compared with it through
// source maps, the closure holds the same source modules. Only Vite's preload
// helper moved, from the old lazyRouteComponent chunk into a chunk of its own.
//
// Cycles: the first `vendor-tanstack` attempt (Router and Query only) imported
// index (@tanstack/store) and createServerFn (seroval, cookie-es), which both
// import it back. One side of an ESM cycle evaluates first and the bundler
// emits `var`, so server-fn bindings read `undefined` in the browser: every e2e
// shard failed while build and typecheck passed. The current group imports only
// vendor-react and the Rolldown runtime. This was checked on the built assets:
// the static import/export edges of all 205 chunks, read with rolldown's
// parseAst and with STATIC_SPECIFIER below (the two edge sets were identical),
// then strongly connected components over those edges, then a node:vm link of
// every chunk. The only cycle is the lazy vendor-charts ↔ chart, chart-frame,
// ratings, portal-detail-page cycle that the 2026-09-15 build already had.
// Rebuilt under the same check, the reverted attempt shows a 21-chunk cycle
// through index. This script now runs that check itself: any static import cycle
// that includes a chunk of the initial closure fails the gate, so a chunk group
// change or a TanStack upgrade cannot reopen it silently. A cycle confined to
// lazy chunks (the vendor-charts one) is reported by neither gate.
//
// The closure budget is a RATCHET above the measured floor, not an aspirational
// number. The measured target is 319,519 B (312 KiB), replacing the unmeasured
// 204,800 B target. Fully deferring the 29,257 B Sentry chunk would move the
// floor to about 290,000 B; it remains in this closure because src/start.ts
// statically imports the browser middleware even though instrument.client.ts
// now retains its dynamic import.
//
// Re-measured 2026-09-18 after src/styles.css stopped scanning the folders
// .dockerignore keeps out of the image (docs, review, e2e, .storybook and the
// agent folders): 329,096 B → 328,607 B (79 js + 1 css). Only the stylesheet
// changed, and it now equals, byte for byte, the one built from a tree filtered
// through .dockerignore — so this gate measures the CSS production ships. The
// 489 B were rules for class names written in plan documents and e2e selectors.
// The budget itself is unchanged.
//
// Re-measured 2026-09-22 after the bell's popover body became a lazy chunk
// (notification-panel.tsx), on a fresh build of the same tree with and without
// the split: 327,948 B (77 js + 1 css) → 317,727 B (70 js + 1 css), 10,221 B
// less. The bell is imported by the public Header as well as the app shell, so
// every page, /login included, had shipped the rows, row menu, templates,
// filter tabs and star rating. The entry chunk grew 35,590 → 40,641 B as the
// chunk graph regrouped (still far under its budget). The budget is unchanged:
// the difference is headroom, not a new floor.
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
// When a cycle fails it: the chunk group that moved a module away from the
// modules it imports is the cause — keep a group closed under static imports.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = join(ROOT, '.output/public/assets')

const BUDGETS = {
  mainEntryGzip: 70_100, // measured 68,725 + 2%
  initialClosureGzip: 329_105, // 319,519 + 3% (2026-09-08); measured 326,719 on 2026-09-16
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

const edges = new Map(jsFiles.map((file) => [file, staticDependencies(file)]))

const entry = entryFiles[0]
const closure = new Set([entry])
const queue = [entry]
while (queue.length > 0) {
  for (const dependency of edges.get(queue.pop())) {
    if (closure.has(dependency)) continue
    closure.add(dependency)
    queue.push(dependency)
  }
}

/** Tarjan's strongly connected components; each one of 2+ chunks is a cycle. */
function importCycles(graph) {
  let index = 0
  const stack = []
  const onStack = new Set()
  const indexOf = new Map()
  const lowLink = new Map()
  const cycles = []
  const visit = (file) => {
    indexOf.set(file, index)
    lowLink.set(file, index)
    index += 1
    stack.push(file)
    onStack.add(file)
    for (const dependency of graph.get(file)) {
      if (!indexOf.has(dependency)) {
        visit(dependency)
        lowLink.set(file, Math.min(lowLink.get(file), lowLink.get(dependency)))
      } else if (onStack.has(dependency)) {
        lowLink.set(file, Math.min(lowLink.get(file), indexOf.get(dependency)))
      }
    }
    if (lowLink.get(file) !== indexOf.get(file)) return
    const component = []
    let member
    do {
      member = stack.pop()
      onStack.delete(member)
      component.push(member)
    } while (member !== file)
    if (component.length > 1) cycles.push(component.sort())
  }
  for (const file of graph.keys()) if (!indexOf.has(file)) visit(file)
  return cycles
}

// One side of an ESM import cycle evaluates while the other is uninitialized,
// and the bundler emits `var`, so a read across the cycle yields `undefined`
// instead of throwing. Build, typecheck and the size budgets all pass; the
// browser does not (see "Cycles" above). Only cycles that reach first paint
// are gated here.
const firstPaintCycles = importCycles(edges).filter((cycle) =>
  cycle.some((file) => closure.has(file)),
)

const failures = []
const fmt = (n) => `${n.toLocaleString('en-US')} B`
const over = (what, actual, budget) =>
  failures.push(`${what}: ${fmt(actual)} exceeds budget ${fmt(budget)}`)

for (const cycle of firstPaintCycles) {
  failures.push(
    `static import cycle through the initial closure (${cycle.length} chunks): ${cycle.join(' ↔ ')}`,
  )
}

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

console.log(
  '[bundle-budget] OK — all chunks within budget, no static import cycle through the initial closure:',
)
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
