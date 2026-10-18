// Keeps the server functions the e2e journeys call in the production build.
//
// A journey calls a server function by the file and export name it was written
// in (`callServerFn`, `serverFnUrl`). The e2e stack runs the PRODUCTION build,
// and that build registers only the server functions its compiler meets while
// it follows imports from the app's entries: a server-function module nothing
// imports, statically or by `import()`, is left out, and a call to it answers
// HTTP 500 "Server function info not found" in CI while the same call works in
// development, where the module is loaded on demand. PG-21 retired the last
// screen that imported `changeGoalMonthTarget`, and its journey failed only in
// the slowest job. This is the check that says so in the unit run.
//
// Pure of the browser: it reads source text, so the rules are unit-tested.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** One call a journey makes: the module and the export it names. */
export type ServerFnCall = Readonly<{ file: string; exportName: string }>

/** The app's entries: the router (and with it every route), the Start instance, the client. */
export const APP_ENTRIES: ReadonlyArray<string> = [
  'src/router.tsx',
  'src/start.ts',
  'src/client.tsx',
]

const CALL = /file:\s*'(src\/[^']+\.tsx?)',\s*exportName:\s*'([^']+)'/g

/** Every `{ file, exportName }` pair in a spec's source, in the shape `callServerFn` takes. */
export function serverFnCallsIn(source: string): ReadonlyArray<ServerFnCall> {
  return [...source.matchAll(CALL)].flatMap((match) => {
    const [, file, exportName] = match
    return file === undefined || exportName === undefined ? [] : [{ file, exportName }]
  })
}

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm
// `import x from 'm'`, `export { x } from 'm'`: the module is the last string. A
// type-only form is erased from the build and loads nothing.
const STATIC_IMPORT =
  /\b(?:import|export)\s+(type\s+)?[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g
const SIDE_EFFECT_IMPORT = /\bimport\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

/** The modules a source file loads: its imports, comments and type-only imports left out. */
export function importedSpecifiers(source: string): ReadonlyArray<string> {
  const code = source.replace(COMMENTS, '$1')
  const statics = [...code.matchAll(STATIC_IMPORT)].flatMap((match) =>
    match[1] === undefined && match[2] !== undefined ? [match[2]] : [],
  )
  const others = [
    ...[...code.matchAll(SIDE_EFFECT_IMPORT)].map((match) => match[1]),
    ...[...code.matchAll(DYNAMIC_IMPORT)].map((match) => match[1]),
  ].flatMap((specifier) => (specifier === undefined ? [] : [specifier]))
  return [...statics, ...others]
}

function resolveModule(root: string, from: string, specifier: string): string | null {
  const bare = specifier.split('?')[0] ?? specifier
  const base = bare.startsWith('#/')
    ? join(root, 'src', bare.slice(2))
    : bare.startsWith('.')
      ? resolve(dirname(from), bare)
      : null
  if (base === null) return null
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every source module the app's entries load, by a static or a dynamic import. */
export function modulesInTheBuild(
  root: string,
  entries: ReadonlyArray<string> = APP_ENTRIES,
): ReadonlySet<string> {
  const seen = new Set<string>()
  const queue = entries.map((entry) => join(root, entry))
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (seen.has(next) || !existsSync(next)) continue
    seen.add(next)
    for (const specifier of importedSpecifiers(readFileSync(next, 'utf8'))) {
      const module = resolveModule(root, next, specifier)
      if (module !== null) queue.push(module)
    }
  }
  return seen
}

/** The calls whose module the build never loads, so the production stack cannot answer them. */
export function callsOutsideTheBuild(
  root: string,
  calls: ReadonlyArray<ServerFnCall>,
  entries: ReadonlyArray<string> = APP_ENTRIES,
): ReadonlyArray<ServerFnCall> {
  const inTheBuild = modulesInTheBuild(root, entries)
  return calls.filter((call) => !inTheBuild.has(join(root, call.file)))
}

/**
 * Every `.ts` file under `dir` that runs in a journey: the specs and their
 * helpers, not the unit tests of those helpers, which only make up calls.
 */
export function journeyFilesUnder(dir: string): ReadonlyArray<string> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return journeyFilesUnder(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}
