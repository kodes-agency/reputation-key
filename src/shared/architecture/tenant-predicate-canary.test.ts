import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { getTableColumns, getTableName, isTable } from 'drizzle-orm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as schema from '#/shared/db/schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import { walk } from '#/shared/testing/source-tree'
import {
  isTenantPredicateExempt,
  TENANT_PREDICATE_EXEMPTIONS,
} from './tenant-predicate-exemptions'

const ROOT = process.cwd()
const CONTEXTS_ROOT = join(ROOT, 'src', 'contexts')

type TenantTableAuthority = Readonly<{
  exportNames: ReadonlySet<string>
  databaseNames: ReadonlySet<string>
}>

type NamedCallable = Readonly<{
  symbol: string
  node: ts.FunctionLikeDeclaration
}>

function tenantOwnedTables(): TenantTableAuthority {
  const exportNames = new Set<string>()
  const databaseNames = new Set<string>()

  for (const row of DATA_FATE_AUTHORITY) {
    if (row.owner === 'identity' || row.owner === 'platform') continue

    const value = schema[row.exportName as keyof typeof schema]
    if (!isTable(value)) continue
    if (
      !Object.values(getTableColumns(value)).some(
        (column) => column.name === 'organization_id',
      )
    ) {
      continue
    }

    exportNames.add(row.exportName)
    databaseNames.add(getTableName(value))
  }

  return { exportNames, databaseNames }
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return null
}

function callableSymbol(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null
  if (ts.isMethodDeclaration(node)) return propertyName(node.name)
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return null

  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text
  }
  if (ts.isPropertyAssignment(node.parent)) return propertyName(node.parent.name)
  return ts.isFunctionExpression(node) ? (node.name?.text ?? null) : null
}

function namedCallables(sourceFile: ts.SourceFile): readonly NamedCallable[] {
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

function tableIdentifiersIn(
  sourceFile: ts.SourceFile,
  authority: TenantTableAuthority,
): ReadonlySet<string> {
  const identifiers = new Set(authority.exportNames)

  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const importedName = node.propertyName?.text ?? node.name.text
      if (authority.exportNames.has(importedName)) identifiers.add(node.name.text)
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer) &&
      identifiers.has(node.initializer.text)
    ) {
      identifiers.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return identifiers
}

function sqlTargetsDatabaseTable(
  text: string,
  databaseNames: ReadonlySet<string>,
): boolean {
  for (const name of databaseNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const target = `(?:(?:"?public"?\\.)?"?${escaped}"?)`
    if (
      new RegExp(
        `\\b(?:delete\\s+from|from|join|update|into)\\s+${target}(?![A-Za-z0-9_])`,
        'iu',
      ).test(text)
    ) {
      return true
    }
  }
  return false
}

function isWhereCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'where'
  )
}

function isSqlTemplate(node: ts.Node): node is ts.TaggedTemplateExpression {
  return (
    ts.isTaggedTemplateExpression(node) &&
    ts.isIdentifier(node.tag) &&
    node.tag.text === 'sql'
  )
}

function isPotentialTenantScopeHelper(name: string): boolean {
  return /where|scope|tenant|filter|predicate|condition/iu.test(name)
}

function hasTenantProof(
  callable: NamedCallable,
  sourceFile: ts.SourceFile,
  helpers: ReadonlyMap<string, readonly NamedCallable[]>,
  visited: Set<number> = new Set(),
): boolean {
  if (visited.has(callable.node.pos)) return false
  visited.add(callable.node.pos)

  let found = callable.node.parameters.some((parameter) => {
    const name = parameter.name.getText(sourceFile)
    const type = parameter.type?.getText(sourceFile) ?? ''
    return (
      /\b(?:organizationId|organizationIds|organization_id|orgId|orgIds)\b/u.test(name) ||
      /\bOrganizationId\b/u.test(type) ||
      ((name === 'scope' || name === 'where') &&
        (type.includes('SQL') || /Where$/u.test(callable.symbol)))
    )
  })
  const calledHelpers = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (node !== callable.node && callableSymbol(node) !== null) return

    if (
      ts.isIdentifier(node) &&
      (node.text === 'organizationId' ||
        node.text === 'organizationIds' ||
        node.text === 'organization_id' ||
        node.text === 'orgId' ||
        node.text === 'orgIds' ||
        node.text === 'OrganizationId')
    ) {
      found = true
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const helperName = node.expression.text
      if (helperName === 'baseWhere' || helperName === 'tenantWhere') found = true
      if (isPotentialTenantScopeHelper(helperName)) calledHelpers.add(helperName)
    }
    if (
      isSqlTemplate(node) &&
      /\b(?:organizationId|organizationIds|organization_id|orgId|orgIds)\b/u.test(
        node.template.getText(sourceFile),
      )
    ) {
      found = true
    }

    ts.forEachChild(node, visit)
  }
  visit(callable.node)
  if (found) return true

  for (const helperName of calledHelpers) {
    for (const helper of helpers.get(helperName) ?? []) {
      if (hasTenantProof(helper, sourceFile, helpers, visited)) return true
    }
  }
  return false
}

function inspectCallable(
  callable: NamedCallable,
  sourceFile: ts.SourceFile,
  authority: TenantTableAuthority,
  tableIdentifiers: ReadonlySet<string>,
  helpers: ReadonlyMap<string, readonly NamedCallable[]>,
): Readonly<{ queriesTenantTable: boolean; hasTenantToken: boolean }> {
  let hasWhere = false
  let hasSqlStatement = false
  let referencesTenantTable = false

  const visit = (node: ts.Node): void => {
    if (node !== callable.node && callableSymbol(node) !== null) return

    if (isWhereCall(node)) hasWhere = true
    if (ts.isIdentifier(node) && tableIdentifiers.has(node.text)) {
      referencesTenantTable = true
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'resolvePortalContext'
    ) {
      hasSqlStatement = true
      referencesTenantTable = true
    }
    if (isSqlTemplate(node)) {
      const sqlText = node.template.getText(sourceFile)
      if (/\b(?:select|update|delete\s+from|insert\s+into)\b/iu.test(sqlText)) {
        hasSqlStatement = true
      }
      if (sqlTargetsDatabaseTable(sqlText, authority.databaseNames)) {
        referencesTenantTable = true
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(callable.node)

  return {
    queriesTenantTable: (hasWhere || hasSqlStatement) && referencesTenantTable,
    hasTenantToken: hasTenantProof(callable, sourceFile, helpers),
  }
}

function tenantPredicateViolations(
  file: string,
  source: string,
  authority: TenantTableAuthority,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const tableIdentifiers = tableIdentifiersIn(sourceFile, authority)
  const callables = namedCallables(sourceFile)
  const helpers = new Map<string, NamedCallable[]>()
  for (const callable of callables) {
    const parent = callable.node.parent
    if (
      !ts.isFunctionDeclaration(callable.node) &&
      !(ts.isVariableDeclaration(parent) && parent.initializer === callable.node)
    ) {
      continue
    }
    const existing = helpers.get(callable.symbol) ?? []
    existing.push(callable)
    helpers.set(callable.symbol, existing)
  }

  const violations = new Set<string>()
  for (const callable of callables) {
    const inspection = inspectCallable(
      callable,
      sourceFile,
      authority,
      tableIdentifiers,
      helpers,
    )
    if (!inspection.queriesTenantTable) continue
    if (inspection.hasTenantToken && !isTenantPredicateExempt(file, callable.symbol)) {
      continue
    }
    violations.add(`${file}#${callable.symbol}`)
  }

  return [...violations].sort()
}

function infrastructureFiles(): readonly string[] {
  return walk(CONTEXTS_ROOT)
    .filter(
      (file) =>
        file.includes(`${sep}infrastructure${sep}`) &&
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        !file.endsWith('.d.ts'),
    )
    .sort()
}

describe('canary: every tenant-owned repository query carries a tenant predicate (S12)', () => {
  it('flags a synthetic unscoped tenant-owned query', () => {
    const authority = tenantOwnedTables()
    expect(authority.exportNames.has('reviews')).toBe(true)

    const violations = tenantPredicateViolations(
      'synthetic-unscoped.repository.ts',
      `const findReview = async (reviewId: string) =>
        db.select().from(reviews).where(eq(reviews.id, reviewId))`,
      authority,
    )

    expect(violations.length).toBeGreaterThan(0)
    expect(violations).toEqual(['synthetic-unscoped.repository.ts#findReview'])
  })

  it('matches every detected tenant-free query exactly to the reviewed registry', () => {
    const authority = tenantOwnedTables()
    const violations = infrastructureFiles()
      .flatMap((absoluteFile) => {
        const file = relative(ROOT, absoluteFile).split(sep).join('/')
        return tenantPredicateViolations(
          file,
          readFileSync(absoluteFile, 'utf8'),
          authority,
        )
      })
      .sort()
    const registered = TENANT_PREDICATE_EXEMPTIONS.map(
      (entry) => `${entry.file}#${entry.symbol}`,
    ).sort()

    expect(violations).toEqual(registered)
  })

  it('keeps every exemption unique, explained, and attached to a real callable', () => {
    const seen = new Set<string>()
    const duplicateEntries: string[] = []
    const shortReasons: string[] = []
    const invalidPendingReasons: string[] = []
    const staleEntries: string[] = []

    for (const entry of TENANT_PREDICATE_EXEMPTIONS) {
      const key = `${entry.file}#${entry.symbol}`
      if (seen.has(key)) duplicateEntries.push(key)
      seen.add(key)
      if (entry.reason.length < 40) shortReasons.push(key)
      if (
        entry.category === 'UNSCOPED-PENDING' &&
        !/^UNSCOPED-PENDING: src\/contexts\/.+\.ts:\d+ — \S/u.test(entry.reason)
      ) {
        invalidPendingReasons.push(key)
      }

      let symbols: ReadonlySet<string>
      try {
        const source = readFileSync(join(ROOT, entry.file), 'utf8')
        const sourceFile = ts.createSourceFile(
          entry.file,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        )
        symbols = new Set(namedCallables(sourceFile).map((callable) => callable.symbol))
      } catch {
        staleEntries.push(key)
        continue
      }
      if (!symbols.has(entry.symbol)) staleEntries.push(key)
    }

    expect({
      duplicateEntries,
      invalidPendingReasons,
      shortReasons,
      staleEntries,
    }).toEqual({
      duplicateEntries: [],
      invalidPendingReasons: [],
      shortReasons: [],
      staleEntries: [],
    })
  })
})
