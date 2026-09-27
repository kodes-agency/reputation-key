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
//   pnpm ops reparse-review-translations report [--property <id>] --operator <id>
//   pnpm ops reparse-review-translations repair [--property <id>] --operator <id> \
//     [--reason <text> --ticket <ref> --apply]
//
// Runs through the operator-command harness like every ops:* command: a named
// operator from OPS_OPERATOR_IDENTITIES, an ExecutionPolicy decision and a
// correlation id on every run. `report` never writes. `repair` is DRY-RUN by
// default: without --apply it prints the same report and writes nothing, and
// --apply requires --reason and --ticket. Idempotent — repaired rows no longer
// carry the envelope, so a second run reports zero. Requires DATABASE_URL
// (+ QUEUE_REDIS_URL for the harness).

import { pathToFileURL } from 'node:url'
import { sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import { getDb, type Database } from '../../src/shared/db'
import { parseGoogleReviewComment } from '../../src/shared/google-review-comment'
import { computeReviewContentHash } from '../../src/contexts/review/domain/rules'
import { computeAiReviewSourceProvenance } from '../../src/contexts/review/application/ai-review-source'
import type { StarRating } from '../../src/contexts/review/domain/types'
import type {
  OperatorAction,
  OperatorCommandSpec,
} from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:reparse-review-translations'
const USAGE =
  'pnpm ops reparse-review-translations <report|repair> [--property <id>] --operator <id> [--reason <text> --ticket <ref> --apply]'

export const REPARSE_REVIEW_TRANSLATIONS_COMMAND_SPEC = {
  name: COMMAND_NAME,
  scope: 'global',
  mutation: true,
  requiresTicket: true,
  usage: USAGE,
} satisfies OperatorCommandSpec

export type WrappedReviewRow = Readonly<{
  id: string
  property_id: string
  rating: number
  text: string
  reviewer_name: string | null
  language_code: string | null
  reviewed_at: string
}>

/** The guest's original text and the derived columns recomputed from it. */
export type ReviewTranslationRepair = Readonly<{
  text: string
  translatedText: string | null
  contentHash: string
  aiSourceDigest: string
  aiSourceByteLength: number
}>

export type ReviewTranslationStore = Readonly<{
  /** Rows still carrying the envelope, oldest first; `null` scans every Property. */
  findWrapped: (propertyId: string | null) => Promise<readonly WrappedReviewRow[]>
  /** Targeted column UPDATE: no lifecycle rewrite, no reviewUpdated. */
  repair: (reviewId: string, repair: ReviewTranslationRepair) => Promise<void>
}>

function createReviewTranslationStore(db: Database): ReviewTranslationStore {
  return {
    findWrapped: async (propertyId) =>
      // Only rows the adapter would now split differently. The prefix is a strict
      // prefix in every observed row; requiring the closing marker too keeps a
      // truncated comment from being mistaken for an envelope.
      (
        await db.execute(sql`
          SELECT id, property_id, rating, text, reviewer_name, language_code, reviewed_at
          FROM reviews
          WHERE text LIKE '(Translated by Google)%'
            AND position('(Original)' IN text) > 0
            ${propertyId === null ? sql`` : sql`AND property_id = ${propertyId}::uuid`}
          ORDER BY reviewed_at
        `)
      ).rows as unknown as readonly WrappedReviewRow[],
    repair: async (reviewId, repair) => {
      await db.execute(sql`
        UPDATE reviews
        SET text = ${repair.text},
            translated_text = ${repair.translatedText},
            content_hash = ${repair.contentHash},
            ai_source_digest = ${repair.aiSourceDigest},
            ai_source_byte_length = ${repair.aiSourceByteLength}
        WHERE id = ${reviewId}::uuid
      `)
    },
  }
}

/** The repair for one row, or null when its envelope yields no original. */
function repairFor(row: WrappedReviewRow): ReviewTranslationRepair | null {
  const parsed = parseGoogleReviewComment(row.text)
  // Refuse to replace real text with nothing.
  if (parsed.original === null) return null
  const rating = row.rating as StarRating
  const provenance = computeAiReviewSourceProvenance({
    text: parsed.original,
    rating,
    languageCode: row.language_code,
    reviewedAtEpochMillis: new Date(row.reviewed_at).getTime(),
    reviewerDisplayName: row.reviewer_name,
  })
  return {
    text: parsed.original,
    translatedText: parsed.translation,
    contentHash: computeReviewContentHash({
      rating,
      text: parsed.original,
      reviewerName: row.reviewer_name,
      languageCode: row.language_code,
    }),
    aiSourceDigest: provenance.digest,
    aiSourceByteLength: provenance.byteLength,
  }
}

function propertyFilter(propertyId: string | undefined): string | null {
  if (propertyId === undefined) return null
  if (!z.uuid().safeParse(propertyId).success) {
    throw new Error(`--property must be a Property UUID (got '${propertyId}')`)
  }
  return propertyId
}

function countByProperty(rows: readonly WrappedReviewRow[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows)
    counts.set(row.property_id, (counts.get(row.property_id) ?? 0) + 1)
  return counts
}

export function createReparseReviewTranslationsAction(
  dependencies: Readonly<{ createStore: () => ReviewTranslationStore }>,
): OperatorAction {
  return async (ctx, args, io) => {
    const [verb, ...extra] = args.positionals
    if ((verb !== 'report' && verb !== 'repair') || extra.length > 0) {
      throw new Error(`expected exactly one of report|repair; usage: ${USAGE}`)
    }
    if (verb === 'report' && !ctx.dryRun) {
      throw new Error('report never writes — use `repair --apply` to write')
    }
    const propertyId = propertyFilter(ctx.propertyId)
    const store = dependencies.createStore()
    const rows = await store.findWrapped(propertyId)
    if (rows.length === 0) {
      io.out(`${COMMAND_NAME}: no wrapped reviews found`)
      return
    }

    const planned = rows.map((row) => ({ row, repair: repairFor(row) }))
    for (const { row, repair } of planned) {
      if (repair === null) {
        io.out(`  SKIP ${row.id}: envelope yields no original`)
      } else if (!ctx.dryRun) {
        await store.repair(row.id, repair)
      }
    }

    const repaired = planned.filter(({ repair }) => repair !== null).map(({ row }) => row)
    const skipped = planned.length - repaired.length
    io.out(
      `${COMMAND_NAME}: ${ctx.dryRun ? 'dry-run' : 'applied'} — ${repaired.length} wrapped review(s)` +
        `${skipped > 0 ? `, ${skipped} skipped` : ''}`,
    )
    for (const [property, count] of countByProperty(repaired)) {
      io.out(`  ${property}: ${count}`)
    }
    if (ctx.dryRun) {
      io.out('  re-run as `repair --reason <text> --ticket <ref> --apply` to write')
    }
  }
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    REPARSE_REVIEW_TRANSLATIONS_COMMAND_SPEC,
    createReparseReviewTranslationsAction({
      createStore: () => createReviewTranslationStore(getDb()),
    }),
  )
  process.exitCode = result.exitCode
}

const entrypoint = process.argv[1]
if (entrypoint && pathToFileURL(entrypoint).href === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
    process.exitCode = 1
  })
}
