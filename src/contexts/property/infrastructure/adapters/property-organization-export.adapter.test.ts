import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createPropertyOrganizationExportContributor } from './property-organization-export.adapter'

type Row = Record<string, unknown>

/**
 * The adapter's determinism contract is about ordering and formatting, not
 * about Postgres, so the unit test drives it through a scripted executor and
 * leaves schema truth to the integration test beside it.
 */
function fakeDatabase(responses: readonly Row[][], snapshotAt: string): Database {
  const queue = [[{ snapshot_at: snapshotAt }], ...responses]
  const snapshot = {
    execute: async () => ({ rows: queue.shift() ?? [] }),
  }
  return {
    transaction: async (run: (executor: typeof snapshot) => Promise<unknown>) =>
      run(snapshot),
  } as unknown as Database
}

const ASOF = new Date('2026-08-28T10:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T10:00:30.000000Z'

const propertyRows: Row[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'Second, Hotel',
    slug: 'second',
    lifecycle_state: 'archived',
    created_at: '2026-01-02T00:00:00.000000Z',
    updated_at: '2026-01-02T00:00:00.000000Z',
    deleted_at: null,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'First Hotel',
    slug: 'first',
    lifecycle_state: 'active',
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    deleted_at: null,
  },
]

const managerRows: Row[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    property_id: 'a0000000-0000-4000-8000-000000000001',
    user_id: 'user-b',
    effective_from: '2026-02-01T00:00:00.000000Z',
    effective_to: null,
    created_by: 'user-a',
    end_reason: null,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    property_id: 'a0000000-0000-4000-8000-000000000001',
    user_id: 'user-a',
    effective_from: '2026-01-15T00:00:00.000000Z',
    effective_to: '2026-02-01T00:00:00.000000Z',
    created_by: 'user-a',
    end_reason: 'reassigned',
  },
]

function contribute(rows: readonly Row[][], snapshotAt = SNAPSHOT_AT, asOf = ASOF) {
  return createPropertyOrganizationExportContributor(
    fakeDatabase(rows, snapshotAt),
  ).contribute({ organizationId: 'org-property-export', requestId: 'req-1', asOf })
}

describe('Property Organization Export contributor', () => {
  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(
      contribute([propertyRows, managerRows], '2026-08-28T10:16:01.000000Z'),
    ).rejects.toThrow(/snapshot window is unavailable/u)
  })
})
