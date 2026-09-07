import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createReviewOrganizationExportContributor } from './review-organization-export.adapter'

type Row = Record<string, unknown>
type StubTables = Readonly<Record<string, readonly Row[]>>

function sqlTextOf(query: unknown): string {
  const chunks = (query as { queryChunks?: readonly unknown[] }).queryChunks ?? []
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value
      return Array.isArray(value) ? value.join('') : ''
    })
    .join(' ')
}

function routeKey(text: string): string {
  if (text.includes('FROM reply_publication_authorizations')) return 'authorizations'
  if (text.includes('FROM reply_publication_attempts')) return 'attempts'
  if (text.includes('FROM replies')) return 'replies'
  return ''
}

function createStubDatabase(input: {
  tables: StubTables
  snapshotAt: string
  seen: string[]
}): Database {
  const snapshot = {
    execute: async (query: unknown) => {
      const text = sqlTextOf(query)
      input.seen.push(text)
      if (text.includes('transaction_timestamp()')) {
        return { rows: [{ snapshot_at: input.snapshotAt }] }
      }
      return { rows: input.tables[routeKey(text)] ?? [] }
    },
  }
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(snapshot),
  } as unknown as Database
}

const ASOF = new Date('2026-08-28T09:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T09:00:30.000Z'

const REPLY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REVIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const POPULATED_TABLES: StubTables = {
  replies: [
    {
      id: REPLY_ID,
      review_id: REVIEW_ID,
      text: 'Thank you for staying with us — the manager wrote this.',
      reply_language_tag: 'en-Latn-US',
      status: 'published',
      source: 'internal',
      created_by: 'user-a',
      approved_by: 'user-b',
      rejected_by: null,
      rejection_reason: null,
      ai_generated: true,
      authorship: 'ai_assisted',
      origin_operation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      origin_source_epoch: 0,
      origin_source_revision: 1,
      origin_base_reply_state_revision: 0,
      origin_reply_drafting_epoch: 1,
      origin_property_profile_version: 1,
      origin_ai_profile_version: 'reply-draft-v2',
      origin_reply_template_id: null,
      origin_concrete_language_tag: 'en-Latn-US',
      origin_template_group: 'en-Latn',
      publication_state: 'published',
      publication_cycle: 1,
      publication_attempts: 1,
    },
  ],
  authorizations: [
    {
      reply_id: REPLY_ID,
      review_id: REVIEW_ID,
      property_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      publication_cycle: 1,
      source_epoch: 0,
      material_review_revision: 1,
      base_observation_revision: 0,
      authorized_by_user_id: 'user-b',
      reply_state_revision: 2,
      authorized_at: '2026-08-10T00:00:00.000000Z',
    },
  ],
  attempts: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      reply_id: REPLY_ID,
      review_id: REVIEW_ID,
      property_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      publication_cycle: 1,
      attempt_number: 1,
      outcome: 'confirmed',
      confirmed_observation_revision: 3,
    },
  ],
}

function contributorFor(tables: StubTables, seen: string[] = []) {
  return createReviewOrganizationExportContributor(
    createStubDatabase({ tables, snapshotAt: SNAPSHOT_AT, seen }),
  )
}

describe('Review Organization Export contributor', () => {
  it('never reads a Google-controlled review, observation, or provider subject table', async () => {
    const seen: string[] = []
    await contributorFor(POPULATED_TABLES, seen).contribute({
      organizationId: 'org-1',
      requestId: 'request-1',
      asOf: ASOF,
    })

    const allSql = seen.join('\n')
    for (const table of [
      'FROM reviews',
      'review_source_contents',
      'review_source_observations',
      'material_review_revisions',
      'google_reply_observations',
      'review_provider_subjects',
      'review_provider_snapshot_members',
      'review_google_reputation_snapshot_facts',
      'ai_suggested_drafts',
    ]) {
      expect(allSql).not.toContain(table)
    }
    // Provider-mirrored reply text is fenced out at the query, not downstream.
    expect(allSql).toContain("source = 'internal'")
    expect(allSql).not.toContain('provider_operation_key')
    expect(allSql).not.toContain('provider_correlation_id')
    expect(allSql).not.toContain('expected_reply_digest')
  })

  it('fails closed when the queued request is outside the bounded snapshot window', async () => {
    await expect(
      contributorFor(POPULATED_TABLES).contribute({
        organizationId: 'org-1',
        requestId: 'request-1',
        asOf: new Date(new Date(SNAPSHOT_AT).getTime() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
