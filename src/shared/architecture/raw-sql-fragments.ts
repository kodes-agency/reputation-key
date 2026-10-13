// S12 — what an interpolation of a raw SQL statement stands for.
//
// `${orgId}` is a value; `${scopeSql}` is SQL the statement is built from. The
// tenant-predicate rule (tenant-predicate-constraint.ts) reads them differently:
// a value restricts only where it is compared, SQL wherever it is spliced in.
// This module tells the two apart, and finds the `sql` templates a spliced-in
// fragment was written as, through the variables and helpers of the same file.

import ts from 'typescript'
import {
  type Binding,
  isFunctionValue,
  isLogicalExpression,
  isSqlJoin,
  isSqlTemplate,
  returnedExpressions,
  unwrap,
} from './source-syntax'
import type { TenantScope } from './tenant-predicate-scope'

export type FragmentReader = Readonly<{
  /** The `sql` templates an interpolation stands for, where this file writes them. */
  templatesOf: (expression: ts.Expression) => readonly ts.TaggedTemplateExpression[]
  /**
   * True for SQL the statement is built from: `${scopeSql}`, `${and(...)}`,
   * `${tenantScope(ctx)}`. False for a value: `${orgId}`, `${key}`,
   * `${unbrand(orgId)}`.
   */
  standsForSql: (expression: ts.Expression) => boolean
}>

/**
 * `buildsSql` says whether a function this file does not define returns SQL,
 * going by its name: a query operator, or a helper named like a predicate.
 */
export function createFragmentReader(
  scope: Pick<TenantScope, 'resolveBinding' | 'isTenantValue'>,
  buildsSql: (functionName: string) => boolean,
): FragmentReader {
  function templatesReturned(
    fn: ts.FunctionLikeDeclaration,
    seen: Set<ts.Node>,
  ): readonly ts.TaggedTemplateExpression[] {
    return returnedExpressions(fn).flatMap((expression) => templatesIn(expression, seen))
  }

  function templatesBound(
    binding: Binding | undefined,
    seen: Set<ts.Node>,
  ): readonly ts.TaggedTemplateExpression[] {
    if (binding === undefined) return []
    if (ts.isFunctionDeclaration(binding)) return templatesReturned(binding, seen)
    if (!ts.isVariableDeclaration(binding) || binding.initializer === undefined) return []
    const initializer = unwrap(binding.initializer)
    return isFunctionValue(initializer)
      ? templatesReturned(initializer, seen)
      : templatesIn(initializer, seen)
  }

  function templatesIn(
    expression: ts.Expression,
    seen: Set<ts.Node>,
  ): readonly ts.TaggedTemplateExpression[] {
    const node = unwrap(expression)
    if (seen.has(node)) return []
    seen.add(node)
    if (isSqlTemplate(node)) return [node]
    if (ts.isConditionalExpression(node)) {
      return [...templatesIn(node.whenTrue, seen), ...templatesIn(node.whenFalse, seen)]
    }
    const named = ts.isCallExpression(node) ? node.expression : node
    return ts.isIdentifier(named) ? templatesBound(scope.resolveBinding(named), seen) : []
  }

  function returnsSql(fn: ts.FunctionLikeDeclaration, seen: Set<ts.Node>): boolean {
    return returnedExpressions(fn).some((expression) => isSql(expression, seen))
  }

  function bindingIsSql(binding: Binding, seen: Set<ts.Node>): boolean {
    if (ts.isFunctionDeclaration(binding)) return returnsSql(binding, seen)
    // A parameter or a destructured member: its callers say what it holds.
    if (!ts.isVariableDeclaration(binding)) return true
    if (binding.initializer === undefined) return false
    const initializer = unwrap(binding.initializer)
    return isFunctionValue(initializer)
      ? returnsSql(initializer, seen)
      : isSql(initializer, seen)
  }

  function callIsSql(call: ts.CallExpression, seen: Set<ts.Node>): boolean {
    if (isSqlJoin(call)) return true
    const callee = call.expression
    if (!ts.isIdentifier(callee)) return false
    const binding = scope.resolveBinding(callee)
    return binding === undefined ? buildsSql(callee.text) : bindingIsSql(binding, seen)
  }

  function isSql(expression: ts.Expression, seen: Set<ts.Node>): boolean {
    const node = unwrap(expression)
    if (seen.has(node)) return false
    seen.add(node)
    if (isSqlTemplate(node)) return true
    if (ts.isCallExpression(node)) return callIsSql(node, seen)
    if (ts.isConditionalExpression(node)) {
      return isSql(node.whenTrue, seen) || isSql(node.whenFalse, seen)
    }
    if (isLogicalExpression(node))
      return isSql(node.left, seen) || isSql(node.right, seen)
    if (!ts.isIdentifier(node) || scope.isTenantValue(node)) return false
    const binding = scope.resolveBinding(node)
    return binding !== undefined && bindingIsSql(binding, seen)
  }

  return {
    templatesOf: (expression) => templatesIn(expression, new Set()),
    standsForSql: (expression) => isSql(expression, new Set()),
  }
}
