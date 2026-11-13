// Property context — update property use case, against real PostgreSQL: the
// repository's reads, the atomic command store and the outbox decide the outcome.

import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { organizationId, type PropertyId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { isPropertyError } from '../../domain/errors'
import { createPropertyRepository } from '../../infrastructure/repositories/property.repository'
import { seedTestProperty } from '../../infrastructure/property-test-fixtures'
import { createAtomicPropertyCommandStore } from '../../profile/update-store.server'
import type {
  PropertyCommandStore,
  UpdatePropertyCommand,
} from '../ports/property-command-store.port'
import { updateProperty } from './update-property'

const ORG_A = organizationId('org-update-property-a')
const ORG_B = organizationId('org-update-property-b')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

setupIntegrationDb({ orgA: ORG_A, orgB: ORG_B, tables: ['properties', 'outbox_events'] })

const db = getDb()
const propertyRepo = createPropertyRepository(db)

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

let sequence = 0
const build = (overrides: Parameters<typeof buildTestProperty>[0] = {}) => {
  sequence += 1
  return buildTestProperty({
    id: `update-prop-${sequence}`,
    slug: `update-slug-${sequence}`,
    organizationId: ORG_A,
    ...overrides,
  })
}

const seed = async (...properties: ReturnType<typeof build>[]) => {
  for (const property of properties) await seedTestProperty(db, property)
}

const manager = () =>
  buildTestAuthContext({ role: 'PropertyManager', organizationId: ORG_A })

const recordedUpdates = async () =>
  (
    await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'property.updated'))
  ).map((row) => row.payload as { name: string })

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  clearEventSchemas()
  registerAllEventSchemas()
  const store = createAtomicPropertyCommandStore(db)
  const updates: UpdatePropertyCommand[] = []
  const commandStore: PropertyCommandStore = {
    ...store,
    updateProperty: async (command) => {
      updates.push(command)
      return store.updateProperty(command)
    },
  }
  const useCase = updateProperty({
    propertyRepo,
    commandStore,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, propertyRepo, updates }
}

describe('updateProperty', () => {
  it('updates profile and timezone provenance without advancing the source epoch', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = manager()
    const prop = build({ timezone: 'UTC' })
    await seed(prop)

    const updated = await useCase({ propertyId: prop.id, timezone: 'Europe/London' }, ctx)

    expect(updated.timezone).toBe('Europe/London')
    expect(updated.profileVersion).toBe(prop.profileVersion + 1)
    expect(updated.sourceEpoch).toBe(prop.sourceEpoch)
    expect(updated.timezoneSource).toBe('tenant_confirmed')
    expect(updated.timezoneResolvedAt).toEqual(FIXED_TIME)
    await expect(
      propertyRepo.findById(ctx.organizationId, prop.id),
    ).resolves.toMatchObject({
      profileVersion: prop.profileVersion + 1,
      sourceEpoch: prop.sourceEpoch,
      timezone: 'Europe/London',
      timezoneSource: 'tenant_confirmed',
      timezoneResolvedAt: FIXED_TIME,
    })
  })

  it('updates slug', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({ slug: 'old-slug' })
    await seed(prop)

    const updated = await useCase({ propertyId: prop.id, slug: 'new-slug' }, ctx)

    expect(updated.slug).toBe('new-slug')
    expect(updated.profileVersion).toBe(prop.profileVersion)
    expect(updated.sourceEpoch).toBe(prop.sourceEpoch)
  })

  it('updates the tenant-confirmed default reply language without changing profile generations', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({ defaultReplyLanguage: null })
    await seed(prop)

    const updated = await useCase(
      { propertyId: prop.id, defaultReplyLanguage: 'bg-Cyrl' },
      ctx,
    )

    expect(updated.defaultReplyLanguage).toBe('bg-Cyrl')
    expect(updated.profileVersion).toBe(prop.profileVersion)
    expect(updated.sourceEpoch).toBe(prop.sourceEpoch)
  })

  it('clears the default reply language only when null is submitted explicitly', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({ defaultReplyLanguage: 'tr-Latn' })
    await seed(prop)

    const cleared = await useCase(
      { propertyId: prop.id, defaultReplyLanguage: null },
      ctx,
    )

    expect(cleared.defaultReplyLanguage).toBeNull()
  })

  it('preserves the default reply language when the field is omitted', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({
      name: 'Old Name',
      defaultReplyLanguage: 'tr-Latn',
    })
    await seed(prop)

    const updated = await useCase({ propertyId: prop.id, name: 'New Name' }, ctx)

    expect(updated.defaultReplyLanguage).toBe('tr-Latn')
  })

  // The read is unlocked and the fence covers the name and timezone only, so a
  // column repeated from that read would undo another admin's save of it.
  it('writes only the reply language when that is all the request changes', async () => {
    const { useCase, updates } = setup()
    const ctx = manager()
    const prop = build({ defaultReplyLanguage: 'tr-Latn' })
    await seed(prop)

    await useCase({ propertyId: prop.id, defaultReplyLanguage: 'bg-Cyrl' }, ctx)

    expect(updates.map((command) => command.patch)).toEqual([
      { defaultReplyLanguage: 'bg-Cyrl', updatedAt: FIXED_TIME },
    ])
  })

  it('leaves the slug, reply language and country out of a Profile save that renames the Property', async () => {
    const { useCase, updates } = setup()
    const ctx = manager()
    const prop = build({
      name: 'Old Name',
      timezone: 'UTC',
      countryCode: 'US',
    })
    await seed(prop)

    await useCase(
      { propertyId: prop.id, name: 'New Name', timezone: 'UTC', countryCode: 'US' },
      ctx,
    )

    expect(updates.map((command) => command.patch)).toEqual([
      {
        name: 'New Name',
        profileVersion: prop.profileVersion + 1,
        updatedAt: FIXED_TIME,
      },
    ])
    expect(updates[0]).toMatchObject({
      expectedSourceEpoch: prop.sourceEpoch,
      expectedProfileVersion: prop.profileVersion,
    })
  })

  it('records the timezone provenance only when the timezone changes', async () => {
    const { useCase, updates } = setup()
    const ctx = manager()
    const prop = build({ timezone: 'UTC' })
    await seed(prop)

    await useCase({ propertyId: prop.id, timezone: 'Europe/Sofia' }, ctx)

    expect(updates.map((command) => command.patch)).toEqual([
      {
        timezone: 'Europe/Sofia',
        timezoneSource: 'tenant_confirmed',
        timezoneResolvedAt: FIXED_TIME,
        profileVersion: prop.profileVersion + 1,
        updatedAt: FIXED_TIME,
      },
    ])
  })

  it('rejects users who cannot edit', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Member', organizationId: ORG_A })

    await expect(useCase({ propertyId: 'any', name: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase } = setup([]) // PM not assigned to any property
    const ctx = manager()
    const prop = build({ name: 'Name' })
    await seed(prop)

    await expect(useCase({ propertyId: prop.id, name: 'X' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const prop = build({ name: 'Old' })
    const { useCase } = setup([prop.id]) // PM assigned to this property
    const ctx = manager()
    await seed(prop)

    const updated = await useCase({ propertyId: prop.id, name: 'New' }, ctx)
    expect(updated.name).toBe('New')
  })

  it('rejects update to non-existent property', async () => {
    const { useCase } = setup()
    const ctx = manager()

    await expect(
      useCase({ propertyId: '00000000-0000-4000-8000-0000000000aa', name: 'Test' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'property_not_found',
    )
  })

  it('rejects duplicate slug', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop1 = build({ id: 'p1', slug: 'slug-a' })
    const prop2 = build({ id: 'p2', slug: 'slug-b' })
    await seed(prop1, prop2)

    await expect(
      useCase({ propertyId: prop2.id, slug: 'slug-a' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'slug_taken',
    )
  })

  it('records a property.updated fact', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({})
    await seed(prop)

    await useCase({ propertyId: prop.id, name: 'Updated' }, ctx)

    const recorded = await recordedUpdates()
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.name).toBe('Updated')
  })

  // ── Field-level validation tests ────────────────────────────────────

  it('rejects update with empty name', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({ name: 'Valid Name' })
    await seed(prop)

    await expect(useCase({ propertyId: prop.id, name: '' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })

  it('rejects update with name over 100 characters', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({ name: 'Valid' })
    await seed(prop)

    await expect(
      useCase({ propertyId: prop.id, name: 'a'.repeat(101) }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })

  it('rejects update with invalid slug', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({ slug: 'valid-slug' })
    await seed(prop)

    await expect(
      useCase({ propertyId: prop.id, slug: 'INVALID SLUG!' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_slug',
    )
  })

  it('rejects update with invalid timezone', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({ timezone: 'UTC' })
    await seed(prop)

    await expect(
      useCase({ propertyId: prop.id, timezone: 'Invalid/Zone' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_timezone',
    )
  })

  // A manager's edit of the country is the tenant confirming it, as their edit
  // of the timezone is: Reporting's setup facts read both sources and accept
  // `tenant_confirmed` only.
  it('records a country the manager changes as tenant-confirmed', async () => {
    const { useCase, updates } = setup()
    const ctx = manager()
    const prop = build({
      countryCode: 'US',
      countrySource: 'organization_default',
    })
    await seed(prop)

    const updated = await useCase({ propertyId: prop.id, countryCode: 'de' }, ctx)

    expect(updated.countryCode).toBe('DE')
    expect(updated.countrySource).toBe('tenant_confirmed')
    expect(updates.map((command) => command.patch)).toEqual([
      { countryCode: 'DE', countrySource: 'tenant_confirmed', updatedAt: FIXED_TIME },
    ])
  })

  // The Profile form always sends the country. Repeating the stored one is not
  // an edit: it moves neither the row, nor its provenance, nor the outbox.
  it('writes nothing when the Profile form repeats the stored name, timezone and country', async () => {
    const { useCase, updates } = setup()
    const ctx = manager()
    const prop = build({
      name: 'Harbour Hotel',
      timezone: 'Europe/London',
      countryCode: 'GB',
      countrySource: 'tenant_confirmed',
    })
    await seed(prop)

    const result = await useCase(
      {
        propertyId: prop.id,
        name: 'Harbour Hotel',
        timezone: 'Europe/London',
        countryCode: 'gb',
      },
      ctx,
    )

    expect(updates).toEqual([])
    await expect(recordedUpdates()).resolves.toHaveLength(0)
    expect(result.countrySource).toBe('tenant_confirmed')
  })

  it('keeps an imported country and its source when a Profile save only renames the Property', async () => {
    const { useCase, updates } = setup()
    const ctx = manager()
    const prop = build({
      name: 'Harbor Hotel',
      timezone: 'Europe/London',
      countryCode: 'GB',
      countrySource: 'tenant_confirmed',
    })
    await seed(prop)

    await useCase(
      {
        propertyId: prop.id,
        name: 'Harbour Hotel',
        timezone: 'Europe/London',
        countryCode: 'GB',
      },
      ctx,
    )

    expect(updates.map((command) => command.patch)).toEqual([
      {
        name: 'Harbour Hotel',
        profileVersion: prop.profileVersion + 1,
        updatedAt: FIXED_TIME,
      },
    ])
    await expect(
      propertyRepo.findById(ctx.organizationId, prop.id),
    ).resolves.toMatchObject({ countryCode: 'GB', countrySource: 'tenant_confirmed' })
  })

  it('does not alter the protected Google binding on profile edits', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({
      name: 'Original',
      gbpLocationId: 'location-1',
      gbpAccountId: null,
      googleBindingState: 'account_confirmation_required',
    })
    await seed(prop)

    const updated = await useCase({ propertyId: prop.id, name: 'Updated' }, ctx)

    expect(updated.name).toBe('Updated')
    expect(updated.gbpLocationId).toBe('location-1')
    expect(updated.gbpAccountId).toBeNull()
    expect(updated.googleBindingState).toBe('account_confirmation_required')
  })

  it('returns existing property unchanged when no fields are different', async () => {
    const { useCase } = setup()
    const ctx = manager()
    const prop = build({
      name: 'Same Name',
      slug: 'same-slug',
      timezone: 'UTC',
    })
    await seed(prop)

    const result = await useCase(
      { propertyId: prop.id, name: 'Same Name', slug: 'same-slug', timezone: 'UTC' },
      ctx,
    )

    // Should return the same property without persisting or recording a fact.
    expect(result.name).toBe('Same Name')
    await expect(recordedUpdates()).resolves.toHaveLength(0)
  })
})
