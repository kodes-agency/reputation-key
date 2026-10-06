// The pattern index in `CONTEXT.md` is only useful while it is true (UI consistency
// scan: RC8, "docs and code disagree, and nothing checks either").
//
// An agent or a person about to add UI is told to find the family in the index and
// import the canonical component from there. A row that names a path that moved, a
// component that was renamed or a guard that was deleted sends them to nothing, and
// a guard that nobody indexed is a rule nobody finds. So the index is read like
// the sources: every path it gives exists, every component it names is in the
// module it names, every guard is a test that is there, and every source guard
// under `src/components` has a row.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** A `## ` section of a markdown file, from its heading to the next one. */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`)
  if (start < 0) return ''
  const rest = markdown.slice(start + 1)
  const end = rest.indexOf('\n## ', 1)
  return end < 0 ? rest : rest.slice(0, end)
}

type Row = Readonly<{
  family: string
  imports: string
  use: string
  variants: string
  differs: string
  guard: string
}>

/** The table rows of a section: six cells, split on the pipes that are not escaped. */
function rowsOf(section: string): Row[] {
  return section
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| ---'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/gu, '')
        .split(/(?<!\\)\|/u)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells[0] !== 'Family')
    .map(
      ([
        family = '',
        imports = '',
        use = '',
        variants = '',
        differs = '',
        guard = '',
      ]) => ({
        family,
        imports,
        use,
        variants,
        differs,
        guard,
      }),
    )
}

const CONTEXT = read('src/components/CONTEXT.md')
const INDEX = sectionOf(CONTEXT, 'Pattern index')
const ROWS = rowsOf(INDEX)

const codeSpans = (text: string): string[] =>
  [...text.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? '')

/** The source file a `#/` import names: a module, or a folder with an index. */
function moduleSource(specifier: string): string | null {
  const base = join('src', specifier.slice(2))
  const candidates = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext)
  const found = candidates.find((path) => existsSync(join(ROOT, path)))
  return found ? read(found) : null
}

type Import = Readonly<{ names: string[]; specifier: string }>

/** `A`, `B` from `#/path`, one group per line of the cell; other text is skipped. */
function importsOf(row: Row): Import[] {
  return row.imports.split('<br>').flatMap((group) => {
    const [left = '', right = ''] = group.split(' from ')
    const specifier = codeSpans(right).find((span) => span.startsWith('#/'))
    return specifier ? [{ names: codeSpans(left), specifier }] : []
  })
}

/** A guard as the index writes it: under `src/components`, or from the repo root. */
function guardSource(path: string): string | null {
  const found = [join('src', 'components', path), path].find((candidate) =>
    existsSync(join(ROOT, candidate)),
  )
  return found ?? null
}

describe('the pattern index in src/components/CONTEXT.md', () => {
  it('is there, with a row for each family', () => {
    expect(INDEX).not.toBe('')
    expect(ROWS.length).toBeGreaterThanOrEqual(30)
  })

  it('gives each row its family, its import, what it is for and its guard', () => {
    const incomplete = ROWS.filter(
      (row) => !row.family || !row.imports || !row.use || !row.guard,
    ).map((row) => row.family || '(no family)')

    expect(incomplete).toEqual([])
  })

  it('names each family once', () => {
    const families = ROWS.map((row) => row.family)

    expect(families.filter((family, at) => families.indexOf(family) !== at)).toEqual([])
  })

  it('imports from modules that exist, and each component from the module it names', () => {
    const wrong = ROWS.flatMap((row) =>
      importsOf(row).flatMap(({ names, specifier }) => {
        const source = moduleSource(specifier)
        if (source === null) return [`${row.family}: ${specifier} is not a module`]
        return names
          .filter((name) => !new RegExp(`\\b${name}\\b`, 'u').test(source))
          .map((name) => `${row.family}: ${specifier} has no ${name}`)
      }),
    )

    expect(wrong).toEqual([])
  })

  it('points only at repository paths that exist', () => {
    const missing = ROWS.flatMap((row) =>
      Object.values(row)
        .flatMap(codeSpans)
        .filter((span) => /^src\/[\w./-]+$/u.test(span))
        .filter((span) => !existsSync(join(ROOT, span)))
        .map((span) => `${row.family}: ${span}`),
    )

    expect(missing).toEqual([])
  })

  it('names each guard as a test that exists, or says Review', () => {
    const wrong = ROWS.flatMap((row) => {
      const guards = codeSpans(row.guard).filter((span) => span.endsWith('.test.ts'))
      if (guards.length === 0 && !row.guard.includes('Review')) {
        return [`${row.family}: no guard and no "Review"`]
      }
      return guards
        .filter((guard) => guardSource(guard) === null)
        .map((guard) => `${row.family}: ${guard} is not a test`)
    })

    expect(wrong).toEqual([])
  })

  it('has a row for every source guard under src/components', () => {
    const guards = walk(join(ROOT, 'src', 'components'))
      .map((path) => path.slice(join(ROOT, 'src', 'components').length + 1))
      .filter((path) =>
        /(?:-sources|region-states|feedback-ownership)\.test\.ts$/u.test(path),
      )
    const named = new Set(ROWS.flatMap((row) => codeSpans(row.guard)))
    const unindexed = guards.filter((guard) => !named.has(guard))

    expect(unindexed).toEqual([])
  })

  it('lists the canonical component of every family the scan found', () => {
    const named = new Set(
      ROWS.flatMap((row) => importsOf(row).flatMap(({ names }) => names)),
    )
    const canonical = [
      'PageHeader',
      'trailCrumbs',
      'NAV_LABEL',
      'BackLink',
      'BackButton',
      'BackIconButton',
      'PageShell',
      'PageState',
      'EmptyState',
      'RegionError',
      'SectionNav',
      'NavLink',
      'LinkTabs',
      'SegmentedControl',
      'RangeControl',
      'ListToolbar',
      'SearchField',
      'DataTable',
      'RowActionsMenu',
      'LoadMoreButton',
      'MetricStrip',
      'MetricDelta',
      'DescriptionList',
      'Badge',
      'StatusBadge',
      'Alert',
      'FormErrorBanner',
      'Button',
      'AddAction',
      'AddActionLink',
      'IconButton',
      'InlineLink',
      'ConfirmationDialog',
      'Dialog',
      'FormActions',
      'FormTextField',
      'FormFieldFrame',
      'SettingSwitchRow',
      'InheritedSetting',
      'ConsentCheckbox',
      'RatingThresholdField',
      'ImageSetting',
      'ConnectGoogleButton',
      'CardTitle',
      'SectionTitle',
      'formatDate',
    ]

    expect(canonical.filter((name) => !named.has(name))).toEqual([])
  })
})

describe('the places that point to the pattern index', () => {
  it('has the root AGENTS.md send a person to it before they add UI', () => {
    const agents = read('AGENTS.md')

    expect(agents).toContain('Pattern index')
    expect(agents).toContain('src/components/CONTEXT.md')
  })

  it('has the pull request template ask which pattern family the change uses', () => {
    const template = read('.github/pull_request_template.md')

    expect(template).toContain('Pattern index')
    expect(template).toMatch(/pattern family/iu)
  })
})
