// LIF-01: the Organization Export contributor contract has to be nameable from
// a foreign context's infrastructure/adapters/**, and eslint-rules/
// cross-context-public-api.mjs grants that exception only for
// application/ports/**. These tests pin the two properties that make the later
// contributor adapters legal without weakening the boundary: the port carries
// the whole contributor vocabulary, and it publishes the SAME classification
// authority the bundle builder enforces rather than a second copy of it.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '../../domain/organization-lifecycle'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT as CONTRACT_CLASSIFICATIONS_BY_CONTEXT,
  ORGANIZATION_EXPORT_CLASSIFICATIONS as CONTRACT_ORGANIZATION_EXPORT_CLASSIFICATIONS,
} from '../organization-export-contract'
import {
  CLASSIFICATIONS_BY_CONTEXT,
  ORGANIZATION_EXPORT_CLASSIFICATIONS,
  type OrganizationExportClassification,
  type OrganizationExportContribution,
  type OrganizationExportContributor,
  type OrganizationExportEntry,
  type OrganizationLifecycleContext,
} from './organization-export-contributor.port'

const RULE_ID = 'local/cross-context-public-api'
const PORT_FILE =
  'src/contexts/identity/application/ports/organization-export-contributor.port.ts'
const CONTRACT_FILE = 'src/contexts/identity/application/organization-export-contract.ts'
const AS_OF = new Date('2026-08-28T12:00:00.000Z')

// A contributor adapter has to name its context, its entries, its coverage
// verdict, and the classification it is allowed to stamp — all of it from here.
const REQUIRED_PORT_EXPORTS = [
  'ORGANIZATION_EXPORT_CLASSIFICATIONS',
  'CLASSIFICATIONS_BY_CONTEXT',
  'OrganizationExportClassification',
  'OrganizationExportEntry',
  'OrganizationExportContribution',
  'OrganizationExportContributor',
  'OrganizationLifecycleContext',
]

const eslint = new ESLint()

async function lintSnippet(code: string, importerRelPath: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), importerRelPath),
  })
  return result.messages
}

const hitsRule = (messages: Array<{ ruleId: string | null }>): boolean =>
  messages.some((message) => message.ruleId === RULE_ID)

function parse(relativePath: string): ts.SourceFile {
  const absolute = path.join(process.cwd(), relativePath)
  return ts.createSourceFile(
    absolute,
    readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
}

/** Every name the module publishes, including type-only ones erased at runtime. */
function exportedNames(relativePath: string): ReadonlySet<string> {
  const names = new Set<string>()
  for (const statement of parse(relativePath).statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) names.add(element.name.text)
      }
      continue
    }
    if (!isExported(statement)) continue
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
      continue
    }
    if (
      (ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isFunctionDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text)
    }
  }
  return names
}

/** Counts object-literal *definitions* of a binding, ignoring re-exports of it. */
function literalDefinitions(relativePath: string, binding: string): number {
  let count = 0
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === binding &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      count += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(relativePath))
  return count
}

function contribution(
  context: OrganizationLifecycleContext,
  classification: OrganizationExportClassification,
): OrganizationExportContribution {
  const entries: readonly OrganizationExportEntry[] = [
    {
      path: `${context}/rows.csv`,
      mediaType: 'text/csv',
      classification,
      bytes: Buffer.from(`context,rows\n${context},1\n`, 'utf8'),
    },
    {
      path: `${context}/rows.json`,
      mediaType: 'application/json',
      classification,
      bytes: Buffer.from(`{"context":"${context}","rows":1}\n`, 'utf8'),
    },
  ]
  return { context, coverage: 'complete', omissionCodes: [], entries }
}

function contributors(
  classificationFor: (
    context: OrganizationLifecycleContext,
  ) => OrganizationExportClassification,
): readonly OrganizationExportContributor[] {
  return ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) => ({
    context,
    contribute: async () => contribution(context, classificationFor(context)),
  }))
}

describe('LIF-01: Organization Export contributor port', () => {
  it('publishes every name a foreign contributor adapter must be able to write', () => {
    const published = exportedNames(PORT_FILE)
    expect(REQUIRED_PORT_EXPORTS.filter((name) => !published.has(name))).toEqual([])
  })

  it('keeps CLASSIFICATIONS_BY_CONTEXT as the single source of truth', () => {
    expect(CLASSIFICATIONS_BY_CONTEXT).toBe(CONTRACT_CLASSIFICATIONS_BY_CONTEXT)
    expect(ORGANIZATION_EXPORT_CLASSIFICATIONS).toBe(
      CONTRACT_ORGANIZATION_EXPORT_CLASSIFICATIONS,
    )
    expect(
      literalDefinitions(PORT_FILE, 'CLASSIFICATIONS_BY_CONTEXT') +
        literalDefinitions(CONTRACT_FILE, 'CLASSIFICATIONS_BY_CONTEXT'),
    ).toBe(1)
  })

  it('accepts contributors written entirely against the port', async () => {
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-1',
      requestId: '18deca2e-91a7-46e4-b92b-73163568ed84',
      asOf: AS_OF,
      contributors: contributors((context) => CLASSIFICATIONS_BY_CONTEXT[context][0]),
    })

    expect(bundle.entries.map((entry) => entry.path)).toContain('review/rows.json')
    expect(bundle.manifest.entries).toHaveLength(37)
  })

  it('publishes the classification authority the bundle builder actually enforces', async () => {
    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: '18deca2e-91a7-46e4-b92b-73163568ed84',
        asOf: AS_OF,
        contributors: contributors((context) =>
          context === 'review'
            ? 'tenant_visible'
            : CLASSIFICATIONS_BY_CONTEXT[context][0],
        ),
      }),
    ).rejects.toThrow(/classification is not permitted for review/)
    expect(CLASSIFICATIONS_BY_CONTEXT.review).not.toContain('tenant_visible')
  })

  it('lets a foreign adapter import the port but not the contract', async () => {
    const viaPort = await lintSnippet(
      `import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'\nexport type { OrganizationExportContributor }\n`,
      'src/contexts/portal/infrastructure/adapters/portal-organization-export.adapter.ts',
    )
    expect(hitsRule(viaPort), JSON.stringify(viaPort)).toBe(false)

    const viaContract = await lintSnippet(
      `import type { OrganizationExportContributor } from '#/contexts/identity/application/organization-export-contract'\nexport type { OrganizationExportContributor }\n`,
      'src/contexts/portal/infrastructure/adapters/portal-organization-export.adapter.ts',
    )
    expect(hitsRule(viaContract), JSON.stringify(viaContract)).toBe(true)
  })
})
