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
// Re-measured 2026-09-30 for the guest font split (portal round 4, slice 7),
// on fresh production builds of main and of the change: 326,771 B (76 js + 1
// css) → 327,187 B (76 js + 1 css), +416 B, leaving 1,918 B of headroom. `main`
// had already drifted up from 317,727 B since 2026-09-22 (2,334 B of headroom).
// The +416 B is the root document's font-set choice (src/shared/font-sets.ts and
// its <link> component); the two third-party @imports left styles.css, which
// only shrinks that stylesheet. The guest stylesheet and its 16 woff2 files sit
// in public/fonts/guest, outside .output/public/assets, so they are not part of
// this closure and stay off every other page. The budget is unchanged.
//
// 2026-09-30 (Portal round 4, s27): the Portal detail loader now prefetches the
// property's portal groups (the editor's Group section reads them), so the
// route's critical chunk carries one more query and its server-function stub.
// The shared query lives in -portal-detail-data, already part of this closure,
// so it adds no chunk. Measured 329,350 B (78 js + 1 css) against 329,105 B;
// the budget moves to 329,700 B.
//
// 2026-09-30 (Portal round 4, s34): the Results tab adds Tailwind utilities to
// the one global stylesheet (styles.css 25,162 B -> 25,598 B gzip, +436 B); the
// JS closure is unchanged within +-50 B per chunk (the entry chunk shrank 78 B).
// Fresh production builds of main (6264a7b2e) and of the change: 329,535 B ->
// 329,971 B (78 js + 1 css). The budget moves to 330,300 B.
//
// 2026-10-01 (Portal round 4, s25a): the Portals overview adds its route's
// search schema (q, groupBy, show, sort, dir, page) to the route config that
// first paint carries, and the table's Tailwind utilities to the one global
// stylesheet. Fresh production builds of main (3bb1f2e56) and of the change:
// 330,054 B -> 330,730 B (78 js + 1 css), +676 B: the entry chunk 43,141 B ->
// 43,653 B (+512 B), styles.css 25,598 B -> 25,854 B (+256 B), every other
// chunk together -92 B. `main` had drifted up from the 329,971 B recorded for
// s34 (+83 B), leaving 246 B of headroom. The budget moves to 331,050 B.
//
// 2026-10-01 (Portal round 4, s40): the All properties route (/portals) imports
// the Portals overview's search schema, so that module, once inlined in the entry
// chunk for the Property page's route alone, is shared by two route configs and
// becomes its own chunk. The new route's server-function stubs merge two
// existing stub chunks, three query keys and the table's utilities grow the
// stylesheet, and the route's pure view code and strings add to the entry. Fresh
// production builds of main (d7cd025e9, after #690) and of this change merged
// onto it: 331,230 B -> 331,663 B (78 js + 1 css), +433 B. `main` had 170 B of
// headroom under its 331,400 B. The budget moves to 332,000 B.
// 2026-10-01 (Portal round 4, s38): the group page route
// (portals/groups/$groupId) adds a route configuration and two eager query
// modules shared with the Portals overview route (-portal-overview-data, kept
// apart from the hook that draws the page so the loader does not pull the page
// in), the server-function stubs of the group reads merge into existing stub
// chunks, the stylesheet grows with the group page and the compact table
// density's classes, three query keys add a few bytes and the icon chunks
// reshuffle. A fresh production build of this change merged onto main (a840c201c,
// which s40 recorded at 331,663 B): 332,881 B (80 js + 1 css), +1,218 B. `main`
// had 337 B of headroom under its 332,000 B. The budget moves to 333,300 B.
//
// 2026-10-01 (Portal round 4, s18, the guest quality gate): measured on a fresh
// production build of this branch merged (trial merge, aborted) onto origin/main
// at cfd084377: entry 43,769 B, initial closure 333,126 B (79 js + 1 css), 174 B
// under the unchanged 333,300 B. The slice adds stories, a story fixture, e2e
// helpers and a Playwright config, and no module a production build reaches, so
// the figure is main's own (main has moved since, through s30's live preview and
// s35b's page-edit ledger, and is the reason it is not the 333,029 B first
// recorded against 80fa0fad7). The Immersive Hub page is not in this closure at
// all yet (the route does not mount it before slice 19); its own CSS is
// TypeScript strings that ship with the page's JavaScript, and the guest font
// stylesheet and 16 woff2 files sit in public/fonts/guest, outside
// .output/public/assets. Slice 19, which mounts the page, is the one that moves
// this figure, and 174 B of headroom is less than it will need: it must
// re-measure and raise the budget with a fresh figure recorded here.
//
// 2026-10-01 (inbox phone bars, #675): the phone grid for the inbox bars, the
// "Sort and filter" sheet, its choice chips and the active-filter chips add
// about 25 phone-only Tailwind utilities (gutters, optical pulls, the sheet's
// shape, the rows' resting gutter and tap targets) to the one global
// stylesheet; the components themselves are in the inbox's lazy chunks. Three
// utilities that only a comment or a story named were cut first (-21 B). Fresh
// production builds of main (cfd084377) and of this change rebased onto it:
// 333,126 B -> 333,447 B (79 js + 1 css), +321 B: styles.css 26,580 B ->
// 26,895 B (+315 B), the entry chunk 43,769 B -> 43,760 B. `main` had 174 B of
// headroom under its 333,300 B. The budget moves to 333,800 B.
//
// 2026-10-01 (Portal round 4, s19, the v3 writer and the guest mount): fresh
// production builds of main (021f6bcc6) and of this change: 333,126 B -> 333,290
// B (79 js + 1 css), +164 B, all of it in the entry chunk (43,769 B -> 43,933 B):
// the guest route's loader now reads the page's copy pack and `servedAt`, and
// the route's component names the Immersive Hub. Every other chunk, the
// stylesheet and the chunk count are unchanged. The Immersive Hub page itself is
// NOT in this closure: its code and its CSS strings (TypeScript strings that
// ship with the page's JavaScript) sit in the guest route's lazy component
// chunk, and the copy packs sit behind a dynamic import. The first attempt
// imported the pack loader from the guest barrel inside the loader, which is in
// the route's critical chunk: that put the whole guest page into the initial
// closure (383,029 B, +49,903 B), so the loader imports the loader's own module
// dynamically and a comment on it says why. The budget moves to 333,700 B, which
// leaves 410 B for the slices that follow.
//
// 2026-10-01 (Portal round 4, s31b, the Review & publish page): the review
// route's loader now fetches the review read afresh on each entry, so the
// route's critical chunk carries one more query (portalReviewQuery in
// -portal-detail-data, with the server-function stub of getPortalReview and the
// publish stub the editor's actions hold) and the query key; the page itself
// (portal-review/) is in the route's lazy component chunk. Fresh production
// builds of main (8ffd8e3f3) and of this change: 334,045 B (81 js + 1 css) ->
// 335,082 B (84 js + 1 css), +1,037 B, three more shared stub chunks. `main` had
// 255 B of headroom under its 334,300 B. The budget moves to 335,700 B.
//
// 2026-10-01 (Portal round 4, s42c2, the Property look's photo and logo
// controls): the controls and their dialogs are in the look route's lazy
// component chunk, so the JavaScript closure barely moves (the entry chunk
// 44,483 B -> 44,530 B). The one global stylesheet grows by ten utilities the
// focal-point circle, the logo swatch and the two-column dialog need (689 B raw):
// `cursor-grab`, `touch-none`, `size-1`, `bg-neutral-900` and the like. Arbitrary
// values, a ring, a rendered-empty alert and three one-off sizes were cut first.
// Fresh production builds of main (0ea2f2547, with s31b and s39b) and of this
// change merged onto it: 335,331 B -> 335,517 B (83 js + 1 css), +186 B. `main`
// had 369 B of headroom under its 335,700 B. The budget moves to 335,900 B.
//
// 2026-10-02 (Portal round 4, s47b, click a part of the preview to edit it):
// the preview's part boxes and the language sheet are in the portal editor's lazy
// chunks; the initial closure moves by ten bytes (a shared stub chunk). The CI
// production build of this change merged onto main measured 335,910 B (83 js + 1
// css) against the 335,900 B budget. The budget moves to 336,300 B.
//
// 2026-10-03 (UI consistency, stage S1: safety bugs, link layer and shell
// ownership): A1 (guarded Portal route errors), B1 (link layer in @layer base,
// sidebar classes) and B2 (page gutter owner, theme control, dashboard tier)
// were each measured alone, never together. Fresh production builds of main
// (484f3cc2b) and of the combined stage branch: 336,222 B -> 336,691 B (82 js + 1
// css) before the review fixes, +469 B (A1 +371, B1 +16 and B2 +73 alone, 9 B
// more together), which left 9 B under the 336,700 B A1 had raised to. The review
// fixes add 22 B on top (336,691 B -> 336,713 B): mostly the Portal list
// fallbacks' dashboard tier, so they stop narrowing the page while it loads
// (that chunk +15 B), the account menu's generated label id and phone touch
// target (entry chunk +9 B) and the stylesheet (+6 B). Final measurement:
// 336,713 B (82 js + 1 css, entry 45,629 B), +491 B over main. The budget moves
// to 336,800 B, which leaves 87 B. This is baseline growth, so it waits for the
// owner's approval at the S1 pull request (plan decision 12); the alternative is
// to cut the guarded error hook out of the router's first paint.
//
// 2026-10-03 (Inbox first paint on phones, #672): `useIsMobile` and
// `useInboxCompactLayout` now answer from the request's viewport hint during
// SSR and hydration, so a phone's first paint is already the phone layout. The
// shared hook (`useViewportBelow`, its context and the hint's breakpoint check)
// is first-paint code, because the notification bell in the entry chunk calls
// `useIsMobile`. A chunk group for the three hook modules was tried and made
// the closure larger (337,008 B): the entry imports them statically. The cookie
// writer stays in the code-split authenticated layout. Fresh production builds
// of main (3e2a53028) and of this change merged onto it: 336,745 B -> 336,870 B
// (82 js + 1 css), +125 B, against main's 55 B of headroom. The budget moves to
// 337,000 B.
// 2026-10-03 (UI consistency, stage S2, slice C1: PageState): one PageState now
// draws every page's pending, failed, missing and unavailable states in the
// title, breadcrumbs and tier the loaded page has, and every authenticated page is
// named once on its route (`staticData.page`), which also titles its tab. Fresh
// production builds of the S1 stage head (e1d39e526) and of this change: 336,745
// B -> 337,733 B (82 js + 1 css), +988 B. The router's three inline defaults, the
// old `page-states` chunk (488 B) and the Portal-only `portal-route-fallbacks`
// chunk (879 B) are gone, and the entry chunk shrank 484 B as the guarded error
// hook and the defaults moved into one shared `route-page-state` chunk (2,102 B:
// PageState, the identity rules, the guarded hook). What is new is that chunk's
// identity and PageState code, the `alert` chunk (573 B, no longer inlined in the
// entry chunk), `route-notice` (193 B, the thrown cause of a refusal), and the 28
// page names in the route configs (+227 B, measured by building without them). The
// refusal sentences are not in first paint: a route throws only the cause, and the
// copy sits in the shell's lazy not-found boundary (`route-notice-copy`); the first
// draft carried them and measured +1,437 B, so moving them out saved 409 B. The
// budget moves to 337,800 B, which leaves 67 B. This is baseline growth on top of S1's, so it waits for the owner's
// approval (plan decision 12).
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
  initialClosureGzip: 337_800, // 319,519 + 3% (2026-09-08), raised 595 B on 2026-09-30 for the Portal editor's Group-section prefetch; measured 329,350; raised to 330,300 on 2026-09-30 for the Portal Results tab's stylesheet growth, measured 329,971; raised to 331,050 on 2026-10-01 for the Portals overview, measured 330,730; raised to 331,400 on 2026-10-01 for the Linktree editor rebased onto the Languages section, measured 331,093; raised to 332,000 on 2026-10-01 for the All properties route, measured 331,663 (main 331,230); raised to 333,300 for the group page route, measured 332,881; raised to 333,800 on 2026-10-01 for the inbox phone bars, measured 333,447 (main 333,126); raised to 334,300 on 2026-10-01 for the v3 writer and the guest mount rebased onto the inbox phone bars, measured 334,045 (main 333,447); raised to 335,700 on 2026-10-01 for the Review & publish page's loader, measured 335,082 (main 334,045); raised to 335,900 on 2026-10-01 for the Property look photo and logo controls, measured 335,517 (main 335,331); raised to 336,300 on 2026-10-02 for the click-to-edit preview, measured 335,910; raised to 336,700 on 2026-10-03 for the Portal route errors' guarded boundary (sanitised message, report, sign-in redirect, Try again, shared with the router default: UI consistency A1), measured 336,593 (main 336,222); raised to 336,800 on 2026-10-03 for the combined S1 stage (A1 + B1 + B2 + review fixes, see the 2026-10-03 entry above), measured 336,713, pending the owner's approval; raised to 337,000 on 2026-10-03 for the Inbox's server-rendered phone layout, measured 336,870 (main 336,745); 800, // 319,519 + 3% (2026-09-08), raised 595 B on 2026-09-30 for the Portal editor's Group-section prefetch; measured 329,350; raised to 330,300 on 2026-09-30 for the Portal Results tab's stylesheet growth, measured 329,971; raised to 331,050 on 2026-10-01 for the Portals overview, measured 330,730; raised to 331,400 on 2026-10-01 for the Linktree editor rebased onto the Languages section, measured 331,093; raised to 332,000 on 2026-10-01 for the All properties route, measured 331,663 (main 331,230); raised to 333,300 for the group page route, measured 332,881; raised to 333,800 on 2026-10-01 for the inbox phone bars, measured 333,447 (main 333,126); raised to 334,300 on 2026-10-01 for the v3 writer and the guest mount rebased onto the inbox phone bars, measured 334,045 (main 333,447); raised to 335,700 on 2026-10-01 for the Review & publish page's loader, measured 335,082 (main 334,045); raised to 335,900 on 2026-10-01 for the Property look photo and logo controls, measured 335,517 (main 335,331); raised to 336,300 on 2026-10-02 for the click-to-edit preview, measured 335,910; raised to 336,700 on 2026-10-03 for the Portal route errors' guarded boundary (sanitised message, report, sign-in redirect, Try again, shared with the router default: UI consistency A1), measured 336,593 (main 336,222); raised to 336,800 on 2026-10-03 for the combined S1 stage (A1 + B1 + B2 + review fixes, see the 2026-10-03 entry above), measured 336,713, pending the owner's approval; raised to 337,800 on 2026-10-03 for UI consistency S2 slice C1 (PageState and page names, see the 2026-10-03 entry above), measured 337,733, pending the owner's approval
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
