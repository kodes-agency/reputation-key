import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENTED_ELSEWHERE,
  PROSE_TERMS,
  auditContextPublicInterface,
  extractPublicApiSection,
  listDeclaredIdentifiers,
} from './context-public-interface-authority'
import { CONTEXT_STANDARDS_AUTHORITY } from './context-standards-authority'

const ROOT = process.cwd()
const CONTEXT_ROOT = join(ROOT, 'src', 'contexts')

/** Names the four drifted identifiers ARC-03-T5 removed from the documents. */
const KNOWN_DRIFT = Object.freeze([
  'PublicPortalBySlugResult',
  'portalDeleted',
  'portalGroupDeleted',
  'CustomRoleRecord',
])

/** Names one top-level statement contributes to a module's export surface. */
function exportedNamesOfStatement(
  statement: ts.Statement,
  file: string,
): readonly string[] {
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause
    // `export * from` would hide names behind another module; none exists today.
    expect(clause == null || ts.isNamedExports(clause), file).toBe(true)
    return clause != null && ts.isNamedExports(clause)
      ? clause.elements.map((element) => element.name.text)
      : []
  }

  const modifiers = ts.canHaveModifiers(statement)
    ? (ts.getModifiers(statement) ?? [])
    : []
  if (!modifiers.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) return []

  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    )
  }
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name != null &&
    ts.isIdentifier(statement.name)
  ) {
    return [statement.name.text]
  }
  return []
}

function exportedNamesOf(directory: string): readonly string[] {
  const file = join(CONTEXT_ROOT, directory, 'application', 'public-api.ts')
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  )
  const names = new Set<string>()
  for (const statement of source.statements) {
    for (const name of exportedNamesOfStatement(statement, file)) names.add(name)
  }
  return [...names].sort()
}

function documentOf(directory: string): string {
  return readFileSync(join(CONTEXT_ROOT, directory, 'CONTEXT.md'), 'utf8')
}

function auditAll(): ReturnType<typeof auditContextPublicInterface> {
  return CONTEXT_STANDARDS_AUTHORITY.flatMap((row) =>
    auditContextPublicInterface({
      directory: row.directory,
      document: documentOf(row.directory),
      exportedNames: exportedNamesOf(row.directory),
    }),
  )
}

describe('CONTEXT.md public interface accuracy', () => {
  it('declares only real exports or reviewed prose terms in every Public API section', () => {
    const undeclared = auditAll().filter(
      (issue) => issue.kind === 'undeclared_identifier',
    )

    expect(undeclared.map((issue) => issue.message)).toEqual([])
  })

  it('names every public-api.ts export in its document or reviews it explicitly', () => {
    const undocumented = auditAll().filter(
      (issue) => issue.kind === 'undocumented_export',
    )

    expect(undocumented.map((issue) => issue.message)).toEqual([])
  })

  it('refuses to launder the four known drifted names through either allowlist', () => {
    for (const name of KNOWN_DRIFT) {
      expect(
        PROSE_TERMS.some((entry) => entry.term === name),
        `${name} must not be a prose term`,
      ).toBe(false)
      expect(
        DOCUMENTED_ELSEWHERE.some((group) =>
          group.names.some((reviewed) => reviewed === name),
        ),
        `${name} must not be documented-elsewhere`,
      ).toBe(false)
    }

    const drifted = auditContextPublicInterface({
      directory: 'portal',
      document: ['## Public API', ...KNOWN_DRIFT.map((name) => `- \`${name}\``)].join(
        '\n',
      ),
      exportedNames: [],
    })

    expect(drifted.map((issue) => issue.name).sort()).toEqual([...KNOWN_DRIFT].sort())
  })

  it('produces exactly one violation for a fixture declaring a non-existent name', () => {
    const exportedNames = exportedNamesOf('portal')
    const fixture = [
      '# Portal fixture',
      '## Bounded context',
      '## Invariants',
      '## Events produced',
      '## Public API',
      ...exportedNames.map((name) => `- \`${name}\``),
      '- `NonExistentPortalThing`',
    ].join('\n')

    const violations = auditContextPublicInterface({
      directory: 'portal',
      document: fixture,
      exportedNames,
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      directory: 'portal',
      kind: 'undeclared_identifier',
      name: 'NonExistentPortalThing',
    })
  })

  it('reads only the Public API section and only its backticked identifiers', () => {
    const document = [
      '## Events produced',
      '- `EventsProducedName`',
      '## Public API',
      '- `RealExport` and `PortalPublicApi.getPortalInfo`',
      '- `findGroupForPortal(orgId, portalId)` on `application/public-api.ts`',
      '- plain PlainProseName is not a declaration',
      '## Notes',
      '- `NotesName`',
    ].join('\n')

    expect(listDeclaredIdentifiers(extractPublicApiSection(document))).toEqual([
      'RealExport',
      'findGroupForPortal',
    ])
  })
})

describe('public interface allowlists', () => {
  it('scopes every entry to a governed context and carries a reason', () => {
    const directories = new Set<string>(
      CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory),
    )

    for (const entry of PROSE_TERMS) {
      expect(directories.has(entry.directory), entry.term).toBe(true)
      expect(entry.reason.trim().length, entry.term).toBeGreaterThan(0)
    }
    for (const group of DOCUMENTED_ELSEWHERE) {
      expect(directories.has(group.directory), group.directory).toBe(true)
      expect(group.reason.trim().length, group.directory).toBeGreaterThan(0)
      expect(group.names.length, group.directory).toBeGreaterThan(0)
    }

    const proseKeys = PROSE_TERMS.map(({ directory, term }) => `${directory}/${term}`)
    expect(new Set(proseKeys).size).toBe(proseKeys.length)
    const documentedDirectories = DOCUMENTED_ELSEWHERE.map(({ directory }) => directory)
    expect(new Set(documentedDirectories).size).toBe(documentedDirectories.length)
  })

  it('keeps prose terms off the export surface and documented-elsewhere names on it', () => {
    for (const entry of PROSE_TERMS) {
      // A prose term that becomes a real export must be documented as one.
      expect(
        exportedNamesOf(entry.directory).includes(entry.term),
        `${entry.directory}/${entry.term} is exported and no longer prose`,
      ).toBe(false)
      expect(
        listDeclaredIdentifiers(
          extractPublicApiSection(documentOf(entry.directory)),
        ).includes(entry.term),
        `${entry.directory}/${entry.term} is unused`,
      ).toBe(true)
    }

    for (const group of DOCUMENTED_ELSEWHERE) {
      const exported = new Set<string>(exportedNamesOf(group.directory))
      const names: readonly string[] = group.names
      expect([...names], group.directory).toEqual([...names].sort())
      for (const name of group.names) {
        expect(exported.has(name), `${group.directory}/${name} is not exported`).toBe(
          true,
        )
      }
    }
  })
})
