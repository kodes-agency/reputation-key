import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  CLASSIFICATIONS_BY_CONTEXT,
  type OrganizationExportContribution,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'
import { buildTeamContext } from '../../build'
import { createTeamOrganizationExportContributor } from './team-organization-export.adapter'

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

const TEAM = {
  id: '11111111-1111-4111-8111-111111111111',
  property_id: '22222222-2222-4222-8222-222222222222',
  name: 'Front Desk',
  description: null,
  team_lead_id: null,
  created_at: '2025-06-01T00:00:00.000000Z',
  updated_at: '2025-06-01T00:00:00.000000Z',
  deleted_at: '2025-09-01T00:00:00.000000Z',
}

const MEMBERSHIP = {
  id: '33333333-3333-4333-8333-333333333333',
  property_id: TEAM.property_id,
  team_id: TEAM.id,
  staff_participation_id: '44444444-4444-4444-8444-444444444444',
  role: 'lead',
  effective_from: '2025-06-02T00:00:00.000000Z',
  effective_to: null,
  end_reason: null,
  created_by: 'user-admin',
}

const POPULATED: readonly StubRows[] = [
  [{ snapshot_at: SNAPSHOT_AT }],
  [TEAM],
  [MEMBERSHIP],
  [],
]

const EMPTY: readonly StubRows[] = [[{ snapshot_at: SNAPSHOT_AT }], [], [], []]

const EXPECTED_ENTRIES = [
  { path: 'team/teams.csv', mediaType: 'text/csv' },
  { path: 'team/teams.json', mediaType: 'application/json' },
  { path: 'team/memberships.csv', mediaType: 'text/csv' },
  { path: 'team/memberships.json', mediaType: 'application/json' },
  { path: 'team/portal-group-scopes.csv', mediaType: 'text/csv' },
  { path: 'team/portal-group-scopes.json', mediaType: 'application/json' },
]

async function contribute(
  responses: readonly StubRows[],
): Promise<OrganizationExportContribution> {
  return createTeamOrganizationExportContributor(stubDatabase(responses)).contribute({
    organizationId: 'org-team-export',
    requestId: 'request-1',
    asOf: ASOF,
  })
}

describe('Team Organization Export contributor', () => {
  it('exports retained Team history as complete, never as an omission', async () => {
    const contribution = await contribute(POPULATED)

    expect(contribution.context).toBe('team')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(
      contribution.entries.map(({ path, mediaType }) => ({ path, mediaType })),
    ).toEqual(EXPECTED_ENTRIES)
  })

  it('keeps a soft-deleted Team in the archive with its retirement timestamp', async () => {
    const contribution = await contribute(POPULATED)
    const json = contribution.entries.find(({ path }) => path === 'team/teams.json')!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as {
      teams: readonly Record<string, unknown>[]
    }

    expect(payload.teams).toEqual([TEAM])
  })

  it('stamps only a classification Team is permitted to stamp', async () => {
    const contribution = await contribute(POPULATED)

    for (const entry of contribution.entries) {
      expect(CLASSIFICATIONS_BY_CONTEXT.team).toContain(entry.classification)
      expect(entry.path.startsWith('team/')).toBe(true)
    }
  })

  it('is byte-identical across replays of the same as-of request', async () => {
    const first = await contribute(POPULATED)
    const replay = await contribute(POPULATED)

    expect(
      first.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')),
    ).toEqual(replay.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')))
  })

  it('answers no_data for an Organization that never used Teams', async () => {
    expect(await contribute(EMPTY)).toEqual({
      context: 'team',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed outside the bounded snapshot window', async () => {
    const contributor = createTeamOrganizationExportContributor(stubDatabase(POPULATED))

    await expect(
      contributor.contribute({
        organizationId: 'org-team-export',
        requestId: 'request-1',
        asOf: new Date(SNAPSHOT_AT.getTime() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/u)
  })
})

describe('Team stays quarantined after gaining a contributor', () => {
  it('adds no key to the Team build boundary or its empty public API', () => {
    const context = buildTeamContext()

    expect(Object.keys(context.publicApi)).toEqual([])
    expect(Object.keys(context.internal.repos)).toEqual([])
    expect(Object.keys(context.internal.useCases)).toEqual([])
  })

  it('is not referenced from the inert build boundary', () => {
    const build = readFileSync(join(process.cwd(), 'src/contexts/team/build.ts'), 'utf8')

    expect(build).not.toContain('createTeamOrganizationExportContributor')
    expect(build).not.toContain('team-organization-export')
    expect(build).not.toMatch(/from ['"].*(?:application|infrastructure)\//u)
  })

  it('leaves the blocked team.use fate untouched', () => {
    expect(CAPABILITY_FATE['team.use'].fate).toBe('beta_disabled')
  })
})
