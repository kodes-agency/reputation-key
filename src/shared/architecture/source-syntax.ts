// TypeScript syntax helpers for the static-source canaries in this directory.
//
// Everything here reads syntax and knows nothing about the rule a canary
// enforces: the tenant-predicate rule lives in tenant-predicate-constraint.ts,
// the Start compiler's client residue in start-client-residue.ts.

import ts from 'typescript'

/** A declaration an identifier can resolve to inside one file. */
export type Binding =
  | ts.VariableDeclaration
  | ts.ParameterDeclaration
  | ts.BindingElement
  | ts.FunctionDeclaration

export type NamedCallable = Readonly<{
  symbol: string
  node: ts.FunctionLikeDeclaration
}>

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return null
}

/** The name a function, method or function-valued binding is known by, if any. */
export function callableSymbol(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null
  if (ts.isMethodDeclaration(node)) return propertyName(node.name)
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return null

  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text
  }
  if (ts.isPropertyAssignment(node.parent)) return propertyName(node.parent.name)
  return ts.isFunctionExpression(node) ? (node.name?.text ?? null) : null
}

export function namedCallables(sourceFile: ts.SourceFile): readonly NamedCallable[] {
  const callables: NamedCallable[] = []
  const visit = (node: ts.Node): void => {
    const symbol = callableSymbol(node)
    // ts.isFunctionLike also admits signature-only nodes (e.g. a constructor
    // type), which carry no body to inspect.
    if (symbol !== null && ts.isFunctionLike(node) && 'body' in node) {
      callables.push({ symbol, node: node as ts.FunctionLikeDeclaration })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return callables
}

function isScopeBoundary(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isFunctionLike(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node) ||
    ts.isCatchClause(node) ||
    ts.isIterationStatement(node, false)
  )
}

/** The block, function or file a declaration is visible in. */
export function scopeOf(node: ts.Node): ts.Node {
  let current = node.parent
  while (!isScopeBoundary(current)) current = current.parent
  return current
}

function isBinding(node: ts.Node): node is Binding {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node)
  )
}

export function bindingsByName(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, readonly Binding[]> {
  const index = new Map<string, Binding[]>()
  const visit = (node: ts.Node): void => {
    if (isBinding(node) && node.name !== undefined && ts.isIdentifier(node.name)) {
      index.set(node.name.text, [...(index.get(node.name.text) ?? []), node])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return index
}

/** Local name → imported name, for every named import of the file. */
export function importedNames(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const imported = new Map<string, string>()
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      imported.set(node.name.text, node.propertyName?.text ?? node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imported
}

/** The expression under parentheses, `!`, `as`, `satisfies` and `await`. */
export function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/** `a` in `a.b.c` and in `a[0].b`. */
export function leftmostIdentifier(node: ts.Expression): ts.Identifier | null {
  let current = unwrap(node)
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    current = unwrap(current.expression)
  }
  return ts.isIdentifier(current) ? current : null
}

/** `eq` in `eq(a, b)`. */
export function calleeName(call: ts.CallExpression): string | null {
  return ts.isIdentifier(call.expression) ? call.expression.text : null
}

/** `where` in `query.where(a)`. */
export function methodName(node: ts.Node): string | null {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : null
}

export function isSqlTemplate(node: ts.Node): node is ts.TaggedTemplateExpression {
  return (
    ts.isTaggedTemplateExpression(node) &&
    ts.isIdentifier(node.tag) &&
    node.tag.text === 'sql'
  )
}

/** `sql.join(conditions, sql` AND `)` joins predicates into one. */
export function isSqlJoin(call: ts.CallExpression): boolean {
  return (
    methodName(call) === 'join' &&
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'sql'
  )
}

/** The `.where(...)` calls on the spine of a query-builder chain, outermost first. */
export function whereCallsOnSpine(node: ts.Node): readonly ts.CallExpression[] {
  const found: ts.CallExpression[] = []
  let current: ts.Node = node
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression)
  ) {
    if (current.expression.name.text === 'where') found.push(current)
    current = current.expression.expression
  }
  return found
}

/** An identifier that reads a binding, as opposed to naming a member or declaring one. */
export function isReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent
  if (ts.isShorthandPropertyAssignment(parent)) return true
  if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false
  return (parent as { name?: ts.Node }).name !== identifier
}

/** A template's literal parts: the head, then the text after each interpolation. */
export function templateLiterals(template: ts.TemplateLiteral): readonly string[] {
  if (!ts.isTemplateExpression(template)) return [template.text]
  return [template.head.text, ...template.templateSpans.map((span) => span.literal.text)]
}

/** The literal text left of an interpolation, with earlier interpolations as `?`. */
export function textBeforeSpan(
  template: ts.TemplateExpression,
  spanIndex: number,
): string {
  const earlier = template.templateSpans
    .slice(0, spanIndex)
    .map((span) => `?${span.literal.text}`)
    .join('')
  return `${template.head.text}${earlier}`
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  )
}

/** `a && b`, `a || b`, `a ?? b`: the right side is evaluated only sometimes. */
export function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

export function isFunctionValue(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function isConditionalAncestor(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node) ||
    ts.isIterationStatement(node, false) ||
    ts.isFunctionLike(node) ||
    isLogicalExpression(node)
  )
}

/** True when `node` runs on every path through `scope`. */
export function isUnconditionalWithin(node: ts.Node, scope: ts.Node): boolean {
  let current = node.parent
  while (current !== scope) {
    if (isConditionalAncestor(current)) return false
    current = current.parent
  }
  return true
}

/** What a function can return: its expression body, or each `return` of its block. */
export function returnedExpressions(
  fn: ts.FunctionLikeDeclaration,
): readonly ts.Expression[] {
  const body = fn.body
  if (body === undefined) return []
  if (!ts.isBlock(body)) return [body]
  const returned: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      returned.push(node.expression)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(body, visit)
  return returned
}

export function containsAwait(node: ts.Node): boolean {
  if (ts.isAwaitExpression(node)) return true
  if (ts.isFunctionLike(node)) return false
  return (
    ts.forEachChild(node, (child) => (containsAwait(child) ? true : undefined)) === true
  )
}

/** Every node of a callable that belongs to it, a nested named callable excluded. */
export function ownNodes(callable: ts.FunctionLikeDeclaration): readonly ts.Node[] {
  const nodes: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    if (node !== callable && callableSymbol(node) !== null) return
    nodes.push(node)
    ts.forEachChild(node, visit)
  }
  visit(callable)
  return nodes
}

const SQL_TABLE_REFERENCE = /\b(?:delete\s+from|from|join|update|into)\s+(\w+)/giu

/** True when raw SQL reads from, joins or writes one of the named tables. */
export function sqlTargetsDatabaseTable(
  text: string,
  databaseNames: ReadonlySet<string>,
): boolean {
  // `"public"."reviews"` and `reviews` name the same table.
  const unqualified = text.replace(/"/gu, '').replace(/\bpublic\./giu, '')
  for (const [, table] of unqualified.matchAll(SQL_TABLE_REFERENCE)) {
    if (table !== undefined && databaseNames.has(table.toLowerCase())) return true
  }
  return false
}
