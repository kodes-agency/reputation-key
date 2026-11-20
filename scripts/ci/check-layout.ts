// Layout gate (docs/rules.md, rule 12).
//
// WHAT. Walks `src/` and checks the place of every file against LAYOUT, the
// map below. A file in a place the map names passes. Every other file counts
// against a path in layout.baseline.json: a folder that may only shrink (an
// area's `application/`, `infrastructure/` and `ports/`, screens outside their
// area, loose files in `src/shared`), or a place the map does not name (an
// undeclared feature folder, a module in a feature that is not a contract, a
// server file or a test). The gate fails when a count rises above its entry; a
// path without an entry may hold nothing. Entries are counts, not lists: a file
// added to a counted folder while another leaves it passes. Tests and stories
// in a counted folder are not counted, so a regression test for old code can
// still be added beside it.
//
// WHY. Business code was organised twice: by layer first, by feature since
// November 2026. Lint checks who may import whom, and classifies any new folder
// under an area as a feature, so nothing stopped new code landing in a layer
// folder or a folder named `helpers`. This gate makes the place of new code a
// decision: it goes where the map says, or the map changes in the same review.
//
// WHY A GATE (rule 34). Lint classifies a file by its path; it cannot refuse a
// new file in a folder it already knows, or count what a folder holds. When the
// layer folders are empty, the lint rules keyed on them go, and so do the
// entries here.
//
// SCOPE. Places only. Imports stay with eslint.config.js (boundaries, the
// public-api rule, the `*.server.ts` and React bans). `src/routes`,
// `src/composition` and `src/worker` are not shaped here.
//
// ADDING A FEATURE. Create `src/contexts/<area>/<feature>/`, add the name to
// LAYOUT.areas in the same change, and keep to the feature shape: `contracts.ts`
// (types and schemas the browser may import), `*.server.ts` (commands, reads,
// stores, adapters, jobs), `ui/` (screens), tests beside what they test.
//
// UPDATING THE BASELINE. `pnpm check:layout --write-baseline`, then commit the
// JSON: after moving files out of a counted folder (the gate passes and asks
// for this). The command refuses to raise an entry or to add one.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEntryPoint } from './entry-point'
import {
  compareWithBaseline,
  formatChanges,
  parseBaseline,
  runRatchetGate,
  type RatchetChange,
  type RatchetCounts,
} from './ratchet-baseline'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BASELINE_PATH = resolve(ROOT, 'scripts/ci/layout.baseline.json')
const WRITE_COMMAND = 'pnpm check:layout --write-baseline'

export type Layout = Readonly<{
  /** Entry and wiring files at the root of `src/`; their tests pass too. */
  sourceRootFiles: readonly string[]
  /** Folders at the root of `src/` that this gate does not shape further. */
  sourceRootFolders: readonly string[]
  /** Business areas and the feature folders each one holds. */
  areas: Readonly<Record<string, readonly string[]>>
  /** Folders every area keeps at its root: its pure rules and its server functions. */
  areaFolders: readonly string[]
  /** The design system: the only folders `src/components` keeps. */
  designSystemFolders: readonly string[]
  /** Screens under `src/components/features` that compose several areas and belong to none. */
  crossAreaScreens: readonly string[]
  /** Platform folders of `src/shared`. */
  sharedFolders: readonly string[]
}>

export const LAYOUT: Layout = {
  sourceRootFiles: [
    'bootstrap.ts',
    'client.tsx',
    'composition.ts',
    'instrument.client.ts',
    'routeTree.gen.ts',
    'router.tsx',
    'start.ts',
    'styles.css',
    'test-setup.ts',
    'vite-env.d.ts',
  ],
  sourceRootFolders: ['composition', 'routes', 'worker'],
  areas: {
    ai: ['analysis', 'consent', 'execution', 'guest-voice', 'replay', 'reply', 'rights'],
    feed: ['audit', 'email', 'feed', 'notify', 'preferences', 'rights'],
    guest: ['contact-requests', 'page', 'responses', 'rights'],
    identity: [
      'consent',
      'feedback',
      'images',
      'members',
      'operator',
      'organization',
      'policy',
      'rights',
      'staff',
      'updates',
    ],
    // Review and Inbox are one bounded context with Reputation (rule 7). Their
    // code moves into Reputation's features; neither gains features of its own.
    inbox: [],
    integration: ['connections', 'imports', 'performance', 'provider', 'review-sync'],
    portal: ['editor', 'look', 'printing', 'publication', 'workspace'],
    property: ['lifecycle', 'profile', 'responsibility'],
    reporting: [
      'goals',
      'monthly-goals',
      'portal-results',
      'property-overview',
      'rating-goals',
      'readings',
      'rights',
    ],
    reputation: ['content', 'inbox', 'library', 'replies', 'response-targets', 'reviews'],
    review: [],
  },
  areaFolders: ['domain', 'server'],
  designSystemFolders: ['forms', 'hooks', 'layout', 'ui'],
  // src/components/CONTEXT.md, "Where screens live", says why each one stays.
  crossAreaScreens: ['property-setup'],
  sharedFolders: [
    'ai-provider-control',
    'architecture',
    'auth',
    'cache',
    'commands',
    'config',
    'db',
    'domain',
    'email',
    'events',
    'generated',
    'google-provider-control',
    'governance',
    'health',
    'hooks',
    'http',
    'jobs',
    'lifecycle',
    'observability',
    'ops',
    'outbox',
    'provider-ephemeral',
    'queries',
    'rate-limit',
    'release',
    'security',
    'shell-context',
    'stale-tab',
    'testing',
  ],
}

const MAP_FILE = 'CONTEXT.md'
/** Loose files in `src/shared` are counted together: none of them is a place. */
const SHARED_LOOSE_FILES = 'src/shared/*'
const TEST_FILE = /\.test\.tsx?$/u
const TEST_OR_STORY = /\.(?:test|stories)\.tsx?$/u
const AREA_WIRING_FILE = /^(?:build(?:-[\w.-]+)?|public-api)\.ts$/u
const FEATURE_FILE =
  /^(?:[\w-]+\.)?contracts\.ts$|\.server\.ts$|\.test-fixtures\.ts$|\.json$/u
const UI_MISPLACED_FILE = /^index\.tsx?$|\.server\.tsx?$/u

/** The baseline path a file counts against, or null when the map names its place. */
type Place = string | null

function placeInFeature(file: string, parts: readonly string[]): Place {
  const [, , area, feature, child] = parts
  if (child === undefined) return file
  if (parts.length === 5) {
    return child === MAP_FILE || FEATURE_FILE.test(child) || TEST_FILE.test(child)
      ? null
      : file
  }
  if (child !== 'ui') return `src/contexts/${area}/${feature}/${child}`
  return UI_MISPLACED_FILE.test(parts.at(-1) ?? '') ? file : null
}

function placeInContexts(file: string, parts: readonly string[], layout: Layout): Place {
  const [, , area, child] = parts
  if (area === undefined) return file
  if (parts.length === 3) return area === MAP_FILE || area === '.gitkeep' ? null : file
  const features = layout.areas[area]
  if (features === undefined || child === undefined) return `src/contexts/${area}`
  if (parts.length === 4) {
    return child === MAP_FILE || AREA_WIRING_FILE.test(child) || TEST_FILE.test(child)
      ? null
      : file
  }
  if (layout.areaFolders.includes(child)) return null
  if (features.includes(child)) return placeInFeature(file, parts)
  // A layer folder that only shrinks, or a folder the map does not declare.
  return `src/contexts/${area}/${child}`
}

function placeInComponents(
  file: string,
  parts: readonly string[],
  layout: Layout,
): Place {
  const [, , folder, child] = parts
  if (folder === undefined) return file
  if (parts.length === 3) return folder === MAP_FILE ? null : file
  if (layout.designSystemFolders.includes(folder)) return null
  if (folder !== 'features') return `src/components/${folder}`
  if (child === undefined || parts.length === 4) return file
  return layout.crossAreaScreens.includes(child)
    ? null
    : `src/components/features/${child}`
}

function placeInShared(file: string, parts: readonly string[], layout: Layout): Place {
  const [, , folder] = parts
  if (folder === undefined) return file
  if (parts.length === 3) return folder === MAP_FILE ? null : SHARED_LOOSE_FILES
  return layout.sharedFolders.includes(folder) ? null : `src/shared/${folder}`
}

function placeOf(file: string, layout: Layout): Place {
  const parts = file.split('/')
  const [, top] = parts
  if (top === undefined) return file
  if (parts.length === 2) {
    return layout.sourceRootFiles.includes(top) || TEST_FILE.test(top) ? null : file
  }
  if (top === 'contexts') return placeInContexts(file, parts, layout)
  if (top === 'components') return placeInComponents(file, parts, layout)
  if (top === 'shared') return placeInShared(file, parts, layout)
  return layout.sourceRootFolders.includes(top) ? null : `src/${top}`
}

/**
 * The path a file counts against. A test or a story in a counted folder counts
 * against nothing; one that is itself misplaced still does.
 */
function countedPlace(file: string, layout: Layout): Place {
  const place = placeOf(file, layout)
  return place !== file && TEST_OR_STORY.test(basename(file)) ? null : place
}

/** Files per baseline path, for repository paths under `src/`. */
export function layoutCounts(
  files: readonly string[],
  layout: Layout = LAYOUT,
): RatchetCounts {
  return files
    .map((file) => countedPlace(file, layout))
    .filter((place): place is string => place !== null)
    .reduce<RatchetCounts>(
      (counts, place) => ({ ...counts, [place]: (counts[place] ?? 0) + 1 }),
      {},
    )
}

/**
 * Every file under `src/`, as a repository path with forward slashes. Dot files
 * are left out: a `.DS_Store` a file manager drops is not a misplaced module.
 */
export function listSourceFiles(root: string): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(join(root, directory), { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .flatMap((entry) => {
        const path = `${directory}/${entry.name}`
        return entry.isDirectory() ? walk(path) : [path]
      })
  return walk('src')
}

const ADVICE: readonly (readonly [RegExp, string])[] = [
  [
    /^src\/contexts\/[^/]+\/(?:application|infrastructure|ports)$/u,
    'An area’s application/, infrastructure/ and ports/ folders only shrink. New\n' +
      'server code (a command, a read, a store, an adapter, a job) goes in a feature\n' +
      'folder as <feature>/<name>.server.ts; pure rules go in the area’s domain/.',
  ],
  [
    /^src\/components\//u,
    'A screen lives with its feature, in src/contexts/<area>/<feature>/ui/.\n' +
      'src/components keeps the design system (forms, hooks, layout, ui) and the\n' +
      'cross-area screens LAYOUT names.',
  ],
  [
    /^src\/shared\//u,
    'src/shared holds platform folders. A business rule belongs to its area; a\n' +
      'value several areas share goes in src/shared/domain/<topic>/.',
  ],
  [
    /^src\/contexts\/[^/]+\/[^/]+\/.+/u,
    'A feature folder holds contracts.ts, *.server.ts, tests and ui/. Inside ui/\n' +
      'there is no index file and no *.server.ts.',
  ],
  [
    /^src\/contexts\//u,
    'A new area or feature folder is declared in LAYOUT.areas\n' +
      '(scripts/ci/check-layout.ts) in the same change. An area’s root holds only\n' +
      'CONTEXT.md, build*.ts, public-api.ts and tests of those.',
  ],
  [/^src\//u, 'The root of src/ holds the entry files and folders LAYOUT names.'],
]

/** The first advice whose pattern matches; the last pattern matches every path. */
function adviceFor(place: string): string {
  return ADVICE.find(([pattern]) => pattern.test(place))?.[1] ?? ''
}

export function explainLayoutRegressions(regressions: readonly RatchetChange[]): string {
  const advice = [...new Set(regressions.map(({ file }) => adviceFor(file)))]
  return (
    `${formatChanges(regressions)}\n\n${advice.join('\n\n')}\n\n` +
    'The layout is rule 12 of docs/rules.md; the map is LAYOUT in\n' +
    'scripts/ci/check-layout.ts.'
  )
}

/** Entries a rewrite would raise or add. A baseline that can rise holds nothing. */
function raisedByRewrite(
  baselinePath: string,
  current: RatchetCounts,
): readonly RatchetChange[] {
  if (!existsSync(baselinePath)) return []
  const baseline = parseBaseline(readFileSync(baselinePath, 'utf8'))
  return compareWithBaseline(baseline, current).regressions
}

export type LayoutCheckout = Readonly<{ root: string; baselinePath: string }>

/** Check, or rewrite the baseline downwards; returns the process exit code. */
export function runLayoutGate(
  args: readonly string[],
  at: LayoutCheckout = { root: ROOT, baselinePath: BASELINE_PATH },
): number {
  const current = layoutCounts(listSourceFiles(at.root))
  const raised = args.includes('--write-baseline')
    ? raisedByRewrite(at.baselinePath, current)
    : []
  if (raised.length > 0) {
    process.stderr.write(
      `[layout] FAILED — the baseline is not rewritten upwards; ${raised.length} path(s) rose:\n` +
        `${explainLayoutRegressions(raised)}\n`,
    )
    return 1
  }
  const files = Object.values(current).reduce((sum, count) => sum + count, 0)
  return runRatchetGate(
    {
      name: 'layout',
      baselinePath: at.baselinePath,
      writeCommand: WRITE_COMMAND,
      summary: `${files} file(s) in ${Object.keys(current).length} place(s) that may only shrink, none above the baseline`,
      explainRegressions: explainLayoutRegressions,
    },
    current,
    args,
  )
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = runLayoutGate(process.argv.slice(2))
}
