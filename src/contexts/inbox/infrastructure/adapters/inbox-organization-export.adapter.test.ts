import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  CLASSIFICATIONS_BY_CONTEXT,
  type OrganizationExportContribution,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createInboxOrganizationExportContributor } from './inbox-organization-export.adapter'

// The bundle builder lives in Identity's `application/`, which a foreign
// context may not import (src/contexts/CONTEXT.md "Dependency rules" allows an
// adapter exactly one foreign module: the port it implements). So the rules the
// builder enforces are mirrored here. `CLASSIFICATIONS_BY_CONTEXT` is imported
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
  if (contribution.coverage !== 'omitted') {
    expect(contribution.omissionCodes).toEqual([])
  }
  const mediaTypes = new Set<string>()
  for (const entry of contribution.entries) {
    expect(SAFE_PATH.test(entry.path)).toBe(true)
    expect(entry.path.startsWith(`${context}/`)).toBe(true)
    expect(entry.path.includes('..')).toBe(false)
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

/** Table marker → rows. Anything unmatched answers with no rows. */
type StubTables = Readonly<Record<string, readonly Row[]>>

/**
 * Reconstructs the literal SQL text of a drizzle `sql` template so the stub can
 * route by table name — and so a test can assert which tables were never read.
 */
function sqlTextOf(query: unknown): string {
  const chunks = (query as { queryChunks?: readonly unknown[] }).queryChunks ?? []
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value
      return Array.isArray(value) ? value.join('') : ''
    })
    .join(' ')
}

const TABLE_MARKERS = [
  'inbox_items',
  'inbox_handling_cycle_heads',
  'inbox_handling_cycle_transitions',
  'inbox_handling_cycle_response_targets',
  'inbox_handling_cycles',
  'inbox_assignment_history',
  'inbox_escalation_history',
  'inbox_feedback_handling_outcomes',
  'inbox_response_target_organization_policies',
  'inbox_private_feedback_target_property_overrides',
  'inbox_notes',
] as const

function routeKey(text: string): string {
  // Longest marker first so `inbox_handling_cycle_heads` is not swallowed by
  // `inbox_handling_cycles`.
  const marker = [...TABLE_MARKERS]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => text.includes(`FROM ${candidate}`))
  if (
    marker === 'inbox_handling_cycles' &&
    text.includes('manual_reopen_explanation IS')
  ) {
    return 'manual_reopen_explanations'
  }
  if (
    marker === 'inbox_feedback_handling_outcomes' &&
    text.includes('internal_note IS NOT NULL')
  ) {
    return 'outcome_internal_notes'
  }
  return marker ?? ''
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

const POPULATED_TABLES: StubTables = {
  inbox_items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      property_id: 'prop-b',
      source_type: 'feedback',
      source_id: '22222222-2222-4222-8222-222222222222',
      status: 'closed',
      is_escalated: true,
      escalated_by: 'user-a',
      assigned_to: 'user-b',
      created_at: '2026-08-01T00:00:00.000000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      property_id: 'prop-a',
      source_type: 'review',
      source_id: '44444444-4444-4444-8444-444444444444',
      status: 'open',
      is_escalated: false,
      escalated_by: null,
      assigned_to: null,
      created_at: '2026-08-02T00:00:00.000000Z',
    },
  ],
  inbox_handling_cycle_heads: [
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      current_cycle_number: 2,
      status: 'closed',
    },
  ],
  inbox_handling_cycles: [
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      cycle_number: 1,
      opened_reason: 'feedback_submitted',
      manual_reopen_reason: null,
      opened_by: null,
    },
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      cycle_number: 2,
      opened_reason: 'manual_reopen',
      manual_reopen_reason: 'other',
      opened_by: 'user-a',
    },
  ],
  inbox_handling_cycle_transitions: [
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      state_revision: 2,
      cycle_number: 1,
      kind: 'closed',
      transition_reason: 'private_feedback_handled',
      actor_type: 'user',
      actor_user_id: 'user-a',
    },
  ],
  inbox_handling_cycle_response_targets: [
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      cycle_number: 1,
      target_kind: 'private_feedback_handling',
      performance_eligibility: 'measured',
      result: 'on_time',
    },
  ],
  inbox_assignment_history: [
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      resulting_command_revision: 2,
      previous_assignee: null,
      next_assignee: 'user-b',
      reason: 'assign',
      actor_user_id: 'user-a',
    },
  ],
  inbox_escalation_history: [
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      resulting_command_revision: 3,
      kind: 'escalated',
      actor_user_id: 'user-a',
    },
  ],
  inbox_feedback_handling_outcomes: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      cycle_number: 1,
      outcome_revision: 1,
      outcome: 'follow_up_completed',
      recorded_by: 'user-a',
      deadline_result: 'on_time',
    },
  ],
  inbox_response_target_organization_policies: [
    { target_kind: 'private_feedback_handling', duration_minutes: 2880 },
  ],
  inbox_private_feedback_target_property_overrides: [
    { property_id: 'prop-b', enabled: true, duration_minutes: 1440 },
  ],
  inbox_notes: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      author_user_id: 'user-a',
      text: 'Called the guest back, comma , and "quote" included',
    },
  ],
  manual_reopen_explanations: [
    {
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      cycle_number: 2,
      manual_reopen_reason: 'other',
      manual_reopen_explanation: 'Reopened after the guest replied by phone',
    },
  ],
  outcome_internal_notes: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      inbox_item_id: '11111111-1111-4111-8111-111111111111',
      cycle_number: 1,
      outcome_revision: 1,
      internal_note: 'Escalated to the duty manager first',
    },
  ],
}

function contributorFor(tables: StubTables, seen: string[] = []) {
  return createInboxOrganizationExportContributor(
    createStubDatabase({ tables, snapshotAt: SNAPSHOT_AT, seen }),
  )
}

describe('Inbox Organization Export contributor', () => {
  it('satisfies the contributor contract for a populated Organization', async () => {
    const contribution = await contributorFor(POPULATED_TABLES).contribute({
      organizationId: 'org-1',
      requestId: 'request-1',
      asOf: ASOF,
    })

    expect(contribution.context).toBe('inbox')
    expect(contribution.coverage).toBe('complete')
    assertContributionSatisfiesContract(contribution)
  })

  it('classifies manager-authored free text apart from the content-free record', async () => {
    const contribution = await contributorFor(POPULATED_TABLES).contribute({
      organizationId: 'org-1',
      requestId: 'request-1',
      asOf: ASOF,
    })

    const byClassification = new Map(
      contribution.entries.map((entry) => [entry.path, entry.classification]),
    )
    expect([...byClassification.entries()].sort()).toEqual([
      ['inbox/assignment-history.csv', 'tenant_visible'],
      ['inbox/assignment-history.json', 'tenant_visible'],
      ['inbox/escalation-history.csv', 'tenant_visible'],
      ['inbox/escalation-history.json', 'tenant_visible'],
      ['inbox/handling-cycles.csv', 'tenant_visible'],
      ['inbox/handling-cycles.json', 'tenant_visible'],
      ['inbox/handling-notes.csv', 'manager_authored'],
      ['inbox/handling-notes.json', 'manager_authored'],
      ['inbox/handling-outcomes.csv', 'tenant_visible'],
      ['inbox/handling-outcomes.json', 'tenant_visible'],
      ['inbox/items.csv', 'tenant_visible'],
      ['inbox/items.json', 'tenant_visible'],
      ['inbox/notes.csv', 'manager_authored'],
      ['inbox/notes.json', 'manager_authored'],
      ['inbox/response-target-policies.csv', 'tenant_visible'],
      ['inbox/response-target-policies.json', 'tenant_visible'],
    ])
    // Manager free text must not appear anywhere outside its manager-authored
    // files, or the narrower disclosure class would be decorative.
    const managerAuthoredPaths = new Set(
      contribution.entries
        .filter((entry) => entry.classification === 'manager_authored')
        .map((entry) => entry.path),
    )
    for (const entry of contribution.entries) {
      if (managerAuthoredPaths.has(entry.path)) continue
      const text = Buffer.from(entry.bytes).toString('utf8')
      expect(text).not.toContain('Called the guest back')
      expect(text).not.toContain('Reopened after the guest replied by phone')
      expect(text).not.toContain('Escalated to the duty manager first')
    }
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
    expect(first.entries.map((entry) => entry.path)).toEqual(
      [...first.entries]
        .map((entry) => entry.path)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
        ),
    )
  })

  it('answers no_data affirmatively instead of fabricating an empty CSV', async () => {
    const contribution = await contributorFor({}).contribute({
      organizationId: 'org-empty',
      requestId: 'request-1',
      asOf: ASOF,
    })

    expect(contribution).toEqual({
      context: 'inbox',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
    assertContributionSatisfiesContract(contribution)
  })

  it('never reads personal view state, reminder schedules, or source-content copies', async () => {
    const seen: string[] = []
    await contributorFor(POPULATED_TABLES, seen).contribute({
      organizationId: 'org-1',
      requestId: 'request-1',
      asOf: ASOF,
    })

    const allSql = seen.join('\n')
    expect(allSql).not.toContain('inbox_user_views')
    expect(allSql).not.toContain('inbox_response_target_reminders')
    // The denormalized guest/provider source copies on `inbox_items`.
    expect(allSql).not.toContain('snippet')
    expect(allSql).not.toContain('reviewer_name')
    expect(allSql).not.toMatch(/\brating\b/u)
  })

  it('fails closed when the queued request is outside the bounded snapshot window', async () => {
    const contributor = contributorFor(POPULATED_TABLES)

    await expect(
      contributor.contribute({
        organizationId: 'org-1',
        requestId: 'request-1',
        asOf: new Date(new Date(SNAPSHOT_AT).getTime() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
