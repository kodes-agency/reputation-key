import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  CLASSIFICATIONS_BY_CONTEXT,
  type OrganizationExportContribution,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'
import { buildBadgeContext } from '../../build'
import { createBadgeOrganizationExportContributor } from './badge-organization-export.adapter'

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

const ENABLEMENT = {
  id: '11111111-1111-4111-8111-111111111111',
  badge_definition_id: '55555555-5555-4555-8555-555555555555',
  enabled: false,
  created_at: '2025-05-01T00:00:00.000000Z',
  updated_at: '2025-05-02T00:00:00.000000Z',
}

const LEGACY_AWARD = {
  id: '22222222-2222-4222-8222-222222222222',
  property_id: '33333333-3333-4333-8333-333333333333',
  portal_id: null,
  portal_group_id: null,
  badge_definition_id: ENABLEMENT.badge_definition_id,
  criteria_version: 1,
  target_type: 'portal',
  target_id: '44444444-4444-4444-8444-444444444444',
  unique_key: 'legacy-award-1',
  awarded_at: '2025-05-10T00:00:00.000000Z',
  created_at: '2025-05-10T00:00:00.000000Z',
}

const POPULATED: readonly StubRows[] = [
  [{ snapshot_at: SNAPSHOT_AT }],
  [ENABLEMENT],
  [LEGACY_AWARD],
  [],
  [],
]

const EMPTY: readonly StubRows[] = [[{ snapshot_at: SNAPSHOT_AT }], [], [], [], []]

const EXPECTED_ENTRIES = [
  { path: 'badge/enablements.csv', mediaType: 'text/csv' },
  { path: 'badge/enablements.json', mediaType: 'application/json' },
  { path: 'badge/awards.csv', mediaType: 'text/csv' },
  { path: 'badge/awards.json', mediaType: 'application/json' },
]

async function contribute(
  responses: readonly StubRows[],
): Promise<OrganizationExportContribution> {
  return createBadgeOrganizationExportContributor(stubDatabase(responses)).contribute({
    organizationId: 'org-badge-export',
    requestId: 'request-1',
    asOf: ASOF,
  })
}

describe('Badge Organization Export contributor', () => {
  it('exports retained Recognition history as complete, never as an omission', async () => {
    const contribution = await contribute(POPULATED)

    expect(contribution.context).toBe('badge')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(
      contribution.entries.map(({ path, mediaType }) => ({ path, mediaType })),
    ).toEqual(EXPECTED_ENTRIES)
  })

  it('stamps only a classification Badge is permitted to stamp', async () => {
    const contribution = await contribute(POPULATED)

    for (const entry of contribution.entries) {
      expect(CLASSIFICATIONS_BY_CONTEXT.badge).toContain(entry.classification)
      expect(entry.path.startsWith('badge/')).toBe(true)
    }
  })

  it('is byte-identical across replays of the same as-of request', async () => {
    const first = await contribute(POPULATED)
    const replay = await contribute(POPULATED)

    expect(
      first.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')),
    ).toEqual(replay.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')))
  })

  it('declares the global badge definition catalogue as out of tenant scope', async () => {
    const contribution = await contribute(POPULATED)
    const json = contribution.entries.find(
      ({ path }) => path === 'badge/enablements.json',
    )!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as {
      enablements: readonly Record<string, unknown>[]
      excludedRecordClasses: readonly { recordClass: string; reasonCode: string }[]
    }

    expect(payload.excludedRecordClasses).toContainEqual({
      recordClass: 'global_badge_definition_catalogue',
      reasonCode: 'not_organization_scoped',
    })
    // The enablement keeps the definition identifier so the archive is still
    // joinable, without copying RepKey-owned catalogue rows into a tenant ZIP.
    expect(payload.enablements[0]).toMatchObject({
      badge_definition_id: ENABLEMENT.badge_definition_id,
    })
  })

  it('answers no_data for an Organization with no Recognition history', async () => {
    expect(await contribute(EMPTY)).toEqual({
      context: 'badge',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed outside the bounded snapshot window', async () => {
    const contributor = createBadgeOrganizationExportContributor(stubDatabase(POPULATED))

    await expect(
      contributor.contribute({
        organizationId: 'org-badge-export',
        requestId: 'request-1',
        asOf: new Date(SNAPSHOT_AT.getTime() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/u)
  })
})

describe('Badge stays dark after gaining a contributor', () => {
  it('adds no key to the Badge build boundary or its empty public API', () => {
    const context = buildBadgeContext()

    expect(Object.keys(context.publicApi)).toEqual([])
    expect(Object.keys(context.internal.repos)).toEqual([])
    expect(Object.keys(context.internal.useCases)).toEqual([])
  })

  it('is not referenced from the inert build boundary', () => {
    const build = readFileSync(join(process.cwd(), 'src/contexts/badge/build.ts'), 'utf8')

    expect(build).not.toContain('createBadgeOrganizationExportContributor')
    expect(build).not.toContain('badge-organization-export')
    expect(build).toContain('publicApi: {}')
  })

  it('leaves the legacy-blocked badge.use fate untouched', () => {
    expect(CAPABILITY_FATE['badge.use'].fate).toBe('legacy_blocked')
  })
})
