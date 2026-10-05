// One list table (UI consistency scan: COLL-03).
//
// `ui/table` was imported raw in thirteen files, each drawing its own frame, header
// cell and way to degrade on a phone. A list of rows is a `DataTable`; the raw table
// stays for the places a shared frame would be wrong, each named below with its
// reason. These checks read the sources, so a new table that reaches for the raw
// primitive fails here with the file named instead of drifting back.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.tsx$/u.test(entry.name) && !/\.(stories|test)\./u.test(entry.name)
      ? [path]
      : []
  })
}

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}))

type SourceFile = (typeof FILES)[number]

/** A table drawn from the raw primitive, or as a bare element. */
const RAW_TABLE = /from '#\/components\/ui\/table'|<table\b/u
const drawsRawTable = (file: SourceFile) => RAW_TABLE.test(file.text)

/**
 * The files that may draw a table without the shell, each for a table that is not a
 * list of rows with a frame of its own to share.
 */
const RAW_ALLOWED: Readonly<Record<string, string>> = {
  'src/components/ui/data-table.tsx': 'the shell itself',
  'src/components/ui/table.tsx': 'the primitive itself',
  'src/components/features/portal/portal-overview/portal-overview-table-row.tsx':
    'the Portals table: a row-group head cell and the cells of a card row the shell lays out',
  'src/components/features/portal/portal-overview/portal-overview-measure-cells.tsx':
    'the Portals table: the five measure cells of a row or a group head',
  'src/components/features/portal/portal-overview/portal-overview-group-head.tsx':
    'the Portals table: a group head row that spans the table and folds its rows',
  'src/components/features/portal/portal-overview/portal-overview-property-head.tsx':
    'the Portals table: a Property head row that spans the table and folds its rows',
  'src/components/goals/goal-results-matrix.tsx':
    'a matrix of goals against months: wide by nature, read across, not a list of rows',
  'src/components/features/property-setup/setup-review.tsx':
    'a wizard step: a review of what the person just entered, not a list of records',
  'src/components/features/property/google-performance-chart.tsx':
    'the data table of a chart, inside its own disclosure, which is its frame',
  'src/components/features/integration/google-import-manager/google-import-candidate-list.tsx':
    'a wizard step: the candidates to import, with a card list for a phone',
  'src/components/features/integration/google-import-manager/google-import-progress-items.tsx':
    'a wizard step: the progress of each property, with a card list for a phone',
  'src/components/features/integration/google-import-manager/google-import-review-form.tsx':
    'a wizard step: the review before importing',
  'src/components/features/integration/google-import-manager/google-import-review-row.tsx':
    'a wizard step: one row of the review before importing',
  'src/components/features/portal/portal-analytics/portal-results-series-table.tsx':
    'the data table of a results chart: a report, written out for assistive technology',
  'src/components/features/portal/portal-analytics/portal-metric-evidence-summary.tsx':
    'a report of the evidence behind a metric, not a list of records',
}

describe('a list of rows is a DataTable', () => {
  it('is not drawn from the raw table, outside the places that name their reason', () => {
    const offenders = FILES.filter(
      (file) => drawsRawTable(file) && !(file.path in RAW_ALLOWED),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('does not excuse a file that no longer draws a raw table', () => {
    const stale = Object.keys(RAW_ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && drawsRawTable(file)),
    )

    expect(stale).toEqual([])
  })

  it('catches both spellings of a raw table', () => {
    expect(RAW_TABLE.test("import { Table } from '#/components/ui/table'")).toBe(true)
    expect(RAW_TABLE.test('<table className="w-full">')).toBe(true)
    expect(RAW_TABLE.test("import { DataTable } from '#/components/ui/data-table'")).toBe(
      false,
    )
  })
})
