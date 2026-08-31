import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  CLASSIFICATIONS_BY_CONTEXT,
  type OrganizationExportContribution,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'
import { buildLeaderboardContext } from '../../build'
import { createLeaderboardOrganizationExportContributor } from './leaderboard-organization-export.adapter'

type StubRows = readonly Record<string, unknown>[]

function stubDatabase(responses: readonly StubRows[]): Database {
  let index = 0
  const snapshot = {
    execute: async () => ({ rows: responses[index++] ?? [] }),
  }
  return {
    transaction: async (run: (tx: typeof snapshot) => Promise<unknown>) => run(snapshot),
  } as unknown as Database
}

const ASOF = new Date('2026-03-01T00:00:00.000Z')
const SNAPSHOT_AT = new Date('2026-03-01T00:01:00.000Z')

const ACTIVATION = {
  id: '11111111-1111-4111-8111-111111111111',
  property_id: '22222222-2222-4222-8222-222222222222',
  capability_policy_version: 'recognition/2025-06',
  jurisdiction: 'us',
  notice_status: 'completed',
  consultation_status: 'not_required',
  metric_definition_version_id: '33333333-3333-4333-8333-333333333333',
  aggregation: 'ratio',
  period_kind: 'monthly',
  minimum_exposure: 5,
  minimum_sample: 5,
  freshness_seconds: 86400,
  minimum_completeness: '0.90000',
  audience: 'property_managers_and_scoped_staff',
  acknowledged_by: 'user-admin',
  acknowledged_at: '2025-06-01T00:00:00.000000Z',
  effective_from: '2025-06-01T00:00:00.000000Z',
  effective_to: '2025-09-01T00:00:00.000000Z',
  status: 'inactive',
  deactivation_reason: 'beta_recognition_withdrawn',
  employment_decision_eligible: false,
  created_at: '2025-06-01T00:00:00.000000Z',
}

const LEGACY_ENTRY = {
  id: '44444444-4444-4444-8444-444444444444',
  snapshot_id: '55555555-5555-4555-8555-555555555555',
  property_id: ACTIVATION.property_id,
  rank: 1,
  target_type: 'portal',
  target_id: '66666666-6666-4666-8666-666666666666',
  score: 12.5,
  metric_value: 4.5,
  normalized_score: 0.9,
  updated_at: '2025-07-01T00:00:00.000000Z',
  created_at: '2025-07-01T00:00:00.000000Z',
}

const LEGACY_SNAPSHOT = {
  id: LEGACY_ENTRY.snapshot_id,
  property_id: ACTIVATION.property_id,
  period: '2025-07',
  scope: 'portal',
  metric_key: 'qualified_scans',
  score_key: 'overall',
  last_updated_at: '2025-07-01T00:00:00.000000Z',
  created_at: '2025-07-01T00:00:00.000000Z',
}

const POPULATED: readonly StubRows[] = [
  [{ snapshot_at: SNAPSHOT_AT }],
  [ACTIVATION],
  [],
  [],
  [],
  [],
  [LEGACY_ENTRY],
  [LEGACY_SNAPSHOT],
]

const EMPTY: readonly StubRows[] = [
  [{ snapshot_at: SNAPSHOT_AT }],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
]

const EXPECTED_ENTRIES = [
  { path: 'leaderboard/recognition-activations.csv', mediaType: 'text/csv' },
  { path: 'leaderboard/recognition-activations.json', mediaType: 'application/json' },
  { path: 'leaderboard/board-snapshots.csv', mediaType: 'text/csv' },
  { path: 'leaderboard/board-snapshots.json', mediaType: 'application/json' },
  { path: 'leaderboard/entries.csv', mediaType: 'text/csv' },
  { path: 'leaderboard/entries.json', mediaType: 'application/json' },
]

async function contribute(
  responses: readonly StubRows[],
): Promise<OrganizationExportContribution> {
  return createLeaderboardOrganizationExportContributor(
    stubDatabase(responses),
  ).contribute({
    organizationId: 'org-leaderboard-export',
    requestId: 'request-1',
    asOf: ASOF,
  })
}

describe('Leaderboard Organization Export contributor', () => {
  it('exports retained Recognition history as complete, never as an omission', async () => {
    const contribution = await contribute(POPULATED)

    expect(contribution.context).toBe('leaderboard')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(
      contribution.entries.map(({ path, mediaType }) => ({ path, mediaType })),
    ).toEqual(EXPECTED_ENTRIES)
  })

  it('carries the activation consent record a tenant needs to audit a board', async () => {
    const contribution = await contribute(POPULATED)
    const json = contribution.entries.find(
      ({ path }) => path === 'leaderboard/recognition-activations.json',
    )!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as {
      activations: readonly Record<string, unknown>[]
      excludedRecordClasses: readonly { recordClass: string; reasonCode: string }[]
    }

    expect(payload.activations).toEqual([ACTIVATION])
    expect(payload.excludedRecordClasses).toContainEqual({
      recordClass: 'legacy_ranking_snapshots_without_tenant_scoped_entries',
      reasonCode: 'not_attributable_to_organization',
    })
  })

  it('stamps only a classification Leaderboard is permitted to stamp', async () => {
    const contribution = await contribute(POPULATED)

    for (const entry of contribution.entries) {
      expect(CLASSIFICATIONS_BY_CONTEXT.leaderboard).toContain(entry.classification)
      expect(entry.path.startsWith('leaderboard/')).toBe(true)
    }
  })

  it('is byte-identical across replays of the same as-of request', async () => {
    const first = await contribute(POPULATED)
    const replay = await contribute(POPULATED)

    expect(
      first.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')),
    ).toEqual(replay.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')))
  })

  it('answers no_data for an Organization with no Recognition history', async () => {
    expect(await contribute(EMPTY)).toEqual({
      context: 'leaderboard',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed outside the bounded snapshot window', async () => {
    const contributor = createLeaderboardOrganizationExportContributor(
      stubDatabase(POPULATED),
    )

    await expect(
      contributor.contribute({
        organizationId: 'org-leaderboard-export',
        requestId: 'request-1',
        asOf: new Date(SNAPSHOT_AT.getTime() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/u)
  })
})

describe('Leaderboard stays dark after gaining a contributor', () => {
  it('adds no key to the Leaderboard build boundary or its empty public API', () => {
    const context = buildLeaderboardContext()

    expect(Object.keys(context.publicApi)).toEqual([])
    expect(Object.keys(context.internal.repos)).toEqual([])
    expect(Object.keys(context.internal.useCases)).toEqual([])
  })

  it('is not referenced from the inert build boundary', () => {
    const build = readFileSync(
      join(process.cwd(), 'src/contexts/leaderboard/build.ts'),
      'utf8',
    )

    expect(build).not.toContain('createLeaderboardOrganizationExportContributor')
    expect(build).not.toContain('leaderboard-organization-export')
    expect(build).toContain('publicApi: {}')
  })

  it('leaves the legacy-blocked leaderboard.use fate untouched', () => {
    expect(CAPABILITY_FATE['leaderboard.use'].fate).toBe('legacy_blocked')
  })
})
