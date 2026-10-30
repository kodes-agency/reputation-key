// Review context — readForAi with the numbered sentences a v3 analysis reads.
// Real PostgreSQL.

import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MAX_AI_REVIEW_SENTENCES_V1,
  canonicalizeRawAiReviewSourcePreviousRevision,
} from '#/shared/ai-review-source-contract'
import { reviewSentencesMatchText } from '#/shared/review-analysis-v3-request'
import { locateReviewSentences } from '#/shared/review-sentences'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { storedAiReviewSourceProvenance } from '../../application/ai-review-source'
import type { AiReviewSourceReadRequest } from '../../application/ports/ai-review-source.port'
import { createReviewRepository } from './review.repository'

const ORG = organizationId('org-ai-source-sent-aaaa-1111111111111111')
const PROPERTY = propertyId('73a00000-0000-4000-8000-000000000001')
const REVIEW = reviewId('73a00000-0000-4000-8000-0000000000a1')
const REVIEWED_AT = new Date('2026-09-20T12:00:00Z')
const TEXT = 'Room was clean.\nStaff were kind.\n\nBreakfast could be better.'
const READ: AiReviewSourceReadRequest = {
  organizationId: ORG,
  propertyId: PROPERTY,
  reviewId: REVIEW,
  expected: { kind: 'analysis', sourceEpoch: 0, sourceRevision: 1, analysisSequence: 1 },
}
const READ_WITH_SENTENCES: AiReviewSourceReadRequest = { ...READ, sentences: true }

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  const slug = `t-${ORG.replace(/-/g, '').slice(-12)}`
  const stale = await pool.query<{ id: string }>(
    'SELECT id FROM organization WHERE slug = $1 AND id <> $2',
    [slug, ORG],
  )
  await deleteTestOrganizations(
    pool,
    stale.rows.map(({ id }) => id),
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [ORG, 'AI source sentences org', slug],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'AI source sentences property', 'ai-source-sentences', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
})

async function store(
  options: Readonly<{
    text?: string
    reviewerName?: string | null
    provenance?: Readonly<{ aiSourceByteLength: number; aiSourceDigest: string }>
  }> = {},
) {
  const text = options.text ?? TEXT
  const reviewerName = options.reviewerName ?? null
  const stored =
    options.provenance ??
    (() => {
      const provenance = storedAiReviewSourceProvenance({
        text,
        rating: 4,
        languageCode: 'en',
        reviewedAtEpochMillis: REVIEWED_AT.getTime(),
        reviewerDisplayName: reviewerName,
      })
      return {
        aiSourceByteLength: provenance.byteLength,
        aiSourceDigest: provenance.digest,
      }
    })()
  const now = new Date()
  const repo = createReviewRepository(getDb(), () => now)
  await repo.upsert({
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'ext-ai-source-sentences',
    externalLocationId: 'locations/ai-source-sentences',
    googleConnectionId: null,
    reviewerName,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: REVIEWED_AT,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: REVIEWED_AT,
    sourceUpdatedAt: null,
    firstFetchedAt: now,
    lastFetchedAt: now,
    contentExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    contentHash: 'a'.repeat(64),
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 1,
    ...stored,
  })
  return repo
}

describe.sequential('reviewRepository.readForAi sentences', () => {
  it('answers exactly what it answered before when sentences are not asked for', async () => {
    const repo = await store()
    const result = await repo.readForAi(READ)

    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('expected an observation')
    expect('sentences' in result.observation).toBe(false)
    expect(result.observation.text).toBe(
      'Room was clean. Staff were kind. Breakfast could be better.',
    )
  })

  it('numbers the RAW text, whose line breaks the canonical text has flattened', async () => {
    const repo = await store()
    const result = await repo.readForAi(READ_WITH_SENTENCES)

    expect(result).toMatchObject({
      status: 'available',
      observation: {
        text: 'Room was clean. Staff were kind. Breakfast could be better.',
        sentences: [
          { number: 1, text: 'Room was clean.' },
          { number: 2, text: 'Staff were kind.' },
          { number: 3, text: 'Breakfast could be better.' },
        ],
      },
    })
    // The display splits the stored text the same way, so a stored pointer lands on it.
    expect(
      locateReviewSentences(TEXT).map(({ number, text }) => ({ number, text })),
    ).toEqual([
      { number: 1, text: 'Room was clean.' },
      { number: 2, text: 'Staff were kind.' },
      { number: 3, text: 'Breakfast could be better.' },
    ])
  })

  it('serves sentences that say what the canonical text says', async () => {
    const repo = await store({
      text: 'Great  room!\r\nDirty bar...\tNice staff\u2028Bad bill',
    })
    const result = await repo.readForAi(READ_WITH_SENTENCES)

    if (result.status !== 'available') throw new Error('expected an observation')
    const { text, sentences } = result.observation
    // A line separator after a word is no boundary under the rule, so "Nice staff
    // Bad bill" is one sentence, here as in the display.
    expect(sentences?.map(({ number }) => number)).toEqual([1, 2, 3])
    expect(
      locateReviewSentences('Great  room!\r\nDirty bar...\tNice staff\u2028Bad bill'),
    ).toHaveLength(3)
    expect(reviewSentencesMatchText(text ?? '', sentences ?? [])).toBe(true)
  })

  it('masks the reviewer name in each sentence, as it does in the text', async () => {
    const repo = await store({
      text: 'We asked Dr. Smith about it. He agreed. Smith left.',
      reviewerName: 'Dr. Smith',
    })
    const result = await repo.readForAi(READ_WITH_SENTENCES)

    if (result.status !== 'available') throw new Error('expected an observation')
    expect(result.observation.text).toBe(
      'We asked [PERSON] about it. He agreed. Smith left.',
    )
    expect(result.observation.sentences?.map(({ text }) => text)).toEqual([
      'We asked [PERSON]',
      '[PERSON] about it.',
      'He agreed.',
      'Smith left.',
    ])
  })

  it('cuts a row stored under revision 1 from its raw text, which revision 1 had fused', async () => {
    const canonical = canonicalizeRawAiReviewSourcePreviousRevision({
      text: TEXT,
      rating: 4,
      languageCode: 'en',
      reviewedAtEpochMillis: REVIEWED_AT.getTime(),
      reviewerDisplayName: null,
    })
    const repo = await store({
      provenance: {
        aiSourceByteLength: canonical.bytes.byteLength,
        aiSourceDigest: createHash('sha256')
          .update('ai-source-v1\0', 'utf8')
          .update(canonical.bytes)
          .digest('hex'),
      },
    })
    const result = await repo.readForAi(READ_WITH_SENTENCES)

    if (result.status !== 'available') throw new Error('expected an observation')
    expect(result.observation.text).toBe(
      'Room was clean.Staff were kind.Breakfast could be better.',
    )
    expect(result.observation.sentences?.map(({ number }) => number)).toEqual([1, 2, 3])
    // Numbered by the raw text, whichever revision the digest names.
    expect(
      reviewSentencesMatchText(
        result.observation.text ?? '',
        result.observation.sentences ?? [],
      ),
    ).toBe(true)
  })

  it('answers source_too_large for a text with more sentences than a request carries', async () => {
    const text = Array.from({ length: MAX_AI_REVIEW_SENTENCES_V1 + 1 }, () => 'a.').join(
      '\n',
    )
    const repo = await store({ text })

    await expect(repo.readForAi(READ_WITH_SENTENCES)).resolves.toEqual({
      status: 'source_too_large',
    })
    // The same review is still readable as text, as before.
    await expect(repo.readForAi(READ)).resolves.toMatchObject({ status: 'available' })
  })

  it('keeps every other denial the same when sentences are asked for', async () => {
    const repo = await store({
      provenance: { aiSourceByteLength: 100, aiSourceDigest: 'f'.repeat(64) },
    })

    await expect(repo.readForAi(READ_WITH_SENTENCES)).resolves.toEqual({
      status: 'policy_unavailable',
    })
    await expect(
      repo.readForAi({
        ...READ_WITH_SENTENCES,
        expected: { ...READ.expected, sourceRevision: 2 },
      }),
    ).resolves.toEqual({ status: 'source_revision_changed' })
  })

  it('returns no sentences for a review without text', async () => {
    const repo = await store({ text: '' })
    const result = await repo.readForAi(READ_WITH_SENTENCES)

    if (result.status !== 'available') throw new Error('expected an observation')
    expect(result.observation.sentences ?? []).toEqual([])
  })
})
