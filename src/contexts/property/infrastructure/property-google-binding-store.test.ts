import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { properties } from '#/shared/db/schema/property.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { purgeAiDraftsForProfile } from '#/shared/db/ai/ai-draft-purge'
import { createPropertyGoogleBindingStore } from './property-google-binding-store'
import { buildGoogleImportedProperty } from '../application/build-google-imported-property'

vi.mock('#/shared/outbox/commit', () => ({ insertOutboxRow: vi.fn() }))
vi.mock('#/shared/db/ai/ai-draft-purge', () => ({
  purgeAiDraftsForProfile: vi.fn(),
}))

const ORG = organizationId('category-lifecycle-org')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const CONNECTION = googleConnectionId('10000000-0000-4000-8000-000000000002')
const NOW = new Date('2026-11-06T10:00:00Z')

function harness(overrides: Record<string, unknown> = {}, connectionAvailable = true) {
  let row = {
    id: PROPERTY,
    organizationId: ORG,
    googleConnectionId: CONNECTION,
    gbpAccountId: 'account-1',
    gbpLocationId: 'location-1',
    googleBindingState: 'active',
    sourceEpoch: 1,
    profileVersion: 1,
    profileSource: 'tenant_confirmed',
    profileConfirmedAt: NOW,
    deletedAt: null,
    googlePrimaryCategory: 'Hotel',
    googlePrimaryCategoryUpdatedAt: NOW,
    googleReviewDestinationState: 'verified',
    googleReviewUri: 'https://search.google.com/local/writereview?placeid=location-1',
    googleReviewDestinationRetrievedAt: NOW,
    googleReviewDestinationSourceEpoch: 1,
    googleReviewDestinationProfileVersion: 1,
    ...overrides,
  } as Record<string, unknown>
  const select = () => {
    let table: unknown
    const chain = {
      from: (value: unknown) => {
        table = value
        return chain
      },
      where: () => chain,
      for: () => chain,
      limit: async () => {
        if (table === properties) return [{ ...row }]
        if (table === googleConnections && connectionAvailable)
          return [{ id: CONNECTION }]
        return []
      },
    }
    return chain
  }
  const tx = {
    select,
    execute: async (statement: SQL) => {
      const query = new PgDialect().sqlToQuery(statement)
      expect(query.sql).toMatch(/UPDATE properties/i)
      expect(query.params).toEqual([ORG, PROPERTY])
      row = { ...row, googlePrimaryCategory: null, googlePrimaryCategoryUpdatedAt: null }
      return { rows: [] }
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            row = { ...row, ...values }
            return [{ ...row }]
          },
        }),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
    delete: () => ({ where: async () => undefined }),
  }
  const db = {
    select,
    transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => {
      const before = { ...row }
      try {
        return await work(tx)
      } catch (error) {
        row = before
        throw error
      }
    },
  } as unknown as Database
  return { store: createPropertyGoogleBindingStore(db), row: () => row, tx }
}

const disconnect = {
  organizationId: ORG,
  propertyId: PROPERTY,
  expectedSourceEpoch: 1,
  expectedProfileVersion: 1,
  now: NOW,
}

beforeEach(() => vi.resetAllMocks())

describe('stored Google category lifecycle', () => {
  it('refuses to publish an imported category after the connection loses authority', async () => {
    const { store } = harness({}, false)
    const property = buildGoogleImportedProperty({
      organizationId: ORG,
      propertyId: PROPERTY,
      importItemId: '20000000-0000-4000-8000-000000000001',
      connectionId: CONNECTION,
      accountId: 'account-1',
      locationId: 'location-1',
      name: 'Property',
      address: null,
      countryCode: 'BG',
      timezone: 'Europe/Sofia',
      confirmedBy: 'manager',
      googlePrimaryCategory: 'Hotel',
      now: NOW,
    })
    await expect(
      store.createBoundProperty({
        organizationId: ORG,
        idempotencyKey: '20000000-0000-4000-8000-000000000001',
        property,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'connection_unavailable' })
    expect(insertOutboxRow).not.toHaveBeenCalled()
  })

  it('refuses to publish a relink after the connection loses authority', async () => {
    const { store, row } = harness({ googleBindingState: 'disconnected' }, false)
    const before = { ...row() }
    await expect(
      store.relink({
        ...disconnect,
        connectionId: CONNECTION,
        accountId: 'account-1',
        locationId: 'location-1',
        idempotencyKey: '20000000-0000-4000-8000-000000000001',
        profile: {
          name: 'Property',
          address: null,
          timezone: 'Europe/Sofia',
          confirmedBy: 'manager',
          googlePrimaryCategory: 'Day spa',
        },
      }),
    ).rejects.toMatchObject({ code: 'connection_unavailable' })
    expect(row()).toEqual(before)
    expect(insertOutboxRow).not.toHaveBeenCalled()
    expect(purgeAiDraftsForProfile).not.toHaveBeenCalled()
  })

  it('also clears a retained category when an already disconnected binding is retried', async () => {
    const { store, row } = harness({ googleBindingState: 'disconnected' })
    await store.disconnect(disconnect)
    expect(row()).toMatchObject({
      googlePrimaryCategory: null,
      googlePrimaryCategoryUpdatedAt: null,
      sourceEpoch: 1,
      profileVersion: 1,
    })
    expect(insertOutboxRow).not.toHaveBeenCalled()
  })
  it('clears the category and read time with disconnect while keeping provider identity', async () => {
    const { store, row, tx } = harness()
    await store.disconnect(disconnect)
    expect(row()).toMatchObject({
      googlePrimaryCategory: null,
      googlePrimaryCategoryUpdatedAt: null,
      googleBindingState: 'disconnected',
      googleConnectionId: CONNECTION,
      gbpAccountId: 'account-1',
      gbpLocationId: 'location-1',
      sourceEpoch: 2,
      profileVersion: 1,
      googleReviewDestinationState: 'awaiting_refresh',
    })
    expect(vi.mocked(purgeAiDraftsForProfile).mock.calls[0]?.[0]).toBe(tx)
    expect(vi.mocked(insertOutboxRow).mock.calls[0]?.[0]).toBe(tx)
    await store.disconnect({ ...disconnect, expectedSourceEpoch: 2 })
    expect(row().googlePrimaryCategory).toBeNull()
    expect(insertOutboxRow).toHaveBeenCalledTimes(1)
  })

  it('keeps the category and binding if the disconnect fact cannot commit', async () => {
    const { store, row } = harness()
    vi.mocked(insertOutboxRow).mockRejectedValueOnce(new Error('outbox unavailable'))
    await expect(store.disconnect(disconnect)).rejects.toThrow('outbox unavailable')
    expect(row()).toMatchObject({
      googleBindingState: 'active',
      googlePrimaryCategory: 'Hotel',
      googlePrimaryCategoryUpdatedAt: NOW,
      sourceEpoch: 1,
    })
  })

  it.each(['  Day spa  ', null])(
    'reconnect uses only the newly read category: %s',
    async (category) => {
      const { store, row } = harness()
      await store.disconnect(disconnect)
      const reconnectedAt = new Date(NOW.getTime() + 1000)
      await store.relink({
        ...disconnect,
        expectedSourceEpoch: 2,
        connectionId: CONNECTION,
        accountId: 'account-1',
        locationId: 'location-1',
        idempotencyKey: '20000000-0000-4000-8000-000000000001',
        profile: {
          name: 'Property',
          address: null,
          timezone: 'Europe/Sofia',
          confirmedBy: 'manager',
          googlePrimaryCategory: category,
        },
        now: reconnectedAt,
      })
      expect(row()).toMatchObject({
        googleBindingState: 'active',
        googlePrimaryCategory: category === null ? null : 'Day spa',
        googlePrimaryCategoryUpdatedAt: category === null ? null : reconnectedAt,
      })
    },
  )
})
