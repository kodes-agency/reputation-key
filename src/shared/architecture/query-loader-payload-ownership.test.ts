import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const ROUTES_ROOT = join(ROOT, 'src', 'routes')

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    if (!entry.isFile() || !/\.(?:ts|tsx)$/u.test(entry.name)) return []
    if (/\.(?:test|stories)\.[^.]+$/u.test(entry.name)) return []
    return [path]
  })
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

function expressionReturnsFromLoader(sourceFile: ts.SourceFile): readonly ts.Node[] {
  const returns: ts.Node[] = []

  const inspectLoader = (initializer: ts.Expression): void => {
    if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return
    if (!ts.isBlock(initializer.body)) {
      returns.push(initializer.body)
      return
    }

    const visit = (node: ts.Node): void => {
      if (node !== initializer && ts.isFunctionLike(node)) return
      if (ts.isReturnStatement(node) && node.expression) returns.push(node)
      ts.forEachChild(node, visit)
    }
    visit(initializer.body)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'loader') {
      inspectLoader(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return returns
}

describe('TanStack Query loader payload ownership', () => {
  it('does not serialize a second copy of data already dehydrated in the Query cache', () => {
    const violations: string[] = []

    for (const file of routeFiles(ROUTES_ROOT)) {
      const source = readFileSync(file, 'utf8')
      if (!/ensure(?:Infinite)?QueryData/u.test(source)) continue

      // Loader data remains valid when the route consumes it explicitly or its
      // `head` callback needs it for SSR metadata. Otherwise Query owns the
      // payload: the loader may await/prime/redirect, but must return `void`.
      if (/useLoaderData\s*\(|\bloaderData\b/u.test(source)) continue

      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      )
      if (expressionReturnsFromLoader(sourceFile).length > 0) {
        violations.push(file.slice(ROOT.length + 1))
      }
    }

    expect(violations).toEqual([])
  })
})
