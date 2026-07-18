// Property context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildPropertyContext } from './build'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { organizationId, propertyId, googleConnectionId } from '#/shared/domain/ids'
import { buildTestProperty } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { properties } from '#/shared/db/schema/property.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  }),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const createStubStaffApi = (): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

// Minimal tx stub: properties insert returns the inserted row (the command
// store maps it back to the domain Property); the outbox insert is a no-op.
const makeMockDb = () => ({
  transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: (table: unknown) => ({
        values: (row: Record<string, unknown>) => {
          if (table === properties) {
            return { returning: async () => [row] }
          }
          return Promise.resolve()
        },
      }),
    }),
})

describe('PropertyPublicApi', () => {
  it('propertyExists returns true when repo has the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const prop = buildTestProperty({ id: 'prop-1' })
    repo.seed([prop])

    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      events,
      clock,
      staffPublicApi,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    const exists = await publicApi.propertyExists(prop.organizationId, prop.id)
    expect(exists).toBe(true)
  })

  it('propertyExists returns false when repo does not have the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      events,
      clock,
      staffPublicApi,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    const exists = await publicApi.propertyExists(
      organizationId('org-1'),
      propertyId('nonexistent'),
    )
    expect(exists).toBe(false)
  })
})

// BQC-4.1 / ADR 0048: the import path emits the initial-sync trigger
// (gbpLocationName on property.created) only for properties inside the
// approved cell. Unresolved/denied regions are created but never triggered.
describe('PropertyPublicApi.importProperty — initial-sync trigger gate', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  const buildApi = () => {
    const events = createCapturingEventBus()
    const { publicApi } = buildPropertyContext({
      db: makeMockDb() as never,
      repo: createInMemoryPropertyRepo(),
      events,
      clock: () => new Date('2026-07-18T12:00:00Z'),
      staffPublicApi: createStubStaffApi(),
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })
    return { publicApi, events }
  }

  const baseInput = {
    orgId: organizationId('org-import-1'),
    name: 'Imported Hotel',
    slug: 'imported-hotel-abc123',
    gbpPlaceId: 'ChIJ-import-1',
    googleConnectionId: googleConnectionId('e0000000-0000-0000-0000-000000000009'),
    gbpLocationName: 'accounts/123/locations/456',
  }

  it('emits the initial-sync trigger for a property resolved into the us cell', async () => {
    const { publicApi, events } = buildApi()

    await publicApi.importProperty({ ...baseInput, countryCode: 'US' })

    const created = events.capturedByTag('property.created')
    expect(created).toHaveLength(1)
    expect(created[0].processingRegion).toBe('us')
    expect(created[0].gbpLocationName).toBe('accounts/123/locations/456')
  })

  it('does not emit the initial-sync trigger when GBP gave no country', async () => {
    const { publicApi, events } = buildApi()

    await publicApi.importProperty({ ...baseInput, countryCode: null })

    const created = events.capturedByTag('property.created')
    expect(created).toHaveLength(1)
    expect(created[0].processingRegion).toBe('unresolved')
    expect(created[0].gbpLocationName).toBeUndefined()
  })

  it.each(['JP', 'DE'])(
    'does not emit the initial-sync trigger for denied region (%s)',
    async (countryCode) => {
      const { publicApi, events } = buildApi()

      await publicApi.importProperty({ ...baseInput, countryCode })

      const created = events.capturedByTag('property.created')
      expect(created).toHaveLength(1)
      expect(created[0].processingRegion).not.toBe('us')
      expect(created[0].gbpLocationName).toBeUndefined()
    },
  )
})
