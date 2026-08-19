// Operator CLI: re-split Google's translation envelope on already-stored reviews.
//
// Google Business Profile returns BOTH its machine translation and the guest's
// original in a single `reviews[].comment`:
//
//   (Translated by Google) <translation>\n\n(Original)\n<original>
//
// The provider adapter stored that raw, so `reviews.text` held a two-language
// blob. `reviews.language_code` is NULL for every row (Google sends no language
// field), which makes local cld3 detection the ONLY language signal — and it was
// reading Google's English translation instead of the guest's words. Measured on
// the closed-beta property: 8 Bulgarian reviews scored as reliable English (an
// English draft would have been offered for a Bulgarian guest) and 8 genuinely
// repliable ru/tr/fr reviews were rejected because the mixed blob read as
// unreliable.
//
// The adapter now splits at ingestion. This command repairs rows written before
// that fix.
//
// Why it recomputes three derived columns rather than only rewriting the text:
// `content_hash` (rating\0text\0reviewerName\0languageCode) and the AI source
// provenance pair (`ai_source_digest`, `ai_source_byte_length`) are both derived
// from the review text. `ai_source_digest` is the revision gate — sync bumps
// `source_revision` and emits reviewUpdated when it differs — so leaving them
// stale would make all 76 rows look content-changed on the next sync. That would
// mark reviews as updated AFTER the AI opt-in and pull them into analysis, quietly
// defeating the deliberate `analysis_start_sequence` watermark. Both values are
// therefore recomputed by the SAME production functions the sync path uses, never
// reimplemented here.
//
// It also deliberately does NOT write through reviewRepo.upsert or
// commandStore.upsertAndRecord: that lifecycle rewrites last_fetched_at and
// content_expires_at, recomputes source_revision, and emits reviewUpdated. This
// issues a targeted column UPDATE instead, so the review's lifecycle and analysis
// position are untouched.
//
// Usage:
//   pnpm ops:reparse-review-translations report [--property <id>]
//   pnpm ops:reparse-review-translations repair [--property <id>] [--apply]
//
// `repair` is DRY-RUN by default: without --apply it prints the same report and
// writes nothing. Idempotent — repaired rows no longer carry the envelope, so a
// second run reports zero. Requires DATABASE_URL.

import { sql } from 'drizzle-orm'
import { getDb } from '../../src/shared/db'
import { parseGoogleReviewComment } from '../../src/shared/google-review-comment'
import { computeReviewContentHash } from '../../src/contexts/review/domain/rules'
import { computeAiReviewSourceProvenance } from '../../src/contexts/review/application/ai-review-source'
import type { StarRating } from '../../src/contexts/review/domain/types'

const COMMAND_NAME = 'ops:reparse-review-translations'
const USAGE =
  'pnpm ops:reparse-review-translations <report|repair> [--property <id>] [--apply]'

type WrappedRow = Readonly<{
  id: string
  property_id: string
  rating: number
  text: string
  reviewer_name: string | null
  language_code: string | null
  reviewed_at: string
}>

function flagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0]
  if (command !== 'report' && command !== 'repair') {
    process.stderr.write(`Usage: ${USAGE}\n`)
    process.exit(2)
  }
  const propertyId = flagValue(argv, '--property')
  const apply = command === 'repair' && argv.includes('--apply')

  const db = getDb()
  // Only rows the adapter would now split differently. The prefix is a strict
  // prefix in every observed row; requiring the closing marker too keeps a
  // truncated comment from being mistaken for an envelope.
  const rows = (
    await db.execute(sql`
      SELECT id, property_id, rating, text, reviewer_name, language_code, reviewed_at
      FROM reviews
      WHERE text LIKE '(Translated by Google)%'
        AND position('(Original)' IN text) > 0
        ${propertyId === null ? sql`` : sql`AND property_id = ${propertyId}::uuid`}
      ORDER BY reviewed_at
    `)
  ).rows as unknown as readonly WrappedRow[]

  if (rows.length === 0) {
    process.stdout.write(`${COMMAND_NAME}: no wrapped reviews found\n`)
    return
  }

  let repaired = 0
  let skipped = 0
  const byProperty = new Map<string, number>()

  for (const row of rows) {
    const parsed = parseGoogleReviewComment(row.text)
    if (parsed.original === null) {
      // Refuse to replace real text with nothing.
      skipped += 1
      process.stdout.write(`  SKIP ${row.id}: envelope yields no original\n`)
      continue
    }
    const rating = row.rating as StarRating
    const contentHash = computeReviewContentHash({
      rating,
      text: parsed.original,
      reviewerName: row.reviewer_name,
      languageCode: row.language_code,
    })
    const provenance = computeAiReviewSourceProvenance({
      text: parsed.original,
      rating,
      languageCode: row.language_code,
      reviewedAtEpochMillis: new Date(row.reviewed_at).getTime(),
      reviewerDisplayName: row.reviewer_name,
    })
    byProperty.set(row.property_id, (byProperty.get(row.property_id) ?? 0) + 1)
    repaired += 1

    if (!apply) continue
    await db.execute(sql`
      UPDATE reviews
      SET text = ${parsed.original},
          translated_text = ${parsed.translation},
          content_hash = ${contentHash},
          ai_source_digest = ${provenance.digest},
          ai_source_byte_length = ${provenance.byteLength}
      WHERE id = ${row.id}::uuid
    `)
  }

  const mode = apply ? 'applied' : 'dry-run'
  process.stdout.write(
    `${COMMAND_NAME}: ${mode} — ${repaired} wrapped review(s)` +
      `${skipped > 0 ? `, ${skipped} skipped` : ''}\n`,
  )
  for (const [property, count] of byProperty) {
    process.stdout.write(`  ${property}: ${count}\n`)
  }
  if (!apply) {
    process.stdout.write(`  re-run with --apply to write\n`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
    process.exit(1)
  })
