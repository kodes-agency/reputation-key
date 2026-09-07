import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createDashboardOrganizationExportAdapter } from './dashboard-organization-export.adapter'

const AS_OF = new Date('2026-08-28T09:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T09:00:30.000Z'

type Row = Record<string, unknown>

function queryText(query: SQL): string {
  const chunks = (query as unknown as { queryChunks: readonly unknown[] }).queryChunks
  return chunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null || !('value' in chunk)) return ' '
      const { value } = chunk as { value: unknown }
      return Array.isArray(value) ? value.join('') : ' '
    })
    .join('')
}

function fakeDatabase(
  milestones: readonly Row[],
  snapshotAt: string = SNAPSHOT_AT,
): Database {
  const snapshot = {
    execute: async (query: SQL) => {
      const text = queryText(query)
      if (text.includes('transaction_timestamp()')) {
        return { rows: [{ snapshot_at: snapshotAt }] }
      }
      if (text.includes('FROM setup_checklist_milestones')) return { rows: milestones }
      throw new Error(`unrouted dashboard export query: ${text}`)
    },
  }
  return {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(snapshot),
  } as unknown as Database
}

const MILESTONES: readonly Row[] = [
  {
    step: 'google_connection',
    first_completed_at: '2026-08-01T10:00:00.000000Z',
    created_at: '2026-08-01T10:00:00.000000Z',
  },
  {
    step: 'published_portal',
    first_completed_at: '2026-08-03T10:00:00.000000Z',
    created_at: '2026-08-03T10:00:00.000000Z',
  },
]

describe('Dashboard Organization Export contributor', () => {
  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(
      createDashboardOrganizationExportAdapter(
        fakeDatabase(MILESTONES, '2026-08-28T09:16:01.000Z'),
      ).contribute({
        organizationId: 'org-dashboard-export',
        requestId: 'a',
        asOf: AS_OF,
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
