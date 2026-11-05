#!/usr/bin/env node
// Client bundle budget gate: gzip sizes and static import cycles in the production
// build output (.output/public/assets). Run after `pnpm build` with
// `pnpm check:bundles`; exits 1 naming every offending chunk. An optional first
// argument selects an assets directory for isolated artifact checks.
//
// The initial closure is what the browser must download before the app can
// render: the entry chunk, every chunk reachable from it through static import
// specifiers, and all CSS. Dynamic `import("./x.js")` edges are not followed;
// those are the route and lazy splits. Three ceilings apply: the entry chunk, the
// initial closure and any chunk outside it.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = process.argv[2] ?? join(ROOT, '.output/public/assets')

const BUDGETS = {
  mainEntryGzip: 70_100,
  initialClosureGzip: 321_000,
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
const failures = []

const sizes = new Map()
for (const f of [...jsFiles, ...cssFiles]) sizes.set(f, gzipSize(f))

function staticDependencies(file) {
  const source = readFileSync(join(ASSETS_DIR, file), 'utf8')
  const dependencies = new Set()
  // Only declarations create static edges; strings, comments and dynamic
  // import expressions may contain identical-looking specifiers.
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest)
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const literal = statement.moduleSpecifier
    if (!literal || !ts.isStringLiteral(literal)) continue
    const specifier = literal.text
    if (!specifier.endsWith('.js')) continue
    const name = basename(specifier)
    if (sizes.has(name)) dependencies.add(name)
    else failures.push(`missing static chunk ${specifier} imported by ${file}`)
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

/** Tarjan's strongly connected components, including static self-imports. */
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
    if (component.length > 1 || graph.get(file).has(file)) cycles.push(component.sort())
  }
  for (const file of graph.keys()) if (!indexOf.has(file)) visit(file)
  return cycles
}

// One side of an ESM import cycle evaluates while the other is uninitialized, and
// the bundler emits `var`, so a read across the cycle yields `undefined` instead of
// throwing: build, typecheck and the size budgets pass and the browser breaks.
// Cycles that reach first paint are gated, and so is any cycle through a vendor
// chunk, because a library that imports the app back breaks every page that loads it.
const gatedCycles = importCycles(edges).filter((cycle) =>
  cycle.some((file) => closure.has(file) || file.startsWith('vendor-')),
)

const fmt = (n) => `${n.toLocaleString('en-US')} B`
const over = (what, actual, budget) =>
  failures.push(`${what}: ${fmt(actual)} exceeds budget ${fmt(budget)}`)

for (const cycle of gatedCycles) {
  failures.push(
    `static import cycle through first paint or a vendor chunk (${cycle.length} chunks): ${cycle.join(' ↔ ')}`,
  )
}

for (const file of closure) {
  if (!file.startsWith('vendor-sentry-')) continue
  failures.push(
    `${file} (${fmt(sizes.get(file))}) is in the initial closure: the browser Sentry SDK loads only through instrument.client.ts's dynamic import, so cut the static importer`,
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
  '[bundle-budget] OK — all chunks within budget, no static import cycle through first paint or a vendor chunk:',
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
