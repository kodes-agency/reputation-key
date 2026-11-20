// Google numbers of a Property, read as signed-in members over PostgreSQL with
// the real tenant resolution and execution policy.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { getPropertyGoogleNumbersFn } from './property-google-numbers'

const harness = setupServerFunctionHarness()

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  return { organization, admin, manager, property }
}

async function seedSnapshot(property: TestProperty) {
  await harness.pool().query(
    `INSERT INTO metric_current_google_reputation_snapshots
         (property_id, organization_id, source_epoch, source_run_id, source_event_id,
          review_count, average_rating, evaluated_at)
       VALUES ($1, $2, 0, $3, $4, 812, 4.5, NOW())`,
    [property.id, property.organizationId, randomUUID(), randomUUID()],
  )
}

const read = (propertyId: string) => getPropertyGoogleNumbersFn({ data: { propertyId } })

describe('getPropertyGoogleNumbersFn', () => {
  it('gives an AccountAdmin the numbers Google sent for a Property of their Organization', async () => {
    const { admin, property } = await hotel()
    await seedSnapshot(property)

    const numbers = await harness.callAs(admin, () => read(property.id))

    expect(numbers).toMatchObject({ shows: 4.5, reviewCount: 812, current: false })
    expect(numbers?.asOf).toBeDefined()
  })

  it('gives a PropertyManager the Property was granted to the same numbers', async () => {
    const { manager, property } = await hotel()
    await harness.grantProperty(manager, property)
    await seedSnapshot(property)

    const numbers = await harness.callAs(manager, () => read(property.id))

    expect(numbers).toMatchObject({ shows: 4.5, reviewCount: 812 })
  })

  it('gives null when Google has sent no snapshot', async () => {
    const { admin, property } = await hotel()

    await expect(harness.callAs(admin, () => read(property.id))).resolves.toBeNull()
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { manager, property } = await hotel()
    await seedSnapshot(property)

    await expect(harness.callAs(manager, () => read(property.id))).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    })
  })

  it('shows an AccountAdmin of another Organization nothing of the Property', async () => {
    const { property } = await hotel()
    await seedSnapshot(property)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(harness.callAs(otherAdmin, () => read(property.id))).resolves.toBeNull()
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(harness.callAs(null, () => read(property.id))).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('refuses an Organization id supplied by the browser', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getPropertyGoogleNumbersFn({
          data: { propertyId: property.id, organizationId: 'foreign' },
        } as Parameters<typeof getPropertyGoogleNumbersFn>[0]),
      ),
    ).rejects.toThrow(/unrecognized_keys/)
  })

  it('refuses a Property id that is not a UUID', async () => {
    const { admin } = await hotel()

    await expect(harness.callAs(admin, () => read('bad'))).rejects.toThrow(/propertyId/)
  })
})
