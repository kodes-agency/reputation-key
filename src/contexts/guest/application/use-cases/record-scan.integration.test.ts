import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { recordScan } from './record-scan'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  portalAccessArtifactId,
  portalGroupId,
  qualifiedScanId,
  scanEventId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import type { GuestObservationStore } from '../ports/guest-observation-store.port'
import { createAtomicGuestObservationStore } from '../../infrastructure/guest-observation-store'

const db = getDb()
const NOW = new Date('2026-05-01T12:00:00Z')
const STAFF_EFFECTIVE_FROM = new Date('2026-04-01T00:00:00.000Z')
const BROWSER = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36'
const createdOrganizations: string[] = []

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  if (createdOrganizations.length > 0) {
    const list = sql.join(
      createdOrganizations.map((id) => sql`${id}`),
      sql`, `,
    )
    await db.execute(
      sql`DELETE FROM guest_qualified_scans WHERE organization_id IN (${list})`,
    )
    await db.execute(sql`DELETE FROM scan_events WHERE organization_id IN (${list})`)
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id IN (${list})`)
    await db.execute(
      sql`DELETE FROM idempotency_receipts WHERE scope = 'guest_qualified_scan' AND ${sql.join(
        createdOrganizations.map((id) => sql`key LIKE ${`%${id}%`}`),
        sql` OR `,
      )}`,
    )
    await db.execute(
      sql`DELETE FROM portal_responsibilities WHERE organization_id IN (${list})`,
    )
    await db.execute(
      sql`DELETE FROM staff_participations WHERE organization_id IN (${list})`,
    )
    await db.execute(
      sql`DELETE FROM staff_participants WHERE organization_id IN (${list})`,
    )
    await db.execute(
      sql`DELETE FROM portal_access_artifacts WHERE organization_id IN (${list})`,
    )
    await db.execute(sql`DELETE FROM portal_tokens WHERE organization_id IN (${list})`)
    await db.execute(sql`DELETE FROM portal_groups WHERE organization_id IN (${list})`)
    await db.execute(sql`DELETE FROM portals WHERE organization_id IN (${list})`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id IN (${list})`)
    await deleteTestOrganizations(db, createdOrganizations)
  }
  clearEventSchemas()
})

/** A tenant of its own: a published Portal in a group, reached through a QR artifact. */
async function seedTenant() {
  const org = `org-record-scan-${randomUUID()}`
  const property = randomUUID()
  const portal = randomUUID()
  const token = randomUUID()
  const artifact = randomUUID()
  const sessionId = randomUUID()
  const group = randomUUID()
  const participant = randomUUID()
  const participation = randomUUID()
  const responsibility = randomUUID()
  createdOrganizations.push(org)
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt") VALUES (${org}, 'Record Scan', ${org}, now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${property}, ${org}, 'Record Scan Property', ${property}, 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state
    ) VALUES (${portal}, ${org}, ${property}, 'property', ${property}, 'Reception', ${portal}, 'published')
  `)
  await db.execute(sql`
    INSERT INTO portal_tokens (
      id, organization_id, property_id, portal_id, token_identifier, token_hash,
      token_key_version, version, status, issued_at
    ) VALUES (${token}::uuid, ${org}, ${property}, ${portal}, ${token.replaceAll('-', '').slice(0, 24)}, ${token.replaceAll('-', '').repeat(2)}, 1, 1, 'active', ${NOW})
  `)
  await db.execute(sql`
    INSERT INTO portal_access_artifacts (
      id, organization_id, property_id, portal_id, portal_token_id, channel, status, published_at
    ) VALUES (${artifact}::uuid, ${org}, ${property}, ${portal}, ${token}::uuid, 'qr', 'published', ${NOW})
  `)
  await db.execute(sql`
    INSERT INTO portal_groups (id, organization_id, property_id, name)
    VALUES (${group}::uuid, ${org}, ${property}, 'Reception')
  `)
  await db.execute(sql`
    INSERT INTO staff_participants (
      id, organization_id, display_name, status, revision, created_by, created_at, updated_at
    ) VALUES (${participant}::uuid, ${org}, 'Primary', 'active', 1, 'test', ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO staff_participations (
      id, organization_id, property_id, staff_participant_id, display_name,
      status, started_at, revision, created_by, created_at, updated_at
    ) VALUES (${participation}::uuid, ${org}, ${property}, ${participant}::uuid, 'Primary', 'active',
      ${STAFF_EFFECTIVE_FROM}, 1, 'test', ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO portal_responsibilities (
      id, organization_id, property_id, portal_id, staff_participation_id, kind, effective_from, created_by
    ) VALUES (${responsibility}::uuid, ${org}, ${property}, ${portal}, ${participation}::uuid,
      'primary', ${STAFF_EFFECTIVE_FROM}, 'test')
  `)
  return {
    org,
    property,
    portal,
    artifact,
    sessionId,
    group,
    staffAttribution: {
      staffParticipantId: participant,
      staffParticipationId: participation,
      portalResponsibilityId: responsibility,
      effectiveFrom: STAFF_EFFECTIVE_FROM,
      effectiveTo: null,
    },
  }
}

async function observationHarness(options?: {
  fail?: boolean
  failDiagnostic?: boolean
}) {
  const tenant = await seedTenant()
  const real = createAtomicGuestObservationStore(db)
  // A database outage is the one failure the real store cannot be made to show.
  const store: GuestObservationStore = {
    ...real,
    commitScan: async (scan, fact) => {
      if (options?.fail || options?.failDiagnostic) throw new Error('DB down')
      return real.commitScan(scan, fact)
    },
    commitQualifiedScan: async (scan, sessionId, fact) => {
      if (options?.fail) throw new Error('DB down')
      return real.commitQualifiedScan(scan, sessionId, fact)
    },
  }
  const scans = async () =>
    (
      await db.execute(
        sql`SELECT source, ip_hash FROM scan_events WHERE organization_id = ${tenant.org}`,
      )
    ).rows
  const qualifiedScans = async () =>
    (
      await db.execute(sql`
        SELECT portal_group_id, access_artifact_id, attributed_staff_participant_id,
               attributed_staff_participation_id, attribution_responsibility_id,
               staff_attribution_effective_from, staff_attribution_effective_to
        FROM guest_qualified_scans WHERE organization_id = ${tenant.org}
      `)
    ).rows
  const facts = async (tag: string) =>
    (
      await db.execute(sql`
        SELECT payload FROM outbox_events
        WHERE organization_id = ${tenant.org} AND event_type = ${tag}
      `)
    ).rows.map((row) => row.payload as Record<string, unknown>)
  const outboxCount = async () =>
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM outbox_events WHERE organization_id = ${tenant.org}`,
      )
    ).rows[0]!.n
  return { tenant, store, scans, qualifiedScans, facts, outboxCount }
}

type Harness = Awaited<ReturnType<typeof observationHarness>>

function input(harness: Harness, withArtifact = true) {
  const { tenant } = harness
  return {
    organizationId: organizationId(tenant.org),
    portalId: portalId(tenant.portal),
    propertyId: propertyId(tenant.property),
    accessArtifactId: withArtifact ? portalAccessArtifactId(tenant.artifact) : null,
    publicationSnapshotId: randomUUID(),
    rawToken: 'pt_address-capability',
    sessionId: tenant.sessionId,
    userAgent: BROWSER,
    purpose: null,
    secPurpose: null,
  }
}

function deps(harness: Harness) {
  const { tenant } = harness
  const reportObservationLoss = vi.fn(async () => 'recorded' as const)
  return {
    observationStore: harness.store,
    accessArtifacts: {
      isPrintCode: () => false,
      resolvePublishedAccessArtifact: async () => ({
        accessArtifactId: portalAccessArtifactId(tenant.artifact),
        organizationId: organizationId(tenant.org),
        propertyId: propertyId(tenant.property),
        portalId: portalId(tenant.portal),
        portalGroupId: portalGroupId(tenant.group),
        channel: 'qr' as const,
      }),
    },
    idGen: () => scanEventId(randomUUID()),
    qualifiedScanIdGen: () => qualifiedScanId(randomUUID()),
    clock: () => NOW,
    resolvePrimaryStaffAttribution: async () => tenant.staffAttribution,
    reportObservationLoss,
  }
}

describe('recordScan', () => {
  it('commits the scan and fact through one store operation', async () => {
    const harness = await observationHarness()
    const useCase = recordScan(deps(harness))

    await expect(useCase(input(harness))).resolves.toBe('qualified')

    expect(await harness.scans()).toHaveLength(1)
    expect((await harness.scans())[0]!.source).toBe('qr')
    expect((await harness.scans())[0]!.ip_hash).toBeNull()
    expect(await harness.facts('guest.scan.recorded')).toHaveLength(1)
    const { tenant } = harness
    expect((await harness.qualifiedScans())[0]).toMatchObject({
      portal_group_id: tenant.group,
      access_artifact_id: tenant.artifact,
      attributed_staff_participant_id: tenant.staffAttribution.staffParticipantId,
      attributed_staff_participation_id: tenant.staffAttribution.staffParticipationId,
      attribution_responsibility_id: tenant.staffAttribution.portalResponsibilityId,
      staff_attribution_effective_from: '2026-04-01 00:00:00+00',
      staff_attribution_effective_to: null,
    })
    expect(await harness.facts('guest.qualified_scan.recorded')).toMatchObject([
      { staffAttribution: JSON.parse(JSON.stringify(tenant.staffAttribution)) },
    ])
  })

  it('records at most one scan per Portal-scoped guest session', async () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#1
    const harness = await observationHarness()
    const useCase = recordScan(deps(harness))

    await expect(useCase(input(harness))).resolves.toBe('qualified')
    await expect(useCase(input(harness))).resolves.toBe('duplicate')

    expect(await harness.scans()).toHaveLength(1)
    expect(await harness.facts('guest.scan.recorded')).toHaveLength(1)
  })

  it('keeps the public render path available when observation persistence fails', async () => {
    const harness = await observationHarness({ fail: true })
    const dependencies = deps(harness)
    const useCase = recordScan(dependencies)

    await expect(useCase(input(harness))).resolves.toBe('failed')

    expect(await harness.scans()).toHaveLength(0)
    expect(await harness.outboxCount()).toBe(0)
    expect(dependencies.reportObservationLoss).toHaveBeenCalledOnce()
    expect(dependencies.reportObservationLoss).toHaveBeenCalledWith('scan')
  })

  it('keeps an accepted Qualified Scan when legacy diagnostics persistence fails', async () => {
    const harness = await observationHarness({ failDiagnostic: true })
    const dependencies = deps(harness)
    const useCase = recordScan(dependencies)

    await expect(useCase(input(harness))).resolves.toBe('qualified')

    expect(await harness.scans()).toHaveLength(0)
    expect(await harness.qualifiedScans()).toHaveLength(1)
    expect(await harness.facts('guest.qualified_scan.recorded')).toHaveLength(1)
    expect(dependencies.reportObservationLoss).toHaveBeenCalledOnce()
  })

  it('keeps a direct URL diagnostic-only without consulting artifact authority', async () => {
    const harness = await observationHarness()
    const resolvePublishedAccessArtifact = vi.fn()
    const useCase = recordScan({
      ...deps(harness),
      accessArtifacts: { isPrintCode: () => false, resolvePublishedAccessArtifact },
    })

    await expect(useCase(input(harness, false))).resolves.toBe('diagnostic')

    expect(resolvePublishedAccessArtifact).not.toHaveBeenCalled()
    expect((await harness.scans())[0]?.source).toBe('direct')
    expect(await harness.qualifiedScans()).toHaveLength(0)
  })

  it('keeps an unknown or unpublished artifact diagnostic-only', async () => {
    const harness = await observationHarness()
    const resolvePublishedAccessArtifact = vi.fn(async () => null)
    const useCase = recordScan({
      ...deps(harness),
      accessArtifacts: { isPrintCode: () => false, resolvePublishedAccessArtifact },
    })

    await expect(useCase(input(harness))).resolves.toBe('diagnostic')

    expect(resolvePublishedAccessArtifact).toHaveBeenCalledOnce()
    expect((await harness.scans())[0]?.source).toBe('direct')
    expect(await harness.qualifiedScans()).toHaveLength(0)
  })

  it('returns a retryable outcome when artifact authority is temporarily unavailable', async () => {
    const harness = await observationHarness()
    const resolvePublishedAccessArtifact = vi.fn(async () => {
      throw new Error('artifact store unavailable')
    })
    const dependencies = deps(harness)
    const useCase = recordScan({
      ...dependencies,
      accessArtifacts: { isPrintCode: () => false, resolvePublishedAccessArtifact },
    })

    await expect(useCase(input(harness))).resolves.toBe('retryable')

    expect(resolvePublishedAccessArtifact).toHaveBeenCalledOnce()
    expect(await harness.scans()).toHaveLength(1)
    expect(await harness.qualifiedScans()).toHaveLength(0)
    expect(dependencies.reportObservationLoss).toHaveBeenCalledOnce()
  })

  it.each([
    { name: 'bot', patch: { userAgent: 'Googlebot/2.1' } },
    { name: 'prefetch', patch: { purpose: 'prefetch' } },
    { name: 'prerender', patch: { secPurpose: 'prefetch;prerender' } },
  ])('keeps a $name observation diagnostic-only', async ({ patch }) => {
    const harness = await observationHarness()
    const resolvePublishedAccessArtifact = vi.fn()
    const useCase = recordScan({
      ...deps(harness),
      accessArtifacts: { isPrintCode: () => false, resolvePublishedAccessArtifact },
    })

    await expect(useCase({ ...input(harness), ...patch })).resolves.toBe('diagnostic')

    expect(resolvePublishedAccessArtifact).not.toHaveBeenCalled()
    expect(await harness.qualifiedScans()).toHaveLength(0)
  })
})

// A print code is its own marker (ADR 0069): the address says so, the beacon sends
// no marker, and the portal API reads the channel from the code.
describe('recordScan of a print code', () => {
  const PRINT_CODE = '7K3QZ0VD9MWX4HT2BN6R'
  const nfcArtifact = (harness: Harness) => ({
    accessArtifactId: portalAccessArtifactId(harness.tenant.artifact),
    organizationId: organizationId(harness.tenant.org),
    propertyId: propertyId(harness.tenant.property),
    portalId: portalId(harness.tenant.portal),
    portalGroupId: portalGroupId(harness.tenant.group),
    channel: 'nfc' as const,
  })

  function printCodeUseCase(
    harness: Harness,
    resolved: ReturnType<typeof nfcArtifact> | null = nfcArtifact(harness),
  ) {
    const isPrintCode = vi.fn((raw: string) => raw === PRINT_CODE)
    const resolvePublishedAccessArtifact = vi.fn(async () => resolved)
    const useCase = recordScan({
      ...deps(harness),
      accessArtifacts: { isPrintCode, resolvePublishedAccessArtifact },
    })
    return { useCase, isPrintCode, resolvePublishedAccessArtifact }
  }

  it('counts a visit that claims no marker, as the channel the lookup read from the code', async () => {
    const harness = await observationHarness()
    const { useCase, resolvePublishedAccessArtifact } = printCodeUseCase(harness)

    await expect(
      useCase({ ...input(harness, false), rawToken: PRINT_CODE }),
    ).resolves.toBe('qualified')

    expect(resolvePublishedAccessArtifact).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ accessArtifactId: null, rawToken: PRINT_CODE }),
    )
    expect((await harness.scans())[0]?.source).toBe('nfc')
    expect((await harness.qualifiedScans())[0]).toMatchObject({
      access_artifact_id: harness.tenant.artifact,
    })
  })

  it('hands a claimed marker to the lookup, which decides whether it is the code’s own', async () => {
    const harness = await observationHarness()
    const { useCase, resolvePublishedAccessArtifact } = printCodeUseCase(harness)

    await useCase({ ...input(harness), rawToken: PRINT_CODE })

    expect(resolvePublishedAccessArtifact).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        accessArtifactId: harness.tenant.artifact,
        rawToken: PRINT_CODE,
      }),
    )
  })

  it('stays diagnostic-only, as a direct visit, when the lookup does not accept the code', async () => {
    const harness = await observationHarness()
    const { useCase } = printCodeUseCase(harness, null)

    await expect(
      useCase({ ...input(harness, false), rawToken: PRINT_CODE }),
    ).resolves.toBe('diagnostic')

    expect((await harness.scans())[0]?.source).toBe('direct')
    expect(await harness.qualifiedScans()).toHaveLength(0)
  })

  it('asks the lookup nothing of a print code seen by a bot', async () => {
    const harness = await observationHarness()
    const { useCase, resolvePublishedAccessArtifact } = printCodeUseCase(harness)

    await expect(
      useCase({
        ...input(harness, false),
        rawToken: PRINT_CODE,
        userAgent: 'Googlebot/2.1',
      }),
    ).resolves.toBe('diagnostic')

    expect(resolvePublishedAccessArtifact).not.toHaveBeenCalled()
  })

  it('keeps a long address with no marker out of the lookup, as before', async () => {
    const harness = await observationHarness()
    const { useCase, isPrintCode, resolvePublishedAccessArtifact } =
      printCodeUseCase(harness)

    await expect(useCase(input(harness, false))).resolves.toBe('diagnostic')

    expect(isPrintCode).toHaveBeenCalledWith('pt_address-capability')
    expect(resolvePublishedAccessArtifact).not.toHaveBeenCalled()
    expect((await harness.scans())[0]?.source).toBe('direct')
  })

  it('counts a long address that carries its marker exactly as it did', async () => {
    const harness = await observationHarness()
    const { useCase, resolvePublishedAccessArtifact } = printCodeUseCase(harness)

    await expect(useCase(input(harness))).resolves.toBe('qualified')

    expect(resolvePublishedAccessArtifact).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        accessArtifactId: harness.tenant.artifact,
        rawToken: 'pt_address-capability',
      }),
    )
  })
})
