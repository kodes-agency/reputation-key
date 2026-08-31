import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  CLASSIFICATIONS_BY_CONTEXT,
  type OrganizationExportContribution,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createReviewOrganizationExportContributor } from './review-organization-export.adapter'

// The bundle builder lives in Identity's `application/`, which a foreign
// context may not import (src/contexts/CONTEXT.md "Dependency rules" allows an
// adapter exactly one foreign module: the port it implements). The rules the
// builder enforces are mirrored here; `CLASSIFICATIONS_BY_CONTEXT` is imported
// from the port rather than restated, because that map is the rule itself.
const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,199}$/
const FORBIDDEN_PATH_COMPONENT =
  /(?:^|[/_.-])(?:oauth|secrets?|sessions?|cookies?|passwords?|hash(?:es)?|credentials?|tokens?|keys?|queues?|outbox(?:es)?|receipts?|rate.?limits?|fraud|security|prompts?|inferences?|operational.?actions?)(?=$|[/_.-])/iu

function assertContributionSatisfiesContract(
  contribution: OrganizationExportContribution,
): void {
  const { context } = contribution
  if (contribution.coverage === 'complete') {
    expect(contribution.entries.length).toBeGreaterThan(0)
  } else {
    expect(contribution.entries).toEqual([])
  }
  expect(contribution.omissionCodes).toEqual([])
  const mediaTypes = new Set<string>()
  for (const entry of contribution.entries) {
    expect(SAFE_PATH.test(entry.path)).toBe(true)
    expect(entry.path.startsWith(`${context}/`)).toBe(true)
    expect(FORBIDDEN_PATH_COMPONENT.test(entry.path)).toBe(false)
    expect(CLASSIFICATIONS_BY_CONTEXT[context]).toContain(entry.classification)
    expect(entry.bytes.byteLength).toBeGreaterThan(0)
    const text = Buffer.from(entry.bytes).toString('utf8')
    if (entry.mediaType === 'application/json')
      expect(() => JSON.parse(text)).not.toThrow()
    mediaTypes.add(entry.mediaType)
  }
  if (contribution.coverage === 'complete') {
    expect(mediaTypes.has('text/csv')).toBe(true)
    expect(mediaTypes.has('application/json')).toBe(true)
  }
}

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
  it('emits only the three manager-authored reply files', async () => {
    const contribution = await contributorFor(POPULATED_TABLES).contribute({
      organizationId: 'org-1',
      requestId: 'request-1',
      asOf: ASOF,
    })

    expect(contribution.context).toBe('review')
    expect(contribution.coverage).toBe('complete')
    assertContributionSatisfiesContract(contribution)
    expect(contribution.entries.map((entry) => entry.path)).toEqual([
      'review/replies.csv',
      'review/replies.json',
      'review/reply-authorizations.csv',
      'review/reply-authorizations.json',
      'review/reply-publication-attempts.csv',
      'review/reply-publication-attempts.json',
    ])
    // Review may stamp exactly one disclosure class; a widened one would be a
    // provider-content leak wearing a manager-authored label.
    expect(new Set(contribution.entries.map((entry) => entry.classification))).toEqual(
      new Set(['manager_authored']),
    )
  })

  it('carries AI provenance for an adopted draft without any prompt material', async () => {
    const contribution = await contributorFor(POPULATED_TABLES).contribute({
      organizationId: 'org-1',
      requestId: 'request-1',
      asOf: ASOF,
    })

    const json = contribution.entries.find(
      (entry) => entry.path === 'review/replies.json',
    )!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as {
      replies: readonly Record<string, unknown>[]
    }
    expect(payload.replies[0]).toMatchObject({
      id: REPLY_ID,
      ai_generated: true,
      authorship: 'ai_assisted',
      origin_ai_profile_version: 'reply-draft-v2',
      origin_reply_drafting_epoch: 1,
      origin_operation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      text: 'Thank you for staying with us — the manager wrote this.',
    })
  })

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

  it('is byte-identical on replay for the same organization and as-of', async () => {
    const contributor = contributorFor(POPULATED_TABLES)
    const first = await contributor.contribute({
      organizationId: 'org-1',
      requestId: 'request-1',
      asOf: ASOF,
    })
    const replay = await contributor.contribute({
      organizationId: 'org-1',
      requestId: 'request-2-different-request-id',
      asOf: ASOF,
    })

    expect(first).toEqual(replay)
  })

  it('answers no_data affirmatively when no manager reply work exists', async () => {
    const contribution = await contributorFor({}).contribute({
      organizationId: 'org-empty',
      requestId: 'request-1',
      asOf: ASOF,
    })

    expect(contribution).toEqual({
      context: 'review',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
    assertContributionSatisfiesContract(contribution)
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
