import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createFragmentReader } from './raw-sql-fragments'
import { createTenantScope } from './tenant-predicate-scope'

const TABLES = {
  allExportNames: new Set(['replies']),
  tenantExportNames: new Set(['replies']),
  tenantDatabaseNames: new Set(['replies']),
}
const PREAMBLE = `
  const scopeSql = sql\`organization_id = \${orgId}\`
  const eitherSql = strict ? sql\`a = 1\` : sql\`b = 2\`
  const key = receiptKey(orgId, requestId)
  const lockName = \`reply:\${orgId}\`
  const ownedReplies = (owner: string) => sql\`FROM replies WHERE organization_id = \${owner}\`
  function repliesWhere() { return sql\`WHERE organization_id = \${orgId}\` }
  const lockKeyOf = (owner: string) => \`reply:\${owner}\`
`

/** What the reader says of `${expression}` inside a statement of a file with PREAMBLE. */
function read(expression: string, parameters = '') {
  const sourceFile = ts.createSourceFile(
    'example.repository.ts',
    `${PREAMBLE}
     const statement = (${parameters}) => sql\`SELECT 1 \${${expression}}\``,
    ts.ScriptTarget.Latest,
    true,
  )
  const reader = createFragmentReader(
    createTenantScope(sourceFile, TABLES),
    (name) => name === 'and' || name.endsWith('Where'),
  )
  let interpolated: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateSpan(node)) interpolated = node.expression
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (interpolated === undefined) throw new Error('no interpolation')
  return {
    standsForSql: reader.standsForSql(interpolated),
    templates: reader
      .templatesOf(interpolated)
      .map((template) => template.template.getText(sourceFile)),
  }
}

describe('raw SQL fragments: what an interpolation stands for', () => {
  it.each([
    ['an inline template', 'sql`id = 1`'],
    ['a variable holding a template', 'scopeSql'],
    ['a variable holding either of two templates', 'eitherSql'],
    ['a helper of the file that returns a template', 'ownedReplies(orgId)'],
    ['a function of the file that returns a template', 'repliesWhere()'],
    ['a query operator', 'and(first, second)'],
    ['an imported helper named like a predicate', 'inboxScopeWhere(orgId)'],
    ['a join of conditions', 'sql.join(conditions, sql` AND `)'],
    ['a template or its fallback', 'scope ?? scopeSql', 'scope?: SQL'],
  ])('reads %s as SQL', (_form, expression, parameters = '') => {
    expect(read(expression, parameters).standsForSql).toBe(true)
  })

  it.each([
    ['a tenant value', 'orgId'],
    ['a member of a value', 'ctx.organizationId'],
    ['a tenant-typed parameter', 'owner', 'owner: OrganizationId'],
    ['a key computed from the tenant', 'key'],
    ['a string built from the tenant', 'lockName'],
    ['an imported helper that returns a value', 'unbrand(orgId)'],
    ['a helper of the file that returns a string', 'lockKeyOf(orgId)'],
    ['a method call', 'orgIds.map(unbrand)'],
    ['a name the file does not declare', 'REPLY_STATES'],
  ])('reads %s as a value', (_form, expression, parameters = '') => {
    expect(read(expression, parameters).standsForSql).toBe(false)
  })

  it('leaves a plain parameter to the callers that fill it', () => {
    expect(read('where', 'where: SQL').standsForSql).toBe(true)
  })

  it('finds the templates a fragment was written as', () => {
    expect(read('scopeSql').templates).toEqual(['`organization_id = ${orgId}`'])
    expect(read('eitherSql').templates).toEqual(['`a = 1`', '`b = 2`'])
    expect(read('ownedReplies(orgId)').templates).toEqual([
      '`FROM replies WHERE organization_id = ${owner}`',
    ])
    expect(read('repliesWhere()').templates).toEqual([
      '`WHERE organization_id = ${orgId}`',
    ])
    expect(read('inboxScopeWhere(orgId)').templates).toEqual([])
    expect(read('orgId').templates).toEqual([])
  })
})
