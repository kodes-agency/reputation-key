// In-memory ReviewDiscoveryRepository fake.
//
// Executable statement of the discovery candidate predicate that
// review-discovery.repository.ts implements in SQL: a property is a
// candidate only when it is not deleted, lifecycle-active, google-binding
// ACTIVE (the DB CHECK constraint guarantees connection/account/location are
// all present in that state), its connection is active with usable
// credentials, and its next discovery poll is due.

import type {
  ReviewDiscoveryCandidate,
  ReviewDiscoveryRepository,
} from '#/contexts/review/application/ports/review-discovery.repository'

export type FakeDiscoveryPropertyRow = {
  propertyId: string
  organizationId: string
  connectionId: string | null
  gbpAccountId: string | null
  gbpLocationId: string | null
  /** 'unbound' | 'account_confirmation_required' | 'active' | 'disconnected' */
  googleBindingState: string
  /** 'active' | 'suspended' | 'archived' | … */
  lifecycleState: string
  deletedAt: Date | null
  /** google_connections.status */
  connectionStatus: string
  /** google_connections.credential_use_state */
  credentialUseState: string
  /** review_sync_state.next_incremental_at — null = never polled. */
  nextDueAt: Date | null
  errorClass: string | null
  lastSuccessAt: Date | null
}

export type FakeReviewDiscoveryRepository = ReviewDiscoveryRepository &
  Readonly<{ rows: FakeDiscoveryPropertyRow[] }>

const isConnectedAndActive = (row: FakeDiscoveryPropertyRow): boolean =>
  row.deletedAt === null &&
  row.lifecycleState === 'active' &&
  row.googleBindingState === 'active' &&
  row.connectionId !== null &&
  row.gbpAccountId !== null &&
  row.gbpLocationId !== null &&
  row.connectionStatus === 'active' &&
  row.credentialUseState === 'active'

const isDue = (row: FakeDiscoveryPropertyRow, due: Date): boolean =>
  row.nextDueAt === null || row.nextDueAt.getTime() <= due.getTime()

const toCandidate = (row: FakeDiscoveryPropertyRow): ReviewDiscoveryCandidate => ({
  propertyId: row.propertyId,
  organizationId: row.organizationId,
  connectionId: row.connectionId as string,
  locationName: `accounts/${row.gbpAccountId}/locations/${row.gbpLocationId}`,
})

export const createFakeReviewDiscoveryRepository = (
  rows: FakeDiscoveryPropertyRow[],
  overrides: Partial<ReviewDiscoveryRepository> = {},
): FakeReviewDiscoveryRepository => {
  const base: ReviewDiscoveryRepository = {
    findDuePropertiesBatch: async (due, cursor, limit) =>
      rows
        .filter(
          (row) =>
            isConnectedAndActive(row) &&
            isDue(row, due) &&
            (cursor === null || row.propertyId > cursor),
        )
        .sort((a, b) => (a.propertyId < b.propertyId ? -1 : 1))
        .slice(0, limit)
        .map(toCandidate),

    markDiscoveryScheduled: async (propertyId, now, nextDueAt) => {
      const row = rows.find((r) => r.propertyId === propertyId)
      if (!row) return
      row.nextDueAt = nextDueAt
      row.lastSuccessAt = now
      row.errorClass = null
    },

    markDiscoveryDeferred: async (propertyId, _now, nextDueAt, errorClass) => {
      const row = rows.find((r) => r.propertyId === propertyId)
      if (!row) return
      row.nextDueAt = nextDueAt
      row.errorClass = errorClass
    },
  }
  return { rows, ...base, ...overrides }
}

/** A connected, active, never-polled property — the discovery happy path. */
export const fakeDiscoveryProperty = (
  overrides: Partial<FakeDiscoveryPropertyRow> = {},
): FakeDiscoveryPropertyRow => ({
  propertyId: 'aa000000-0000-4000-8000-000000000001',
  organizationId: 'org-1',
  connectionId: 'bb000000-0000-4000-8000-000000000001',
  gbpAccountId: '1234567890',
  gbpLocationId: '9876543210',
  googleBindingState: 'active',
  lifecycleState: 'active',
  deletedAt: null,
  connectionStatus: 'active',
  credentialUseState: 'active',
  nextDueAt: null,
  errorClass: null,
  lastSuccessAt: null,
  ...overrides,
})
