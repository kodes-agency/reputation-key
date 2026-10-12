import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  bindingsByName,
  importedNames,
  isReference,
  isUnconditionalWithin,
  leftmostIdentifier,
  namedCallables,
  ownNodes,
  returnedExpressions,
  scopeOf,
  sqlTargetsDatabaseTable,
  textBeforeSpan,
  whereCallsOnSpine,
} from './source-syntax'

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('example.ts', text, ts.ScriptTarget.Latest, true)
}

/** Every node of the file for which `matches` holds, in source order. */
function nodesWhere<T extends ts.Node>(
  sourceFile: ts.SourceFile,
  matches: (node: ts.Node) => node is T,
): readonly T[] {
  const found: T[] = []
  const visit = (node: ts.Node): void => {
    if (matches(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function identifiersNamed(
  sourceFile: ts.SourceFile,
  name: string,
): readonly ts.Identifier[] {
  return nodesWhere(sourceFile, ts.isIdentifier).filter((node) => node.text === name)
}

function callableNamed(sourceFile: ts.SourceFile, symbol: string) {
  const callable = namedCallables(sourceFile).find((entry) => entry.symbol === symbol)
  if (callable === undefined) throw new Error(`no callable named ${symbol}`)
  return callable.node
}

describe('source syntax helpers', () => {
  it('names functions, methods and function-valued bindings', () => {
    const sourceFile = parse(`
      function declared() {}
      const arrow = () => 1
      const repository = {
        property: async () => 2,
        method() { return [1].map((value) => value) },
      }
      type Signature = { build(): void }
    `)

    expect(namedCallables(sourceFile).map((callable) => callable.symbol)).toEqual([
      'declared',
      'arrow',
      'property',
      'method',
    ])
  })

  it('finds the where calls on a builder chain and none inside its arguments', () => {
    const sourceFile = parse(`
      const rows = db.select().from(t).where(a).limit(1)
      const nested = exists(db.select().from(t).where(b))
    `)
    const [chain, nested] = nodesWhere(sourceFile, ts.isVariableDeclaration).map(
      (declaration) => declaration.initializer,
    )

    expect(chain === undefined ? [] : whereCallsOnSpine(chain)).toHaveLength(1)
    expect(nested === undefined ? [] : whereCallsOnSpine(nested)).toHaveLength(0)
  })

  it('tells a read of a binding from a member name and a declaration', () => {
    const sourceFile = parse(`
      const organizationId = input.organizationId
      const row = { organizationId, other: organizationId }
    `)

    expect(identifiersNamed(sourceFile, 'organizationId').map(isReference)).toEqual([
      false, // the declaration
      false, // the member read off \`input\`
      true, // the shorthand property
      true, // the property value
    ])
    expect(identifiersNamed(sourceFile, 'other').map(isReference)).toEqual([false])
  })

  it('resolves a declaration to the block it is visible in', () => {
    const sourceFile = parse(`
      const outer = 1
      function build(parameter: string) {
        const inner = parameter
        return inner
      }
    `)
    const bindings = bindingsByName(sourceFile)
    const scopeKind = (name: string) => {
      const [binding] = bindings.get(name) ?? []
      if (binding === undefined) throw new Error(`no binding named ${name}`)
      return ts.SyntaxKind[scopeOf(binding).kind]
    }

    expect(scopeKind('outer')).toBe('SourceFile')
    expect(scopeKind('inner')).toBe('Block')
    expect(scopeKind('parameter')).toBe('FunctionDeclaration')
  })

  it('lists named imports by their local name', () => {
    const sourceFile = parse(`
      import { reviews as r, replies } from '#/shared/db/schema'
      import defaultExport from './elsewhere'
    `)

    expect([...importedNames(sourceFile)]).toEqual([
      ['r', 'reviews'],
      ['replies', 'replies'],
    ])
  })

  it('finds the root of a member chain through casts and element access', () => {
    const sourceFile = parse(`const value = (rows[0]!.review as Review).organizationId`)
    const [declaration] = nodesWhere(sourceFile, ts.isVariableDeclaration)

    expect(
      declaration?.initializer === undefined
        ? null
        : leftmostIdentifier(declaration.initializer)?.text,
    ).toBe('rows')
  })

  it('separates what always runs in a scope from what a branch or callback runs', () => {
    const sourceFile = parse(`
      function build(flag: boolean) {
        conditions.push(always)
        if (flag) conditions.push(sometimes)
        rows.forEach(() => conditions.push(perRow))
        flag && conditions.push(shortCircuit)
      }
    `)
    const body = callableNamed(sourceFile, 'build').body
    if (body === undefined) throw new Error('build has no body')
    const unconditional = (name: string): boolean => {
      const [identifier] = identifiersNamed(sourceFile, name)
      if (identifier === undefined) throw new Error(`no identifier named ${name}`)
      return isUnconditionalWithin(identifier, body)
    }

    expect({
      always: unconditional('always'),
      sometimes: unconditional('sometimes'),
      perRow: unconditional('perRow'),
      shortCircuit: unconditional('shortCircuit'),
    }).toEqual({ always: true, sometimes: false, perRow: false, shortCircuit: false })
  })

  it('collects what a function returns, not what its callbacks return', () => {
    const sourceFile = parse(`
      const expressionBody = () => first
      function blockBody(kind: string) {
        const mapped = rows.map(() => { return ignored })
        if (kind === 'a') return second
        return third
      }
    `)
    const returned = (symbol: string): readonly string[] =>
      returnedExpressions(callableNamed(sourceFile, symbol)).map((expression) =>
        expression.getText(sourceFile),
      )

    expect(returned('expressionBody')).toEqual(['first'])
    expect(returned('blockBody')).toEqual(['second', 'third'])
  })

  it('leaves a nested named callable out of its parent', () => {
    const sourceFile = parse(`
      function parent() {
        const helper = () => inner
        return [1].map(() => outer)
      }
    `)
    const owned = ownNodes(callableNamed(sourceFile, 'parent'))
      .filter(ts.isIdentifier)
      .map((identifier) => identifier.text)

    expect(owned).toContain('outer')
    expect(owned).not.toContain('inner')
  })

  it('reads the SQL text left of an interpolation', () => {
    const sourceFile = parse(
      'const statement = sql`SELECT 1 FROM t WHERE (a, b) > (${first}, ${second})`',
    )
    const [template] = nodesWhere(sourceFile, ts.isTemplateExpression)
    if (template === undefined) throw new Error('no template')

    expect(textBeforeSpan(template, 0)).toBe('SELECT 1 FROM t WHERE (a, b) > (')
    expect(textBeforeSpan(template, 1)).toBe('SELECT 1 FROM t WHERE (a, b) > (?, ')
  })

  it.each([
    ['SELECT id FROM reviews WHERE id = $1', true],
    ['SELECT id FROM "public"."reviews" AS r', true],
    ['DELETE FROM reviews', true],
    ['UPDATE "reviews" SET rating = 1', true],
    ['INSERT INTO reviews (id) VALUES ($1)', true],
    ['SELECT 1 FROM replies JOIN reviews ON true', true],
    ['SELECT id FROM reviews_archive', false],
    ['SELECT reviews FROM summaries', false],
    ['SELECT transaction_timestamp()', false],
  ])('decides whether %s targets the reviews table', (statement, expected) => {
    expect(sqlTargetsDatabaseTable(statement, new Set(['reviews']))).toBe(expected)
  })
})
