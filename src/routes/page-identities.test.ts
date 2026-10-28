// What a page's fallback draws is named on its route: the body shape and the header
// lines are values of `staticData.page` (`page-identity`). A misspelt shape would
// compile only as far as the literal union allows a route to be wrong at runtime
// through a cast, and a shape the placeholder cannot draw is no shape at all. This
// walks the route files the generated tree mounts, reads each page named by a
// literal, and holds its values to the ones `PageState` knows.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { LOADING_SHAPES } from '#/components/layout/page-identity'

const ROOT = process.cwd()
const TIERS: readonly string[] = ['dashboard', 'standard', 'narrow']
const HEADER_LINES: readonly number[] = [0, 1, 2]

type NamedPage = Readonly<{
  file: string
  values: ReadonlyMap<string, string | number | boolean>
}>

function generatedRouteModules(): string[] {
  const generated = readFileSync(join(ROOT, 'src', 'routeTree.gen.ts'), 'utf8')
  const imports = generated.matchAll(
    /^import \{ Route as \w+ \} from '\.\/routes\/([^']+)'$/gmu,
  )
  return [...imports].map((match) => match[1] ?? '')
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      if (property.name.text === name) return property.initializer
    }
  }
  return undefined
}

function literalValue(node: ts.Expression): string | number | boolean | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

/** The page a route names with an object literal in `staticData.page`, if it does. */
function namedPage(module: string): NamedPage | null {
  const base = join('src', 'routes', module)
  const file = [`${base}.tsx`, `${base}.ts`].find((path) => existsSync(join(ROOT, path)))
  if (!file) return null
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  let page: ts.ObjectLiteralExpression | null = null
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (
        node.name.text === 'staticData' &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        const found = propertyNamed(node.initializer, 'page')
        if (found && ts.isObjectLiteralExpression(found)) page = found
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!page) return null
  const values = new Map<string, string | number | boolean>()
  for (const key of ['loading', 'headerLines', 'tier', 'fullBleed']) {
    const initializer = propertyNamed(page, key)
    const value = initializer ? literalValue(initializer) : undefined
    if (value !== undefined) values.set(key, value)
  }
  return { file, values }
}

const PAGES = generatedRouteModules()
  .map(namedPage)
  .filter((page): page is NamedPage => page !== null)

describe('the pages the routes name', () => {
  it('finds the pages the walk is meant to check', () => {
    expect(PAGES.length).toBeGreaterThan(20)
  })

  it('names a loading shape the placeholder can draw', () => {
    const wrong = PAGES.filter(({ values }) => {
      const shape = values.get('loading')
      return shape !== undefined && !LOADING_SHAPES.includes(shape as never)
    })
    expect(wrong.map((page) => page.file)).toEqual([])
  })

  it('names a header of no more than two lines', () => {
    const wrong = PAGES.filter(({ values }) => {
      const lines = values.get('headerLines')
      return lines !== undefined && !HEADER_LINES.includes(lines as number)
    })
    expect(wrong.map((page) => page.file)).toEqual([])
  })

  it('names a tier the page shell has', () => {
    const wrong = PAGES.filter(({ values }) => {
      const tier = values.get('tier')
      return tier !== undefined && !TIERS.includes(tier as string)
    })
    expect(wrong.map((page) => page.file)).toEqual([])
  })

  it('gives the two surface shapes only to a full-bleed page', () => {
    const wrong = PAGES.filter(({ values }) => {
      const shape = values.get('loading')
      return (
        (shape === 'inbox' || shape === 'workspace') && values.get('fullBleed') !== true
      )
    })
    expect(wrong.map((page) => page.file)).toEqual([])
  })

  it('declares the settings pages in the narrow tier of the settings layout', () => {
    const settings = PAGES.filter(({ file }) =>
      /routes\/_authenticated\/settings\/[a-z]+\.tsx$/u.test(file),
    )
    expect(settings.length).toBeGreaterThanOrEqual(8)
    expect(settings.filter(({ values }) => values.get('tier') !== 'narrow')).toEqual([])
  })
})
