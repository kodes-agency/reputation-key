// The Monthly portal goal shares nothing with the Google rating goal (ADR 0068,
// PLAN §3.4): not a module, not a word, not a line, not the link ink its
// numeral wears. These read every Portal goal source (its components, its
// route modules, and its pages once they exist) with no exemption, and fail
// with the file named. The three lines the owner approved (P-8) are spelled in
// `portal-goal-copy.ts` only, as approved.
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { readUiSources, type SourceFile } from '#/shared/testing/source-tree'
import {
  HOW_TO_ASK_LINE,
  PLAN_POLICY_LINE,
  UNASKED_REVIEWS_LINE,
} from './rating-goal-copy'
import {
  PORTAL_ASK_EVERY_GUEST_LINE,
  PORTAL_NO_SCAN_HINT,
  PORTAL_SPOT_NOT_PERSON_LINE,
} from './portal-goal-copy'

const GOALS_ROUTE = 'src/routes/_authenticated/properties/$propertyId/goals/'
const COPY_FILE = 'src/components/goals/portal-goal-copy.ts'
/** A Portal's Results line, read beside the Portal's own route (PG-16). */
const RESULTS_LINE_HOST =
  'src/routes/_authenticated/properties/$propertyId/portals/-portal-goal-line.tsx'

/** A Portal goal source: its components, its route modules and its pages. */
function isPortalGoalSource(path: string): boolean {
  if (/^src\/components\/goals\/portal-goal-[^/]+\.tsx?$/u.test(path)) return true
  if (path === RESULTS_LINE_HOST) return true
  if (!path.startsWith(GOALS_ROUTE)) return false
  const name = path.slice(GOALS_ROUTE.length)
  // `$goalId.tsx` is a portal goal's own page (PG-21).
  return /^(-portal-goal-[^/]+\.tsx?|portals\.tsx|portal-results\.tsx|\$goalId\.tsx)$/u.test(
    name,
  )
}

const ALL_SOURCES = readUiSources({ includeTs: true })
const SOURCES = ALL_SOURCES.filter((file) => isPortalGoalSource(file.path))

/** Every text the file writes out: string and template literals, and JSX text. */
function writtenTexts(file: SourceFile): string[] {
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
      ts.isTemplateTail(node)
    ) {
      texts.push(node.text)
    } else if (ts.isJsxText(node)) {
      texts.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return texts
}

/** The module specifiers a file imports or re-exports from. */
function importedModules(file: SourceFile): string[] {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)
  return source.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  )
}

/** The files among `files` for which `offends` holds. */
const offenders = (
  files: readonly SourceFile[],
  offends: (file: SourceFile) => boolean,
): string[] => files.filter(offends).map(({ path }) => path)

describe('the Monthly portal goal sources', () => {
  it('finds the sources it is meant to read', () => {
    const paths = SOURCES.map(({ path }) => path)

    expect(paths).toContain(COPY_FILE)
    expect(paths).toContain('src/components/goals/portal-goal-section.tsx')
    expect(paths).toContain(`${GOALS_ROUTE}-portal-goal-queries.ts`)
    expect(paths).toContain(RESULTS_LINE_HOST)
    expect(paths).toContain(`${GOALS_ROUTE}-portal-goal-overview.tsx`)
    expect(paths).toContain(`${GOALS_ROUTE}$goalId.tsx`)
  })

  it('never imports the Google rating goal', () => {
    expect(
      offenders(SOURCES, (file) =>
        importedModules(file).some((module) => /rating-goal/u.test(module)),
      ),
    ).toEqual([])
  })

  it('never says review, Google or plan', () => {
    expect(
      offenders(SOURCES, (file) =>
        writtenTexts(file).some((text) => /\b(review|Google|plan)\b/iu.test(text)),
      ),
    ).toEqual([])
  })

  it('keeps the number in foreground ink', () => {
    // The link ink is for links (InlineLink, a link Button), never a figure.
    expect(
      offenders(SOURCES, (file) =>
        writtenTexts(file).some((text) => /\btext-link\b/u.test(text)),
      ),
    ).toEqual([])
  })

  it('uses none of the Google lines', () => {
    const googleLines = [
      PLAN_POLICY_LINE,
      HOW_TO_ASK_LINE.lead,
      HOW_TO_ASK_LINE.text,
      UNASKED_REVIEWS_LINE,
    ]
    expect(
      offenders(
        SOURCES,
        (file) =>
          /\b(PLAN_POLICY_LINE|HOW_TO_ASK_LINE|UNASKED_REVIEWS_LINE)\b/u.test(
            file.text,
          ) || googleLines.some((line) => file.text.includes(line)),
      ),
    ).toEqual([])
  })

  it('spells the approved lines once', () => {
    expect(PORTAL_ASK_EVERY_GUEST_LINE).toBe(
      'Ask every guest, not only happy ones. Low and high ratings count the same.',
    )
    expect(PORTAL_NO_SCAN_HINT).toBe('Is it where guests can see it?')
    expect(PORTAL_SPOT_NOT_PERSON_LINE).toBe(
      'Portal goals are about the spot, not the person who works there.',
    )
    for (const line of [
      PORTAL_ASK_EVERY_GUEST_LINE,
      PORTAL_NO_SCAN_HINT,
      PORTAL_SPOT_NOT_PERSON_LINE,
    ]) {
      expect(offenders(ALL_SOURCES, (file) => file.text.includes(line))).toEqual([
        COPY_FILE,
      ])
    }
  })
})
