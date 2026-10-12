// S12 — what the names in one repository file stand for.
//
// The tenant-predicate rule (tenant-predicate-constraint.ts) turns on one
// distinction: `reviews.organizationId` is a tenant COLUMN, `ctx.organizationId`
// is a tenant VALUE. Telling them apart needs to know which identifiers name a
// table — an import of the schema, `const r = reviews`, `alias(reviews, 'r')`,
// a derived table — and which name anything else. This module answers that for
// one source file.

import ts from 'typescript'
import {
  type Binding,
  bindingsByName,
  calleeName,
  importedNames,
  isReference,
  leftmostIdentifier,
  methodName,
  scopeOf,
  unwrap,
} from './source-syntax'

/** The spellings a tenant column or a tenant value goes by. */
export const TENANT_NAME =
  /^(?:organizationId|organizationIds|organization_id|orgId|orgIds)$/u
/** How a parameter or variable that holds a tenant is typed, whitespace removed. */
const TENANT_TYPES: ReadonlySet<string> = new Set([
  'OrganizationId',
  'OrganizationId[]',
  'readonlyOrganizationId[]',
  'ReadonlyArray<OrganizationId>',
])
const ABSENT_TYPES: ReadonlySet<string> = new Set(['null', 'undefined'])
const TABLE_ALIAS_FUNCTIONS: ReadonlySet<string> = new Set(['alias', 'aliasedTable'])
/** A subquery or CTE given a name with `.as('sq')`: a table, but no schema table. */
const DERIVED_TABLE = ''

export type TenantTables = Readonly<{
  /** Every Drizzle table the schema exports, by export name. */
  allExportNames: ReadonlySet<string>
  /** The tenant-owned ones the canary answers for. */
  tenantExportNames: ReadonlySet<string>
  tenantDatabaseNames: ReadonlySet<string>
}>

export type TenantScope = Readonly<{
  /** The declaration an identifier reads, when this file declares it. */
  resolveBinding: (reference: ts.Identifier) => Binding | undefined
  /** True when the identifier names a tenant-owned table. */
  namesTenantTable: (identifier: ts.Identifier) => boolean
  /** `reviews.rating`, `r.id`: a member read off a table. */
  isColumnAccess: (node: ts.Expression) => boolean
  /** `reviews.organizationId`. */
  isTenantColumn: (node: ts.Expression) => boolean
  /** `orgId`, `ctx.organizationId`, `row.organizationId` — never a tenant column. */
  isTenantValue: (identifier: ts.Identifier) => boolean
}>

/** `OrganizationId`, a list of them, or either with `| null` / `| undefined`. */
function isTenantType(typeText: string): boolean {
  const members = typeText
    .replace(/\s+/gu, '')
    .split('|')
    .filter((member) => !ABSENT_TYPES.has(member))
  return members.length === 1 && TENANT_TYPES.has(members[0]!)
}

export function createTenantScope(
  sourceFile: ts.SourceFile,
  tables: TenantTables,
): TenantScope {
  const bindings = bindingsByName(sourceFile)
  const imports = importedNames(sourceFile)
  const tableVerdicts = new Map<Binding, string | null>()

  function resolveBinding(reference: ts.Identifier): Binding | undefined {
    let nearest: Binding | undefined
    let nearestSpan = Number.POSITIVE_INFINITY
    for (const binding of bindings.get(reference.text) ?? []) {
      const scope = scopeOf(binding)
      if (reference.pos < scope.pos || reference.end > scope.end) continue
      if (scope.end - scope.pos < nearestSpan) {
        nearest = binding
        nearestSpan = scope.end - scope.pos
      }
    }
    return nearest
  }

  /** An identifier no declaration in the file explains: an import or a global. */
  function schemaTable(name: string): string | null {
    const exportName = imports.get(name) ?? name
    return tables.allExportNames.has(exportName) ? exportName : null
  }

  /** The schema table an identifier names, `DERIVED_TABLE`, or null for anything else. */
  function tableNamed(identifier: ts.Identifier): string | null {
    const binding = resolveBinding(identifier)
    if (binding === undefined) return schemaTable(identifier.text)
    const known = tableVerdicts.get(binding)
    if (known !== undefined) return known
    // A declaration that refers to itself names no table.
    tableVerdicts.set(binding, null)
    const verdict = ts.isVariableDeclaration(binding) ? tableInitialized(binding) : null
    tableVerdicts.set(binding, verdict)
    return verdict
  }

  /** `const r = reviews`, `alias(reviews, 'r')` and `….as('sq')` each declare a table. */
  function tableInitialized(declaration: ts.VariableDeclaration): string | null {
    if (declaration.initializer === undefined) return null
    const initializer = unwrap(declaration.initializer)
    if (ts.isIdentifier(initializer)) return tableNamed(initializer)
    if (!ts.isCallExpression(initializer)) return null
    const [aliased] = initializer.arguments
    if (TABLE_ALIAS_FUNCTIONS.has(calleeName(initializer) ?? '')) {
      return aliased !== undefined && ts.isIdentifier(aliased)
        ? tableNamed(aliased)
        : DERIVED_TABLE
    }
    return methodName(initializer) === 'as' ? DERIVED_TABLE : null
  }

  function isColumnAccess(node: ts.Expression): boolean {
    const access = unwrap(node)
    if (!ts.isPropertyAccessExpression(access)) return false
    const root = leftmostIdentifier(access.expression)
    return root !== null && tableNamed(root) !== null
  }

  function isTenantColumn(node: ts.Expression): boolean {
    const access = unwrap(node)
    return (
      ts.isPropertyAccessExpression(access) &&
      TENANT_NAME.test(access.name.text) &&
      isColumnAccess(access)
    )
  }

  function isTenantTyped(binding: Binding): boolean {
    if (!ts.isParameter(binding) && !ts.isVariableDeclaration(binding)) return false
    return binding.type !== undefined && isTenantType(binding.type.getText(sourceFile))
  }

  function isTenantValue(identifier: ts.Identifier): boolean {
    const parent = identifier.parent
    if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
      return TENANT_NAME.test(identifier.text) && !isColumnAccess(parent)
    }
    if (!isReference(identifier)) return false
    if (TENANT_NAME.test(identifier.text)) return true
    const binding = resolveBinding(identifier)
    return binding !== undefined && isTenantTyped(binding)
  }

  function namesTenantTable(identifier: ts.Identifier): boolean {
    const table = isReference(identifier) ? tableNamed(identifier) : null
    return table !== null && tables.tenantExportNames.has(table)
  }

  return {
    resolveBinding,
    namesTenantTable,
    isColumnAccess,
    isTenantColumn,
    isTenantValue,
  }
}
