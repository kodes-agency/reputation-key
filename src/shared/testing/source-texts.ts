// What a source file says, for a guard test that must read words and imports but
// not comments or layout: the text it writes out (string and template literals,
// JSX text) and the modules it imports or re-exports from. Two guards read the
// goals' sources this way (`portal-goal-sources.test.ts`,
// `goal-shared-sources.test.ts`).

import ts from 'typescript'
import type { SourceFile } from './source-tree'

/** Every text the file writes out: string and template literals, and JSX text. */
export function writtenTexts(file: SourceFile): string[] {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)
  const texts: string[] = []
  const visit = (node: ts.Node): void => {
    // A module's path is where it lives, not what it says.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      texts.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return texts
}

/** The module specifiers a file imports or re-exports from. */
export function importedModules(file: SourceFile): string[] {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)
  return source.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  )
}
