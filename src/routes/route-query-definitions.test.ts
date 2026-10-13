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
import { relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { readUiSources, type SourceFile } from '#/shared/testing/source-tree'

type Definition = Readonly<{ key: string; path: string }>

const ROUTE_SOURCES = readUiSources({ includeTs: true, comments: 'kept' }).filter(
  (file) => file.path.startsWith('src/routes/'),
)

/** The `queryKey` of an object that also has a `queryFn`, as written. */
function definedKey(node: ts.Node, source: ts.SourceFile): string | null {
  if (!ts.isObjectLiteralExpression(node)) return null
  const named = new Map(
    node.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => [property.name.getText(source), property.initializer]),
  )
  const key = named.get('queryKey')
  if (!key || !named.has('queryFn')) return null
  return key.getText(source).replace(/\s+/gu, ' ')
}

function definitionsIn(file: SourceFile): Definition[] {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)
  const found: Definition[] = []
  const visit = (node: ts.Node): void => {
    const key = definedKey(node, source)
    if (key !== null) found.push({ key, path: relative('src/routes', file.path) })
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

describe('route query options', () => {
  it('finds the definitions it is meant to read', () => {
    const keys = ROUTE_SOURCES.flatMap(definitionsIn).map((definition) => definition.key)

    expect(keys).toContain('identityKeys.members()')
    expect(keys).toContain('propertyKeys.list()')
  })

  it('are defined once, and imported by every route that reads them', () => {
    expect(redefined(ROUTE_SOURCES.flatMap(definitionsIn))).toEqual({})
  })

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
