// Approved destinations of a Property, managed through the public use cases
// against real PostgreSQL: what is stored after a request, a turn-off or a
// revalidation run, and what the stores refuse. Only the network check (a
// transport) and the staff assignment lookup are stand-ins.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, userId } from '#/shared/domain/ids'
import { createPortalRepository } from '../../infrastructure/repositories/portal.repository'
import { createPortalApprovedDestinationRepository } from '../../infrastructure/repositories/portal-approved-destination.repository'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import type { PortalDestinationNetworkValidation } from '../ports/portal-destination-network-validator.port'
import {
  disablePortalApprovedDestination,
  listPortalApprovedDestinations,
  requestPortalApprovedDestination,
  revalidatePortalApprovedDestinations,
} from './manage-portal-approved-destinations'

const db = getDb()
const NOW = new Date('2026-08-27T12:00:00.000Z')
const LAST_VALIDATED = new Date('2026-08-26T12:00:00.000Z')
const ORG = `org-approved-destinations-${randomUUID()}`
const PROPERTY = randomUUID()
const PORTAL = randomUUID()
const OTHER_PROPERTY = randomUUID()
const unique = randomUUID().slice(0, 8)

const admin = buildTestAuthContext({
  role: 'AccountAdmin',
  organizationId: organizationId(ORG),
  userId: userId(`admin-${unique}`),
})

type Seed = Readonly<{
  uri: string
  sourceType?: 'custom' | 'contact' | 'recognized'
  state?: 'pending' | 'approved'
  validatedAt?: Date
  nextAttemptAt?: Date | null
  validationFailures?: number
  property?: string
}>

async function seedDestination(seed: Seed): Promise<string> {
  const id = randomUUID()
  const sourceType = seed.sourceType ?? 'custom'
  const state = seed.state ?? 'approved'
  await db.execute(sql`
    INSERT INTO portal_approved_destinations (
      id, organization_id, property_id, normalized_uri, hostname, source_type,
      approval_state, validation_version, requested_by, approved_by, approved_at,
      last_validated_at, next_attempt_at, validation_failures
    ) VALUES (
      ${id}::uuid, ${ORG}, ${seed.property ?? PROPERTY}, ${seed.uri},
      ${seed.uri.replace(/^[a-z]+:(\/\/)?/u, '').split('/')[0]}, ${sourceType},
      ${state}, ${PORTAL_DESTINATION_VALIDATION_VERSION}, ${admin.userId},
      ${state === 'approved' ? admin.userId : null},
      ${state === 'approved' ? (seed.validatedAt ?? LAST_VALIDATED) : null},
      ${seed.validatedAt ?? LAST_VALIDATED}, ${seed.nextAttemptAt ?? null},
      ${seed.validationFailures ?? 0}
    )
  `)
  return id
}

const stored = async (id: string) => {
  const rows = await db.execute(sql`
    SELECT approval_state, disabled_reason, next_attempt_at, validation_failures,
           last_validated_at
    FROM portal_approved_destinations WHERE id = ${id}::uuid
  `)
  return rows.rows[0]
}

const approvalOf = async (id: string) => {
  const rows = await db.execute(sql`
    SELECT approved_by, approved_at FROM portal_approved_destinations
    WHERE id = ${id}::uuid
  `)
  return rows.rows[0]
}

const storedUris = async (property = PROPERTY) => {
  const rows = await db.execute(sql`
    SELECT normalized_uri FROM portal_approved_destinations
    WHERE organization_id = ${ORG} AND property_id = ${property}
    ORDER BY normalized_uri
  `)
  return rows.rows.map((row) => row.normalized_uri)
}

const site = (path: string) => `https://${unique}.example.com/${path}`

type Validation = (
  uri: string,
) => PortalDestinationNetworkValidation | Promise<PortalDestinationNetworkValidation>

function build(validation: Validation) {
  return {
    portalRepo: createPortalRepository(db),
    destinationRepo: createPortalApprovedDestinationRepository(db),
    destinationNetworkValidator: { validate: async (uri: string) => validation(uri) },
    staffPublicApi: { accessiblePropertyIds: async () => null } as never,
    idGen: () => randomUUID(),
    clock: () => NOW,
  }
}

const safe = (uri: string): PortalDestinationNetworkValidation => ({
  outcome: 'safe',
  validatedAt: NOW,
  finalUri: uri,
  redirectCount: 0,
})

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Approved Destinations', ${ORG}, now())
  `)
  for (const property of [PROPERTY, OTHER_PROPERTY]) {
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone)
      VALUES (${property}, ${ORG}, 'Destinations Property', ${property}, 'UTC')
    `)
  }
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state, theme
    ) VALUES (${PORTAL}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY},
      'Destinations Portal', ${PORTAL}, 'draft', '{"primaryColor":"#6366F1"}'::jsonb)
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  for (const table of ['portal_approved_destinations', 'portals', 'properties']) {
    await db.execute(
      sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${ORG}`,
    )
  }
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe('requestPortalApprovedDestination', () => {
  const request = (uri: string, validation: PortalDestinationNetworkValidation) =>
    requestPortalApprovedDestination(build(() => validation))(
      { portalId: PORTAL, uri },
      admin,
    )

  it('tells the admin an address that does not exist is theirs to fix, and stores nothing', async () => {
    const uri = site('missing')
    const refusal = request(uri, {
      outcome: 'unavailable',
      reason: 'dns_not_found',
      observedAt: NOW,
    })

    await expect(refusal).rejects.toMatchObject({
      code: 'invalid_url',
      message: 'We could not find that web address. Check it for a typo and try again.',
    })
    expect(await storedUris()).not.toContain(uri)
  })

  it('asks for a retry only when the check itself could not run, and stores nothing', async () => {
    const uri = site('retry')
    const refusal = request(uri, {
      outcome: 'unavailable',
      reason: 'request_unavailable',
      observedAt: NOW,
    })

    await expect(refusal).rejects.toMatchObject({
      code: 'destination_not_approved',
      message: 'Destination validation is temporarily unavailable. Please try again.',
    })
    expect(await storedUris()).not.toContain(uri)
  })

  it('refuses an address whose network target is unsafe, and stores nothing', async () => {
    const uri = site('unsafe')

    await expect(
      request(uri, { outcome: 'unsafe', reason: 'dns_non_public', observedAt: NOW }),
    ).rejects.toMatchObject({ code: 'invalid_url' })
    expect(await storedUris()).not.toContain(uri)
  })

  it('stores a checked custom address as pending until an admin approves it', async () => {
    const uri = site('menu')

    const requested = await request(uri, safe(uri))

    expect(requested).toMatchObject({ approvalState: 'pending', sourceType: 'custom' })
    expect(await storedUris()).toContain(requested.normalizedUri)
  })
})

describe('listPortalApprovedDestinations', () => {
  it('lists the sites allowed for links of its own Property, and no phone number or email address', async () => {
    const list = `https://${unique}-list.example.com/`
    await seedDestination({ uri: list })
    await seedDestination({ uri: `tel:+1555${unique}`, sourceType: 'contact' })
    await seedDestination({
      uri: `mailto:front@${unique}.example.com`,
      sourceType: 'contact',
    })
    await seedDestination({
      uri: `https://${unique}-other.example.com/`,
      property: OTHER_PROPERTY,
    })

    const listed = await listPortalApprovedDestinations(build(safe))(
      { portalId: PORTAL },
      admin,
    )

    const uris = listed.destinations.map((destination) => destination.normalizedUri)
    expect(uris).toContain(list)
    expect(uris.some((uri) => uri.startsWith('tel:') || uri.startsWith('mailto:'))).toBe(
      false,
    )
    expect(uris).not.toContain(`https://${unique}-other.example.com/`)
    expect(listed.canApprove).toBe(true)
  })
})

describe('disablePortalApprovedDestination', () => {
  const turnOff = (id: string) =>
    disablePortalApprovedDestination(build(safe))(
      { portalId: PORTAL, destinationId: id, reason: 'Turned off' },
      admin,
    )

  it('refuses to turn off a phone number or an email address, and leaves it approved', async () => {
    const id = await seedDestination({
      uri: `tel:+1666${unique}`,
      sourceType: 'contact',
    })

    await expect(turnOff(id)).rejects.toMatchObject({
      code: 'destination_not_approved',
      message:
        'A phone number or an email address cannot be turned off. Change or delete its tile instead.',
    })
    expect(await stored(id)).toMatchObject({ approval_state: 'approved' })
  })

  it('still turns off a site, and records why', async () => {
    const id = await seedDestination({ uri: site('turn-off') })

    await expect(turnOff(id)).resolves.toMatchObject({ id, approvalState: 'disabled' })
    expect(await stored(id)).toMatchObject({
      approval_state: 'disabled',
      disabled_reason: 'Turned off',
    })
  })

  it('answers not found for a destination of another Property of the organization', async () => {
    const id = await seedDestination({
      uri: site('elsewhere'),
      property: OTHER_PROPERTY,
    })

    await expect(turnOff(id)).rejects.toMatchObject({ code: 'destination_not_found' })
    expect(await stored(id)).toMatchObject({ approval_state: 'approved' })
  })
})

describe('revalidatePortalApprovedDestinations', () => {
  const OLD = new Date(NOW.getTime() - 3 * 60 * 60 * 1_000)
  const ownOnly = async (organization: string) => organization === ORG

  /** The run, limited to this suite's rows (other suites share the database). */
  const run = async (
    validation: Validation,
    authorizeScope: (
      organization: string,
      property: string,
    ) => Promise<boolean> = ownOnly,
  ) => {
    const { destinationRepo, destinationNetworkValidator, clock } = build(validation)
    return revalidatePortalApprovedDestinations({
      destinationRepo,
      destinationNetworkValidator,
      clock,
    })({ limit: 500, authorizeScope })
  }

  it('quarantines a later-unsafe destination, asks for exactly its scope, and records the reason', async () => {
    const id = await seedDestination({ uri: site('later-unsafe'), validatedAt: OLD })
    const asked: Array<readonly [string, string]> = []

    const outcome = await run(
      (uri) =>
        uri === site('later-unsafe')
          ? { outcome: 'unsafe', reason: 'redirect_host_changed', observedAt: NOW }
          : safe(uri),
      async (organization, property) => {
        asked.push([organization, property])
        return organization === ORG
      },
    )

    expect(asked).toContainEqual([ORG, PROPERTY])
    expect(outcome.visitedIds).toContain(id)
    const row = await stored(id)
    expect(row).toMatchObject({
      approval_state: 'quarantined',
      disabled_reason: 'network_validation:redirect_host_changed',
      validation_failures: 0,
    })
    expect(new Date(String(row?.last_validated_at))).toEqual(OLD)
    expect(await approvalOf(id)).toEqual({ approved_by: null, approved_at: null })
  })

  it('does not apply a result when another run refreshed the destination while it was being checked', async () => {
    const id = await seedDestination({ uri: site('raced-refresh'), validatedAt: OLD })
    const refreshedAt = new Date(NOW.getTime() - 60_000)

    const outcome = await run(async (uri) => {
      if (uri !== site('raced-refresh')) return safe(uri)
      await db.execute(sql`
        UPDATE portal_approved_destinations SET last_validated_at = ${refreshedAt}
        WHERE id = ${id}::uuid
      `)
      return { outcome: 'unsafe', reason: 'redirect_host_changed', observedAt: NOW }
    })

    expect(outcome.stale).toBeGreaterThanOrEqual(1)
    const row = await stored(id)
    expect(row).toMatchObject({ approval_state: 'approved', disabled_reason: null })
    expect(new Date(String(row?.last_validated_at))).toEqual(refreshedAt)
  })

  it('does not apply a result when another run already scheduled the next attempt', async () => {
    const id = await seedDestination({ uri: site('raced-schedule'), validatedAt: OLD })
    const scheduled = new Date(NOW.getTime() - 120_000)

    const outcome = await run(async (uri) => {
      if (uri !== site('raced-schedule')) return safe(uri)
      await db.execute(sql`
        UPDATE portal_approved_destinations
        SET next_attempt_at = ${scheduled}, validation_failures = 1
        WHERE id = ${id}::uuid
      `)
      return { outcome: 'unavailable', reason: 'dns_unavailable', observedAt: NOW }
    })

    expect(outcome.stale).toBeGreaterThanOrEqual(1)
    const row = await stored(id)
    expect(row).toMatchObject({ validation_failures: 1 })
    expect(new Date(String(row?.next_attempt_at))).toEqual(scheduled)
  })

  it('refreshes a destination that is still safe', async () => {
    const id = await seedDestination({ uri: site('still-safe'), validatedAt: OLD })

    await run(safe)

    const row = await stored(id)
    expect(row).toMatchObject({ approval_state: 'approved', validation_failures: 0 })
    expect(new Date(String(row?.last_validated_at))).toEqual(NOW)
  })

  it('leaves a destination validated ten minutes ago or later alone, and picks up one from before', async () => {
    // The job runs every fifteen minutes. An approval due only at fifteen would
    // wait for the run after next and sit at the thirty-minute cutoff the
    // public edge drops it at.
    const recent = await seedDestination({
      uri: site('recent'),
      validatedAt: new Date(NOW.getTime() - 9 * 60_000),
    })
    const due = await seedDestination({
      uri: site('due'),
      validatedAt: new Date(NOW.getTime() - 11 * 60_000),
    })

    const outcome = await run(safe)

    expect(outcome.visitedIds).toContain(due)
    expect(outcome.visitedIds).not.toContain(recent)
  })

  it('schedules a transient failure without refreshing freshness, and never touches a denied scope', async () => {
    const allowed = await seedDestination({ uri: site('transient'), validatedAt: OLD })
    const denied = await seedDestination({
      uri: site('denied'),
      validatedAt: OLD,
      property: OTHER_PROPERTY,
    })

    const outcome = await run(
      () => ({ outcome: 'unavailable', reason: 'dns_unavailable', observedAt: NOW }),
      async (_organization, property) => property === PROPERTY,
    )

    expect(outcome.unauthorized).toBeGreaterThanOrEqual(1)
    expect(await stored(allowed)).toMatchObject({
      approval_state: 'approved',
      validation_failures: 1,
    })
    expect(new Date(String((await stored(allowed))?.last_validated_at))).toEqual(OLD)
    expect(new Date(String((await stored(allowed))?.next_attempt_at))).toEqual(
      new Date(NOW.getTime() + 60_000),
    )
    expect(await stored(denied)).toMatchObject({
      validation_failures: 0,
      next_attempt_at: null,
    })
  })

  it.each([
    [0, 1],
    [1, 2],
    [2, 4],
    [3, 8],
    [4, 15],
    [30, 15],
  ])('backs off failure count %i for %i minutes', async (validationFailures, minutes) => {
    const id = await seedDestination({
      uri: site(`backoff-${validationFailures}`),
      validatedAt: OLD,
      validationFailures,
    })

    await run(() => ({
      outcome: 'unavailable',
      reason: 'dns_unavailable',
      observedAt: NOW,
    }))

    expect(new Date(String((await stored(id))?.next_attempt_at))).toEqual(
      new Date(NOW.getTime() + minutes * 60_000),
    )
  })
})
