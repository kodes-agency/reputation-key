// BQC-4.4 — fleet/global views are content-free aggregates.
//
// Phase BQC-4 §4.4 + ADR 0048 ("control-plane metadata allowed outside the
// cell"): cross-property (fleet) and org-level views must be built from
// content-free aggregates only — counts, sums, averages, rating buckets —
// never from raw review/reply/inbox/notification content. Property-LOCAL
// reads (the per-property dashboard's recent-reviews widget, the inbox, the
// review list) are cell-DB reads for the owning org and are governed
// separately (org scope + property-assignment + content-expiry eligibility).
//
// These static scans pin:
//   1. The fleet read path (server fn + use case) references no content
//      tables or content columns at all.
//   2. The aggregate query files feeding fleet/org-level views select no
//      content columns (COUNT/SUM/AVG over the tables is their purpose).
//   3. The ONE content-column selection in dashboard infrastructure
//      (reviews.text for the property-local recent-reviews widget) stays
//      confined to getRecentReviews — the fleet path never reaches it.
//   4. The fleet DTO shapes (FleetEntry/FleetOverviewData/FleetTotals/
//      AttentionSignals) declare no content fields.
//
// Runtime halves: get-fleet-overview.test.ts (aggregation behavior),
// dashboard.repository.test.ts / review-stats-eligibility.test.ts
// (integration, content-expiry eligibility).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8')

/**
 * Strip line and block comments so scans target CODE, not prose (comments
 * documenting the content-free policy legitimately name the tables).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// ── What counts as content ──────────────────────────────────────────

/** Direct query of a content table (`.from(reviews)` / column access via schema import). */
const CONTENT_TABLE_QUERY =
  /\.from\(\s*(reviews|replies|inboxItems|inboxNotes|notifications)\b/

/**
 * Content columns on those tables: review/reply text, inbox item snippet,
 * note text, notification body, reviewer identity.
 */
const CONTENT_COLUMNS = /\.(text|snippet|body|reviewerName|noteText)\b/

// ── The paths under guard ───────────────────────────────────────────

/** Fleet read path: cross-property aggregation entry point + use case. */
const FLEET_PATH_FILES = [
  'src/contexts/dashboard/server/fleet-overview.ts',
  'src/contexts/dashboard/application/use-cases/get-fleet-overview.ts',
]

/**
 * Aggregate query files feeding fleet/org-level views. They may reference
 * content TABLES (COUNT/SUM/AVG over them is the point) but never select
 * content COLUMNS.
 */
const AGGREGATE_QUERY_FILES = [
  'src/contexts/dashboard/infrastructure/adapters/attention-signals.adapter.ts',
  'src/contexts/dashboard/infrastructure/adapters/metric-stats.adapter.ts',
  'src/contexts/dashboard/infrastructure/adapters/portal-metrics.adapter.ts',
  'src/contexts/leaderboard/infrastructure/repositories/leaderboard.repository.ts',
]

/** Fleet DTO type blocks in the dashboard domain types. */
const DTO_FILE = 'src/contexts/dashboard/domain/types.ts'
const FLEET_DTO_TYPES = [
  'FleetEntry',
  'FleetOverviewData',
  'FleetTotals',
  'AttentionSignals',
]

/** Content field names that must never appear in a fleet DTO. */
const DTO_CONTENT_FIELDS =
  /\b(snippet|text|body|comment|reviewerName|noteText|reviewText|replyText)\b/

/** Extract a `export type Name = Readonly<{ ... }>` block via brace matching. */
function extractTypeBlock(source: string, typeName: string): string {
  const start = source.indexOf(`export type ${typeName} `)
  expect(start, `${typeName} must exist in ${DTO_FILE}`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces extracting ${typeName}`)
}

/** Extract an object-literal method body (`async name(...) { ... }`) via brace matching. */
function extractMethodBlock(source: string, methodName: string): string {
  const start = source.indexOf(`async ${methodName}`)
  expect(start, `${methodName} must exist`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces extracting ${methodName}`)
}

describe('BQC-4.4: fleet/global views are content-free aggregates', () => {
  it('the fleet read path references no content tables or columns', () => {
    for (const file of FLEET_PATH_FILES) {
      const code = stripComments(read(file))
      // The fleet path composes ports/use cases only — it cannot query what
      // it cannot import. (A bare `reviews` identifier scan would false-
      // positive on the `kpis.reviews` COUNT aggregate field.)
      expect(
        code.includes('#/shared/db/schema'),
        `${file} must not import the db schema`,
      ).toBe(false)
      expect(
        CONTENT_TABLE_QUERY.test(code),
        `${file} must not query content tables`,
      ).toBe(false)
      expect(
        CONTENT_COLUMNS.test(code),
        `${file} must not reference content columns`,
      ).toBe(false)
      // The fleet use case must not reach the property-local recent-reviews read.
      expect(code).not.toMatch(/getRecentReviews|recentReviews|snippet/)
    }
  })

  it('aggregate query files select no content columns', () => {
    for (const file of AGGREGATE_QUERY_FILES) {
      const code = stripComments(read(file))
      expect(
        CONTENT_COLUMNS.test(code),
        `${file} must aggregate (COUNT/SUM/AVG), never select content columns`,
      ).toBe(false)
    }
  })

  it('the aggregate query files really query the content tables (guard is not vacuous)', () => {
    const attention = stripComments(read(AGGREGATE_QUERY_FILES[0]!))
    expect(attention).toMatch(/\breviews\b/)
    expect(attention).toMatch(/\binboxItems\b/)
    expect(attention).toMatch(/\bcount\(/)
  })

  it('reviews.text stays confined to the property-local getRecentReviews widget', () => {
    const file = 'src/contexts/dashboard/infrastructure/adapters/review-stats.adapter.ts'
    const code = stripComments(read(file))
    // Blank out the getRecentReviews method (the documented property-local
    // exception: org-scoped, assignment-scoped, content-expiry eligible);
    // no content column may appear anywhere else in the file.
    const exception = extractMethodBlock(code, 'getRecentReviews')
    expect(exception).toMatch(/reviews\.text/)
    const remainder = code.replace(exception, '')
    expect(
      CONTENT_COLUMNS.test(remainder),
      'content columns outside getRecentReviews',
    ).toBe(false)
  })

  it('fleet DTO shapes declare no content fields', () => {
    const source = read(DTO_FILE)
    for (const typeName of FLEET_DTO_TYPES) {
      const block = extractTypeBlock(source, typeName)
      expect(
        DTO_CONTENT_FIELDS.test(block),
        `${typeName} must not declare content fields`,
      ).toBe(false)
    }
  })
})
