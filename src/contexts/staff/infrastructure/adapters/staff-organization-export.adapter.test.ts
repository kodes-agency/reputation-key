import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  CLASSIFICATIONS_BY_CONTEXT,
  type OrganizationExportContribution,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createStaffOrganizationExportContributor } from './staff-organization-export.adapter'

type StubRows = readonly Record<string, unknown>[]

/**
 * The adapter issues exactly one snapshot-clock query followed by one query per
 * collection, in declaration order. Feeding the responses positionally keeps the
 * unit test honest about that order without a database.
 */
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

const PARTICIPANT = {
  id: '11111111-1111-4111-8111-111111111111',
  display_name: 'Front Desk, Dana "D" Rivera',
  status: 'active',
  revision: 1,
  archived_at: null,
  archive_reason: null,
  created_by: 'user-admin',
  created_at: '2026-01-01T00:00:00.000000Z',
  updated_at: '2026-01-01T00:00:00.000000Z',
}

const USER_LINK = {
  id: '22222222-2222-4222-8222-222222222222',
  staff_participant_id: PARTICIPANT.id,
  user_id: 'user-dana',
  effective_from: '2026-01-01T00:00:00.000000Z',
  effective_to: null,
  end_reason: null,
  created_by: 'user-admin',
}

const PARTICIPATION = {
  id: '33333333-3333-4333-8333-333333333333',
  property_id: '44444444-4444-4444-8444-444444444444',
  staff_participant_id: PARTICIPANT.id,
  user_id: null,
  display_name: 'Dana Rivera',
  status: 'active',
  revision: 1,
  started_at: '2026-01-02T00:00:00.000000Z',
  ended_at: null,
  archive_reason: null,
  created_by: 'user-admin',
  created_at: '2026-01-02T00:00:00.000000Z',
  updated_at: '2026-01-02T00:00:00.000000Z',
}

const POPULATED: readonly StubRows[] = [
  [{ snapshot_at: SNAPSHOT_AT }],
  [PARTICIPANT],
  [USER_LINK],
  [PARTICIPATION],
  [],
  [],
]

const EMPTY: readonly StubRows[] = [[{ snapshot_at: SNAPSHOT_AT }], [], [], [], [], []]

const EXPECTED_ENTRIES = [
  { path: 'staff/participants.csv', mediaType: 'text/csv' },
  { path: 'staff/participants.json', mediaType: 'application/json' },
  { path: 'staff/participations.csv', mediaType: 'text/csv' },
  { path: 'staff/participations.json', mediaType: 'application/json' },
  { path: 'staff/portal-responsibilities.csv', mediaType: 'text/csv' },
  { path: 'staff/portal-responsibilities.json', mediaType: 'application/json' },
  { path: 'staff/portal-group-memberships.csv', mediaType: 'text/csv' },
  { path: 'staff/portal-group-memberships.json', mediaType: 'application/json' },
]

async function contribute(
  responses: readonly StubRows[],
): Promise<OrganizationExportContribution> {
  return createStaffOrganizationExportContributor(stubDatabase(responses)).contribute({
    organizationId: 'org-staff-export',
    requestId: 'request-1',
    asOf: ASOF,
  })
}

describe('Staff Organization Export contributor', () => {
  it('emits the four declared people file pairs with CSV and JSON', async () => {
    const contribution = await contribute(POPULATED)

    expect(contribution.context).toBe('staff')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(
      contribution.entries.map(({ path, mediaType }) => ({ path, mediaType })),
    ).toEqual(EXPECTED_ENTRIES)
  })

  it('stamps only a classification Staff is permitted to stamp', async () => {
    const contribution = await contribute(POPULATED)
    const permitted = CLASSIFICATIONS_BY_CONTEXT.staff

    for (const entry of contribution.entries) {
      expect(permitted).toContain(entry.classification)
      expect(entry.path.startsWith('staff/')).toBe(true)
      expect(entry.bytes.byteLength).toBeGreaterThan(0)
    }
  })

  it('is byte-identical across replays of the same as-of request', async () => {
    const first = await contribute(POPULATED)
    const replay = await contribute(POPULATED)

    expect(
      first.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')),
    ).toEqual(replay.entries.map(({ bytes }) => Buffer.from(bytes).toString('base64')))
  })

  it('quotes CSV separators and embedded quotes instead of shifting columns', async () => {
    const contribution = await contribute(POPULATED)
    const csv = contribution.entries.find(
      ({ path }) => path === 'staff/participants.csv',
    )!
    const lines = Buffer.from(csv.bytes).toString('utf8').trimEnd().split('\n')

    expect(lines[0]).toBe(
      'record_type,id,display_name,status,revision,archived_at,archive_reason,' +
        'created_by,created_at,updated_at,staff_participant_id,user_id,' +
        'effective_from,effective_to,end_reason',
    )
    expect(lines[1]).toContain('"Front Desk, Dana ""D"" Rivera"')
    // The user-link row leaves the participant-only columns blank rather than
    // sliding its own values left.
    expect(lines[2]).toContain('staff_participant_user_link,')
    expect(lines).toHaveLength(3)
  })

  it('answers no_data affirmatively when the Organization has no people rows', async () => {
    const contribution = await contribute(EMPTY)

    expect(contribution).toEqual({
      context: 'staff',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('records the identity-owned access authority as a deliberate exclusion', async () => {
    const contribution = await contribute(POPULATED)
    const json = contribution.entries.find(
      ({ path }) => path === 'staff/participants.json',
    )!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as {
      excludedRecordClasses: readonly { recordClass: string; reasonCode: string }[]
    }

    expect(payload.excludedRecordClasses).toEqual([
      {
        recordClass: 'property_access_authority_owned_by_identity',
        reasonCode: 'exported_by_identity_contributor',
      },
      {
        recordClass: 'staff_user_login_credentials_and_sessions',
        reasonCode: 'security_secret_material',
      },
    ])
  })

  it('fails closed when the request is older than the bounded snapshot window', async () => {
    const contributor = createStaffOrganizationExportContributor(stubDatabase(POPULATED))

    await expect(
      contributor.contribute({
        organizationId: 'org-staff-export',
        requestId: 'request-1',
        asOf: new Date(SNAPSHOT_AT.getTime() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/u)
  })
})
