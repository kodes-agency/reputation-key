// One definition per query (review finding R1D-10).
//
// A query's options (its key, its read and its staleTime) are written once and
// imported by every route that reads it: `-queries/route-queries.ts` says why
// (the loader and each consumer must hold the SAME options, or the primed cache
// is not the one that is read). A route that redefined them worked while the
// copies agreed, and nothing would say when they stopped: the member list was
// defined twice, the Google connections three times, and the People page filled
// the Portals list's key with a result of another shape.
//
// This reads every route source and fails on a key that two places define. A
// definition is an object with both a `queryKey` and a `queryFn`; an
// invalidation names a key and reads nothing, so it is not one.
//
// Two goal reads stay defined per route, on purpose (`LEAF_COPIES`): they are
// listed, and their copies must be the same read.
import { relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { readUiSources, type SourceFile } from '#/shared/testing/source-tree'

type Definition = Readonly<{ key: string; path: string; read: string }>

const ROUTE_SOURCES = readUiSources({ includeTs: true, comments: 'kept' }).filter(
  (file) => file.path.startsWith('src/routes/'),
)

/** The `queryKey` and the `queryFn` of an object that has both, as written. */
function definedRead(
  node: ts.Node,
  source: ts.SourceFile,
): Pick<Definition, 'key' | 'read'> | null {
  if (!ts.isObjectLiteralExpression(node)) return null
  const named = new Map(
    node.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => [property.name.getText(source), property.initializer]),
  )
  const key = named.get('queryKey')
  const read = named.get('queryFn')
  if (!key || !read) return null
  const written = (part: ts.Node) => part.getText(source).replace(/\s+/gu, ' ')
  return { key: written(key), read: written(read) }
}

function definitionsIn(file: SourceFile): Definition[] {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)
  const found: Definition[] = []
  const visit = (node: ts.Node): void => {
    const defined = definedRead(node, source)
    if (defined) found.push({ ...defined, path: relative('src/routes', file.path) })
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Each key that more than one place defines, with the files that do. */
function redefined(definitions: readonly Definition[]): Record<string, string[]> {
  const places = new Map<string, string[]>()
  for (const { key, path } of definitions) {
    places.set(key, [...(places.get(key) ?? []), path])
  }
  return Object.fromEntries([...places].filter(([, paths]) => paths.length > 1))
}

const GOALS = '_authenticated/properties/$propertyId/goals'

/**
 * Reads that more than one goal page defines for itself, and may. Sharing them
 * was measured on 2026-10-13, on production builds of the same tree: against
 * 307,592 B gzip for the first-paint closure with the copies below, one module
 * for the two beside the goal routes gave 308,008 B (+416) and defining them in
 * `route-queries.ts` gave 307,801 B (+209). A shared module is a chunk of its
 * own in that closure, and one more importer of server functions changes how
 * their stubs are grouped; copies of the same text compress to nearly nothing.
 * The budget has about 300 B of slack, so they stay per route, and what could
 * go wrong is held here instead: each copy must be the same read.
 */
const LEAF_COPIES: Readonly<Record<string, readonly string[]>> = {
  "goalKeys.list({ propertyId, model: 'program' })": [
    `${GOALS}/index.tsx`,
    `${GOALS}/new.tsx`,
  ],
  'portalKeys.goalSubjectNames(propertyId)': [
    `${GOALS}/$goalId.tsx`,
    `${GOALS}/index.tsx`,
  ],
}

describe('route query options', () => {
  it('finds the definitions it is meant to read', () => {
    const keys = ROUTE_SOURCES.flatMap(definitionsIn).map((definition) => definition.key)

    expect(keys).toContain('identityKeys.members()')
    expect(keys).toContain('propertyKeys.list()')
  })

  it('are defined once, and imported by every route that reads them', () => {
    expect(redefined(ROUTE_SOURCES.flatMap(definitionsIn))).toEqual(LEAF_COPIES)
  })

  it.each(Object.keys(LEAF_COPIES))(
    'make the same read in every copy a goal page keeps: %s',
    (key) => {
      const reads = ROUTE_SOURCES.flatMap(definitionsIn)
        .filter((definition) => definition.key === key)
        .map((definition) => definition.read)

      expect(new Set(reads).size).toBe(1)
    },
  )

  it('counts a second definition of a key and ignores an invalidation of it', () => {
    const file = (path: string, text: string): SourceFile => ({ path, text })
    const definitions = [
      file(
        'src/routes/a.tsx',
        'const a = queryOptions({ queryKey: keys.list(id), queryFn: () => read(id) })',
      ),
      file(
        'src/routes/b.tsx',
        `const b = queryOptions({
           queryKey: keys.list(id),
           queryFn: () => read(id),
         })
         client.invalidateQueries({ queryKey: keys.detail(id) })
         const c = { queryKey: keys.detail(id), queryFn: () => one(id) }`,
      ),
    ].flatMap(definitionsIn)

    expect(redefined(definitions)).toEqual({ 'keys.list(id)': ['a.tsx', 'b.tsx'] })
  })
})
