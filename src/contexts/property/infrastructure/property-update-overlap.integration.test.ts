// Two admins saving different Property settings at the same moment, against
// real PostgreSQL, through the real use case, repository and command store.
//
// Settings › Replies sends only the reply language; Settings › Profile sends
// name, country and timezone. Each request reads the row before it writes, so
// the second writer here is held after its read until the first has committed:
// the overlap two requests have in production, made deterministic.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { PropertyRepository } from '../application/ports/property.repository'
import {
  updateProperty,
  type UpdatePropertyInput,
} from '../application/use-cases/update-property'
import { isPropertyError } from '../domain/errors'
import { createAtomicPropertyCommandStore } from './property-command-store'
import { createPropertyRepository } from './repositories/property.repository'

const db = getDb()
const ORGANIZATION_ID = organizationId('org-property-update-overlap')
const PROPERTY_ID = propertyId('f5100000-0000-4000-8000-000000000001')
const SEEDED_AT = new Date('2026-10-01T09:00:00.000Z')
const SAVED_AT = new Date('2026-10-13T09:00:00.000Z')
const PROFILE_VERSION = 3
const ctx = buildTestAuthContext({
  organizationId: ORGANIZATION_ID,
  role: 'AccountAdmin',
})

const repo = createPropertyRepository(db)

function saveWith(propertyRepo: PropertyRepository) {
  return updateProperty({
    propertyRepo,
    commandStore: createAtomicPropertyCommandStore(db),
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    clock: () => SAVED_AT,
  })
}

/**
 * Run `second` so that it has read the Property before `first` commits and
 * writes after it: `second`'s read returns only once `first` has finished.
 */
async function saveOverlapping(
  first: Omit<UpdatePropertyInput, 'propertyId'>,
  second: Omit<UpdatePropertyInput, 'propertyId'>,
) {
  let releaseSecond: () => void = () => undefined
  const firstCommitted = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  let secondHasRead: () => void = () => undefined
  const secondRead = new Promise<void>((resolve) => {
    secondHasRead = resolve
  })
  const heldAfterRead: PropertyRepository = {
    ...repo,
    findById: async (organization, id) => {
      const row = await repo.findById(organization, id)
      secondHasRead()
      await firstCommitted
      return row
    },
  }

  const secondSave = saveWith(heldAfterRead)({ propertyId: PROPERTY_ID, ...second }, ctx)
  // Attach the handler now: a refusal must not surface as an unhandled rejection
  // while the first save is still running.
  const secondOutcome = secondSave.then(
    (property) => ({ ok: true as const, property }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  await secondRead
  const firstResult = await saveWith(repo)({ propertyId: PROPERTY_ID, ...first }, ctx)
  releaseSecond()
  return { firstResult, second: await secondOutcome }
}

async function readRow() {
  const result = await db.execute(sql`
    SELECT name, slug, timezone, default_reply_language, profile_version, source_epoch,
           country_code, country_source
    FROM properties WHERE id = ${PROPERTY_ID}
  `)
  return result.rows[0]
}

async function updatedFacts() {
  const result = await db.execute(sql`
    SELECT payload->>'name' AS name, payload->>'slug' AS slug
    FROM outbox_events
    WHERE organization_id = ${ORGANIZATION_ID} AND event_type = 'property.updated'
    ORDER BY payload->>'name', payload->>'slug'
  `)
  return result.rows
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORGANIZATION_ID}, 'Property Update Overlap', ${ORGANIZATION_ID}, ${SEEDED_AT})
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, created_at, updated_at
    ) VALUES (
      ${PROPERTY_ID}, ${ORGANIZATION_ID}, 'Harbour Hotel', 'harbour-hotel', 'UTC',
      ${SEEDED_AT}, ${SEEDED_AT}
    )
    ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(async () => {
  await db.execute(
    sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
  )
  await db.execute(sql`
    UPDATE properties
    SET name = 'Harbour Hotel',
        slug = 'harbour-hotel',
        timezone = 'UTC',
        default_reply_language = 'tr-Latn',
        country_code = 'GB',
        country_source = 'tenant_confirmed',
        profile_version = ${PROFILE_VERSION},
        updated_at = ${SEEDED_AT}
    WHERE id = ${PROPERTY_ID}
  `)
})

afterAll(async () => {
  await db.execute(
    sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}`)
  await deleteTestOrganizations(db, [ORGANIZATION_ID])
})

describe('Property update — two saves that overlap', () => {
  it('keeps the reply language one admin saved while another renames the Property', async () => {
    const { second } = await saveOverlapping(
      { defaultReplyLanguage: 'bg-Cyrl' },
      { name: 'Harbour Hotel & Spa', timezone: 'UTC' },
    )

    expect(second.ok).toBe(true)
    expect(await readRow()).toMatchObject({
      name: 'Harbour Hotel & Spa',
      default_reply_language: 'bg-Cyrl',
      profile_version: PROFILE_VERSION + 1,
    })
    // The rename answers with the row as committed, not with its own stale read.
    expect(second.ok && second.property).toMatchObject({
      name: 'Harbour Hotel & Spa',
      defaultReplyLanguage: 'bg-Cyrl',
      profileVersion: PROFILE_VERSION + 1,
    })
  })

  it('keeps a slug one admin saved while another changes the reply language', async () => {
    const { second } = await saveOverlapping(
      { slug: 'harbour-hotel-varna' },
      { defaultReplyLanguage: 'bg-Cyrl' },
    )

    expect(second.ok).toBe(true)
    expect(await readRow()).toMatchObject({
      slug: 'harbour-hotel-varna',
      default_reply_language: 'bg-Cyrl',
      profile_version: PROFILE_VERSION,
    })
    // Each fact names the Property as that save left it.
    expect(await updatedFacts()).toEqual([
      { name: 'Harbour Hotel', slug: 'harbour-hotel-varna' },
      { name: 'Harbour Hotel', slug: 'harbour-hotel-varna' },
    ])
  })

  it('keeps a cleared reply language while another admin renames the Property', async () => {
    const { second } = await saveOverlapping(
      { defaultReplyLanguage: null },
      { name: 'Harbour Hotel & Spa' },
    )

    expect(second.ok).toBe(true)
    expect(await readRow()).toMatchObject({
      name: 'Harbour Hotel & Spa',
      default_reply_language: null,
    })
  })

  // The Profile form sends the country it was shown with every save.
  it('keeps a country one admin saved while another saves the Profile form with a new timezone', async () => {
    const { second } = await saveOverlapping(
      { countryCode: 'IE' },
      { name: 'Harbour Hotel', timezone: 'Europe/London', countryCode: 'GB' },
    )

    expect(second.ok).toBe(true)
    expect(await readRow()).toMatchObject({
      timezone: 'Europe/London',
      country_code: 'IE',
      country_source: 'tenant_confirmed',
    })
  })

  it('leaves the row and the outbox alone when the Profile form is saved unchanged', async () => {
    const saved = await saveWith(repo)(
      {
        propertyId: PROPERTY_ID,
        name: 'Harbour Hotel',
        timezone: 'UTC',
        countryCode: 'GB',
      },
      ctx,
    )

    expect(saved).toMatchObject({ countryCode: 'GB', countrySource: 'tenant_confirmed' })
    expect(await readRow()).toMatchObject({
      country_code: 'GB',
      country_source: 'tenant_confirmed',
      profile_version: PROFILE_VERSION,
    })
    expect(await updatedFacts()).toEqual([])
  })

  it('still refuses a save that read the Property before a rename committed', async () => {
    const { second } = await saveOverlapping(
      { name: 'Harbour Hotel & Spa' },
      { defaultReplyLanguage: 'bg-Cyrl' },
    )

    expect(second.ok).toBe(false)
    expect(!second.ok && isPropertyError(second.error) && second.error.code).toBe(
      'stale_property',
    )
    expect(await readRow()).toMatchObject({
      name: 'Harbour Hotel & Spa',
      default_reply_language: 'tr-Latn',
      profile_version: PROFILE_VERSION + 1,
    })
    expect(await updatedFacts()).toEqual([
      { name: 'Harbour Hotel & Spa', slug: 'harbour-hotel' },
    ])
  })
})
