// S12 — does a tenant value actually restrict a repository statement?
//
// The tenant-predicate canary used to accept any mention of `organizationId`
// in a callable as its tenant predicate, so a projection key, a row mapper or
// an unused parameter let a tenant-free query through. This module answers the
// question the rule asks: is a statement on a tenant-owned table restricted to
// a tenant VALUE (`orgId`, `ctx.organizationId`, a row's `organizationId`)?
//
// A statement is a query-builder chain with a `.where(...)`, a raw `sql`
// statement, or a `resolvePortalContext(...)` lookup; it counts when it names a
// tenant-owned table. It is restricted when a tenant value sits in its
// predicate:
//   - the arguments of its `.where(...)`;
//   - an interpolation of the raw statement, or `organization_id = ${value}`;
//   - a variable or same-file helper the predicate is built from, followed only
//     where it stands for a predicate (`and(...conditions)`, `${scopeSql}`) or
//     is a key computed from the tenant (`const key = receiptKey(orgId, id)`),
//     never where it is a row that was merely read under the tenant;
//   - a predicate parameter (`where: SQL`), when every call of the callable, in
//     its file and in the files that import it, passes a restricted one.
//
// These do not restrict, and are not accepted:
//   - a tenant COLUMN on its own: `eq(a.organizationId, b.organizationId)` ties
//     two rows to the same tenant without naming one;
//   - a tenant value under a range or negated comparison (a keyset cursor);
//   - a branch of `or(...)` or of `cond ? a : b` unless every branch restricts
//     (`value === null ? isNull(column) : eq(column, value)` is one predicate);
//   - a predicate added to a condition list only inside an `if`.
//
// Known limits, on purpose. A callable is held to ONE restricted statement, so
// a second statement that finds its row by id passes beside it. The analysis
// trusts a tenant value or a predicate handed to a helper it cannot open
// (`baseWhere(table, orgId)`), does not see a builder chain without
// `.where(...)`, and reads SQL only next to an interpolation.

import ts from 'typescript'
import {
  type Binding,
  type NamedCallable,
  calleeName,
  callableSymbol,
  containsAwait,
  importedNames,
  isReference,
  isSqlJoin,
  isSqlTemplate,
  isUnconditionalWithin,
  methodName,
  namedCallables,
  ownNodes,
  returnedExpressions,
  scopeOf,
  sqlTargetsDatabaseTable,
  textBeforeSpan,
  unwrap,
  whereCallsOnSpine,
} from './source-syntax'
import {
  type TenantScope,
  type TenantTables,
  TENANT_NAME,
  createTenantScope,
} from './tenant-predicate-scope'

const TENANT_MENTION = /\borganization(?:Id|_id)\b/u
const SQL_STATEMENT = /\b(?:select|update|delete\s+from|insert\s+into)\b/iu
// `?,` and `?::uuid,`: an earlier member of the row value an interpolation sits in.
const ROW_VALUE_MEMBER = /\?,$/u
const CAST_ROW_VALUE_MEMBER = /\?::\w+,$/u
const RANGE_OPERATOR = /(?:[<>]=?|<>|!=)$/u
const TENANT_COLUMN_EQUALITY = /\borganization_id"?\s*(?:=|=\s*ANY\s*\(|IN\s*\()\s*$/iu
const TENANT_COLUMN_TIE = /\borganization_id"?\s*=\s*"?\w+"?\."?organization_id\b/iu
// An imported helper named like these builds or wraps a predicate.
const PREDICATE_HELPER = /(?:Where|Predicate|Scope|Conditions?|Filter)$/u

/** Drizzle operators whose arguments never restrict a statement to a tenant. */
const NON_RESTRICTING_OPERATORS: ReadonlySet<string> = new Set([
  'gt',
  'gte',
  'lt',
  'lte',
  'ne',
  'not',
  'notInArray',
  'isNull',
  'isNotNull',
  'like',
  'ilike',
  'notLike',
  'notIlike',
  'between',
  'notBetween',
])
const EQUALITY_OPERATORS: ReadonlySet<string> = new Set(['eq', 'inArray'])
const LIST_MUTATIONS: ReadonlySet<string> = new Set(['push', 'unshift'])
const EQUALITY_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])

export type { TenantTables }

export type SourceText = Readonly<{
  /** Repository-relative path. */
  file: string
  text: string
}>

export type CallableReport = Readonly<{
  symbol: string
  /** Statements of the callable that read or write a tenant-owned table. */
  tenantStatements: number
  /** How many of them a tenant value restricts. */
  restrictedStatements: number
  /** It compares two tenant values: `row.organizationId !== input.organizationId`. */
  comparesTenantValues: boolean
  /** It ties two rows on the tenant column: `a.organization_id = b.organization_id`. */
  tiesTenantColumns: boolean
  /** It reads or names a tenant column at all. */
  mentionsTenant: boolean
}>

/** Whether each call of `symbol` passes a restricted argument at `index`. */
type ArgumentVerdicts = (symbol: string, index: number) => readonly boolean[]

type RestrictionJudge = Readonly<{
  /**
   * True when a tenant value restricts what `node` stands for. `isPredicate`
   * is true while `node` is a predicate; only there is a variable or helper
   * followed to what it was built from.
   */
  restricts: (node: ts.Node, isPredicate: boolean) => boolean
  sqlTemplateRestricts: (node: ts.TaggedTemplateExpression) => boolean
  argumentVerdicts: ArgumentVerdicts
}>

type FileInspector = Readonly<{
  reports: () => readonly CallableReport[]
  importsName: (name: string) => boolean
  argumentVerdicts: ArgumentVerdicts
}>

/** The operator a scalar or row-value interpolation is compared with, whitespace removed. */
function textBeforeComparedValue(
  template: ts.TemplateExpression,
  spanIndex: number,
): string {
  let before = textBeforeSpan(template, spanIndex).replace(/\s+/gu, '')
  let shorter = before
  do {
    before = shorter
    shorter = before.replace(ROW_VALUE_MEMBER, '').replace(CAST_ROW_VALUE_MEMBER, '')
  } while (shorter !== before)
  return before.endsWith('(') ? before.slice(0, -1) : before
}

function followsRangeOperator(
  template: ts.TemplateExpression,
  spanIndex: number,
): boolean {
  return RANGE_OPERATOR.test(textBeforeComparedValue(template, spanIndex))
}

function isFunctionValue(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function keepsPredicate(node: ts.Node): boolean {
  return (
    ts.isSpreadElement(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node)
  )
}

function createRestrictionJudge(
  sourceFile: ts.SourceFile,
  scope: TenantScope,
  importerVerdicts: ArgumentVerdicts,
): RestrictionJudge {
  const predicateVerdicts = new Map<Binding, boolean>()
  const keyVerdicts = new Map<Binding, boolean>()

  /** `eq(reviews.organizationId, org.id)`: a tenant column held equal to a value. */
  function isTenantEquality(call: ts.CallExpression): boolean {
    if (!EQUALITY_OPERATORS.has(calleeName(call) ?? '')) return false
    const [left, right] = call.arguments
    if (left === undefined || right === undefined) return false
    return (
      (scope.isTenantColumn(left) && !scope.isColumnAccess(right)) ||
      (scope.isTenantColumn(right) && !scope.isColumnAccess(left))
    )
  }

  function writesTo(declaration: ts.VariableDeclaration, target: ts.Expression): boolean {
    return ts.isIdentifier(target) && scope.resolveBinding(target) === declaration
  }

  /** What `node` unconditionally assigns to, or pushes onto, the variable. */
  function writtenBy(
    node: ts.Node,
    declaration: ts.VariableDeclaration,
  ): readonly ts.Expression[] {
    if (!isUnconditionalWithin(node, scopeOf(declaration))) return []
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      writesTo(declaration, node.left)
    ) {
      return [node.right]
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      LIST_MUTATIONS.has(node.expression.name.text) &&
      writesTo(declaration, node.expression.expression)
    ) {
      return node.arguments
    }
    return []
  }

  function mutationsOf(declaration: ts.VariableDeclaration): readonly ts.Expression[] {
    const written: ts.Expression[] = []
    const visit = (node: ts.Node): void => {
      written.push(...writtenBy(node, declaration))
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(scopeOf(declaration), visit)
    return written
  }

  function functionRestricts(fn: ts.FunctionLikeDeclaration): boolean {
    return returnedExpressions(fn).some((expression) => restricts(expression, true))
  }

  function variableRestricts(declaration: ts.VariableDeclaration): boolean {
    const initializer =
      declaration.initializer === undefined ? undefined : unwrap(declaration.initializer)
    if (initializer !== undefined) {
      const restricted = isFunctionValue(initializer)
        ? functionRestricts(initializer)
        : restricts(initializer, true)
      if (restricted) return true
    }
    return mutationsOf(declaration).some((written) => restricts(written, true))
  }

  function callsOf(symbol: string): readonly ts.CallExpression[] {
    const calls: ts.CallExpression[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        (calleeName(node) === symbol || methodName(node) === symbol)
      ) {
        calls.push(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return calls
  }

  const argumentVerdicts: ArgumentVerdicts = (symbol, index) =>
    callsOf(symbol).map((call) => {
      const argument = call.arguments[index]
      return argument !== undefined && restricts(argument, true)
    })

  /** A predicate parameter restricts when every call passes a restricted predicate. */
  function parameterRestricts(parameter: ts.ParameterDeclaration): boolean {
    const symbol = callableSymbol(parameter.parent)
    if (symbol === null) return false
    const index = parameter.parent.parameters.indexOf(parameter)
    const verdicts = [
      ...argumentVerdicts(symbol, index),
      ...importerVerdicts(symbol, index),
    ]
    return verdicts.length > 0 && verdicts.every((restricted) => restricted)
  }

  function bindingRestricts(binding: Binding): boolean {
    const known = predicateVerdicts.get(binding)
    if (known !== undefined) return known
    // A cycle restricts nothing; the verdict is replaced once the binding is read.
    predicateVerdicts.set(binding, false)
    const verdict = bindingRestrictsUncached(binding)
    predicateVerdicts.set(binding, verdict)
    return verdict
  }

  function bindingRestrictsUncached(binding: Binding): boolean {
    if (ts.isFunctionDeclaration(binding)) return functionRestricts(binding)
    if (ts.isVariableDeclaration(binding)) return variableRestricts(binding)
    if (ts.isParameter(binding)) return parameterRestricts(binding)
    return false
  }

  /** `const key = receiptKey(orgId, id)`: a compared value computed from the tenant. */
  function isTenantKey(binding: Binding): boolean {
    const known = keyVerdicts.get(binding)
    if (known !== undefined) return known
    keyVerdicts.set(binding, false)
    const verdict =
      ts.isVariableDeclaration(binding) &&
      binding.initializer !== undefined &&
      !containsAwait(binding.initializer) &&
      restricts(binding.initializer, false)
    keyVerdicts.set(binding, verdict)
    return verdict
  }

  function identifierRestricts(identifier: ts.Identifier, isPredicate: boolean): boolean {
    if (scope.isTenantValue(identifier)) return true
    if (!isReference(identifier)) return false
    const binding = scope.resolveBinding(identifier)
    if (binding === undefined) return false
    if (isPredicate) return bindingRestricts(binding)
    // `eq(t.key, key)` compares the key itself; `eq(t.id, row.id)` only a field of a row.
    return !ts.isPropertyAccessExpression(identifier.parent) && isTenantKey(binding)
  }

  function spanRestricts(template: ts.TemplateExpression, index: number): boolean {
    const expression = template.templateSpans[index]!.expression
    if (followsRangeOperator(template, index)) return false
    const followsTenantColumn = TENANT_COLUMN_EQUALITY.test(
      textBeforeSpan(template, index),
    )
    if (followsTenantColumn && !scope.isColumnAccess(expression)) return true
    return restricts(expression, true)
  }

  function sqlTemplateRestricts(node: ts.TaggedTemplateExpression): boolean {
    const template = node.template
    if (!ts.isTemplateExpression(template)) return false
    return template.templateSpans.some((_, index) => spanRestricts(template, index))
  }

  function helperCallRestricts(
    call: ts.CallExpression,
    callee: ts.Identifier,
    isPredicate: boolean,
  ): boolean {
    if (identifierRestricts(callee, true)) return true
    const passesPredicates =
      isPredicate &&
      PREDICATE_HELPER.test(callee.text) &&
      scope.resolveBinding(callee) === undefined
    return call.arguments.some((argument) => restricts(argument, passesPredicates))
  }

  function namedCallRestricts(
    call: ts.CallExpression,
    callee: ts.Identifier,
    isPredicate: boolean,
  ): boolean {
    const name = callee.text
    if (NON_RESTRICTING_OPERATORS.has(name)) return false
    if (name === 'or') {
      return (
        call.arguments.length > 0 &&
        call.arguments.every((argument) => restricts(argument, isPredicate))
      )
    }
    if (name === 'and') {
      return call.arguments.some((argument) => restricts(argument, isPredicate))
    }
    return isTenantEquality(call) || helperCallRestricts(call, callee, isPredicate)
  }

  function callRestricts(call: ts.CallExpression, isPredicate: boolean): boolean {
    if (ts.isIdentifier(call.expression)) {
      return namedCallRestricts(call, call.expression, isPredicate)
    }
    const joinsPredicates = isPredicate && isSqlJoin(call)
    return (
      restricts(call.expression, false) ||
      call.arguments.some((argument) => restricts(argument, joinsPredicates))
    )
  }

  /** `value === null ? isNull(column) : eq(column, value)` is one null-safe equality. */
  function isNullArm(node: ts.Expression): boolean {
    const arm = unwrap(node)
    if (!ts.isCallExpression(arm) || calleeName(arm) !== 'isNull') return false
    const [column] = arm.arguments
    return column !== undefined && scope.isTenantColumn(column)
  }

  function conditionalRestricts(
    node: ts.ConditionalExpression,
    isPredicate: boolean,
  ): boolean {
    const whenTrue = restricts(node.whenTrue, isPredicate)
    const whenFalse = restricts(node.whenFalse, isPredicate)
    if (whenTrue && whenFalse) return true
    return (
      (whenTrue && isNullArm(node.whenFalse)) || (whenFalse && isNullArm(node.whenTrue))
    )
  }

  function restricts(node: ts.Node, isPredicate: boolean): boolean {
    if (ts.isTypeNode(node)) return false
    if (ts.isIdentifier(node)) return identifierRestricts(node, isPredicate)
    if (isSqlTemplate(node)) return sqlTemplateRestricts(node)
    if (ts.isCallExpression(node)) return callRestricts(node, isPredicate)
    if (ts.isConditionalExpression(node)) return conditionalRestricts(node, isPredicate)
    const childIsPredicate = isPredicate && keepsPredicate(node)
    return (
      ts.forEachChild(node, (child) =>
        restricts(child, childIsPredicate) ? true : undefined,
      ) === true
    )
  }

  return { restricts, sqlTemplateRestricts, argumentVerdicts }
}

function createFileInspector(
  sourceFile: ts.SourceFile,
  tables: TenantTables,
  importerVerdicts: ArgumentVerdicts,
): FileInspector {
  const scope = createTenantScope(sourceFile, tables)
  const judge = createRestrictionJudge(sourceFile, scope, importerVerdicts)
  const imports = importedNames(sourceFile)

  /** The SQL fragments an interpolation stands for, when this file defines them. */
  function fragmentsOf(expression: ts.Expression): readonly ts.Expression[] {
    const node = unwrap(expression)
    if (isSqlTemplate(node)) return [node]
    const callee = ts.isCallExpression(node) ? node.expression : node
    const binding = ts.isIdentifier(callee) ? scope.resolveBinding(callee) : undefined
    if (binding === undefined) return []
    if (ts.isFunctionDeclaration(binding)) return returnedExpressions(binding)
    if (!ts.isVariableDeclaration(binding) || binding.initializer === undefined) return []
    const initializer = unwrap(binding.initializer)
    return isFunctionValue(initializer) ? returnedExpressions(initializer) : [initializer]
  }

  /** A raw statement's text with the same-file fragments it interpolates. */
  function statementText(node: ts.TaggedTemplateExpression, seen: Set<ts.Node>): string {
    if (seen.has(node)) return ''
    seen.add(node)
    const template = node.template
    if (!ts.isTemplateExpression(template)) return template.text
    const spans = template.templateSpans.map((span) => {
      const fragments = fragmentsOf(span.expression)
        .map(unwrap)
        .filter(isSqlTemplate)
        .map((fragment) => statementText(fragment, seen))
      return `${fragments.join(' ')} ? ${span.literal.text}`
    })
    return `${template.head.text}${spans.join('')}`
  }

  function rawTargetsTenantTable(node: ts.TaggedTemplateExpression): boolean {
    return sqlTargetsDatabaseTable(
      statementText(node, new Set()),
      tables.tenantDatabaseNames,
    )
  }

  function namesTenantTable(node: ts.Node): boolean {
    if (ts.isIdentifier(node)) return scope.namesTenantTable(node)
    if (isSqlTemplate(node) && rawTargetsTenantTable(node)) return true
    return (
      ts.forEachChild(node, (child) => (namesTenantTable(child) ? true : undefined)) ===
      true
    )
  }

  /**
   * Whether a tenant value restricts the statement `node` is; null for a
   * statement on other tables, undefined when `node` is not a statement.
   */
  function statementVerdict(node: ts.Node): boolean | null | undefined {
    const wheres = whereCallsOnSpine(node)
    if (wheres.length > 0) {
      if (!namesTenantTable(node)) return null
      return wheres.some((where) =>
        where.arguments.some((argument) => judge.restricts(argument, true)),
      )
    }
    if (isSqlTemplate(node) && SQL_STATEMENT.test(node.template.getText(sourceFile))) {
      return namesTenantTable(node) ? judge.sqlTemplateRestricts(node) : null
    }
    if (ts.isCallExpression(node) && methodName(node) === 'resolvePortalContext') {
      return node.arguments.some((argument) => judge.restricts(argument, false))
    }
    return undefined
  }

  /** One verdict per tenant statement the callable owns; a nested named callable owns its own. */
  function tenantStatements(callable: ts.FunctionLikeDeclaration): readonly boolean[] {
    const verdicts: boolean[] = []
    const visit = (node: ts.Node): void => {
      if (node !== callable && callableSymbol(node) !== null) return
      const verdict = statementVerdict(node)
      // A statement is judged whole: what it nests is part of it.
      if (verdict === undefined) ts.forEachChild(node, visit)
      else if (verdict !== null) verdicts.push(verdict)
    }
    visit(callable)
    return verdicts
  }

  function isTenantOperand(node: ts.Expression): boolean {
    const operand = unwrap(node)
    if (ts.isIdentifier(operand)) return TENANT_NAME.test(operand.text)
    return (
      ts.isPropertyAccessExpression(operand) &&
      TENANT_NAME.test(operand.name.text) &&
      !scope.isColumnAccess(operand)
    )
  }

  function comparesTenantValues(node: ts.Node): boolean {
    return (
      ts.isBinaryExpression(node) &&
      EQUALITY_TOKENS.has(node.operatorToken.kind) &&
      isTenantOperand(node.left) &&
      isTenantOperand(node.right)
    )
  }

  function tiesTenantColumns(node: ts.Node): boolean {
    if (!ts.isCallExpression(node) || calleeName(node) !== 'eq') return false
    const [left, right] = node.arguments
    return (
      left !== undefined &&
      right !== undefined &&
      scope.isTenantColumn(left) &&
      scope.isTenantColumn(right)
    )
  }

  function report(callable: NamedCallable): CallableReport {
    const verdicts = tenantStatements(callable.node)
    const nodes = ownNodes(callable.node)
    const rawSql = nodes
      .filter(isSqlTemplate)
      .map((node) => statementText(node, new Set()))
      .join('\n')
    return {
      symbol: callable.symbol,
      tenantStatements: verdicts.length,
      restrictedStatements: verdicts.filter((restricted) => restricted).length,
      comparesTenantValues: nodes.some(comparesTenantValues),
      tiesTenantColumns: TENANT_COLUMN_TIE.test(rawSql) || nodes.some(tiesTenantColumns),
      mentionsTenant: TENANT_MENTION.test(callable.node.getText(sourceFile)),
    }
  }

  return {
    reports: () => namedCallables(sourceFile).map(report),
    importsName: (name) => imports.has(name),
    argumentVerdicts: judge.argumentVerdicts,
  }
}

/**
 * Every named callable of every source, with how many statements it runs on a
 * tenant-owned table and how many of them a tenant value restricts. The sources
 * are read together so a predicate parameter can be followed to its callers.
 */
export function inspectTenantStatements(
  sources: readonly SourceText[],
  tables: TenantTables,
): ReadonlyMap<string, readonly CallableReport[]> {
  const inspectors = new Map<string, FileInspector>()
  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.file,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const importerVerdicts: ArgumentVerdicts = (symbol, index) =>
      [...inspectors]
        .filter(
          ([file, inspector]) => file !== source.file && inspector.importsName(symbol),
        )
        .flatMap(([, inspector]) => inspector.argumentVerdicts(symbol, index))
    inspectors.set(source.file, createFileInspector(sourceFile, tables, importerVerdicts))
  }
  return new Map(
    [...inspectors].map(([file, inspector]) => [file, inspector.reports()] as const),
  )
}
