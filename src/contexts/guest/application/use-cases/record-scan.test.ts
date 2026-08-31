import { recordScan } from './record-scan'
import { vi } from 'vitest'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  portalAccessArtifactId,
  portalGroupId,
  qualifiedScanId,
  scanEventId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import type { QualifiedScan, ScanEvent } from '../../domain/types'
import type { GuestObservationStore } from '../ports/guest-observation-store.port'

const STAFF_ATTRIBUTION = {
  staffParticipantId: '70000000-0000-4000-8000-000000000001',
  staffParticipationId: '70000000-0000-4000-8000-000000000002',
  portalResponsibilityId: '70000000-0000-4000-8000-000000000003',
  effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
  effectiveTo: null,
} as const

function observationHarness(options?: { fail?: boolean; failDiagnostic?: boolean }) {
  const scans: ScanEvent[] = []
  const qualifiedScans: QualifiedScan[] = []
  const events = createCapturingEventBus()
  const store: GuestObservationStore = {
    commitScan: async (scan, fact) => {
      if (options?.fail || options?.failDiagnostic) throw new Error('DB down')
      if (
        scans.some(
          (candidate) =>
            candidate.organizationId === scan.organizationId &&
            candidate.portalId === scan.portalId &&
            candidate.sessionId === scan.sessionId,
        )
      ) {
        return 'duplicate'
      }
      scans.push(scan)
      await events.emit(fact)
      return 'applied'
    },
    commitQualifiedScan: async (scan, _sessionId, fact) => {
      if (options?.fail) throw new Error('DB down')
      if (qualifiedScans.some((candidate) => candidate.portalId === scan.portalId)) {
        return 'duplicate'
      }
      qualifiedScans.push(scan)
      await events.emit(fact)
      return 'applied'
    },
    retractQualifiedScan: async () => 'applied',
    commitReviewLinkClick: async () => 'applied',
  }
  return { store, scans, qualifiedScans, events }
}

const ORG = organizationId('org-1')
const PORTAL = portalId('10000000-0000-4000-8000-000000000001')
const PROPERTY = propertyId('20000000-0000-4000-8000-000000000001')
const ARTIFACT = portalAccessArtifactId('30000000-0000-4000-8000-000000000001')
const GROUP = portalGroupId('40000000-0000-4000-8000-000000000001')
const BROWSER = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36'

function input(accessArtifactId: typeof ARTIFACT | null = ARTIFACT) {
  return {
    organizationId: ORG,
    portalId: PORTAL,
    propertyId: PROPERTY,
    accessArtifactId,
    publicationSnapshotId: '50000000-0000-4000-8000-000000000001',
    rawToken: 'pt_address-capability',
    sessionId: '60000000-0000-4000-8000-000000000001',
    userAgent: BROWSER,
    purpose: null,
    secPurpose: null,
  }
}

function deps(harness: ReturnType<typeof observationHarness>) {
  const reportObservationLoss = vi.fn(async () => 'recorded' as const)
  return {
    observationStore: harness.store,
    accessArtifacts: {
      resolvePublishedAccessArtifact: async () => ({
        accessArtifactId: ARTIFACT,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        portalGroupId: GROUP,
        channel: 'qr' as const,
      }),
    },
    idGen: () => scanEventId(crypto.randomUUID()),
    qualifiedScanIdGen: () => qualifiedScanId(crypto.randomUUID()),
    clock: () => new Date('2026-05-01T12:00:00Z'),
    resolvePrimaryStaffAttribution: async () => STAFF_ATTRIBUTION,
    reportObservationLoss,
  }
}

describe('recordScan', () => {
  it('commits the scan and fact through one store operation', async () => {
    const harness = observationHarness()
    const useCase = recordScan(deps(harness))

    await expect(useCase(input())).resolves.toBe('qualified')

    expect(harness.scans).toHaveLength(1)
    expect(harness.scans[0]!.source).toBe('qr')
    expect(harness.scans[0]!.ipHash).toBeNull()
    expect(harness.events.capturedByTag('guest.scan.recorded')).toHaveLength(1)
    expect(harness.qualifiedScans[0]).toMatchObject({
      portalGroupId: GROUP,
      accessArtifactId: ARTIFACT,
      staffAttribution: STAFF_ATTRIBUTION,
    })
    expect(harness.events.capturedByTag('guest.qualified_scan.recorded')).toMatchObject([
      { staffAttribution: STAFF_ATTRIBUTION },
    ])
  })

  it('records at most one scan per Portal-scoped guest session', async () => {
    const harness = observationHarness()
    const useCase = recordScan(deps(harness))

    await expect(useCase(input())).resolves.toBe('qualified')
    await expect(useCase(input())).resolves.toBe('duplicate')

    expect(harness.scans).toHaveLength(1)
    expect(harness.events.capturedByTag('guest.scan.recorded')).toHaveLength(1)
  })

  it('keeps the public render path available when observation persistence fails', async () => {
    const harness = observationHarness({ fail: true })
    const dependencies = deps(harness)
    const useCase = recordScan(dependencies)

    await expect(useCase(input())).resolves.toBe('failed')

    expect(harness.scans).toHaveLength(0)
    expect(harness.events.capturedEvents).toHaveLength(0)
    expect(dependencies.reportObservationLoss).toHaveBeenCalledOnce()
    expect(dependencies.reportObservationLoss).toHaveBeenCalledWith('scan')
  })

  it('keeps an accepted Qualified Scan when legacy diagnostics persistence fails', async () => {
    const harness = observationHarness({ failDiagnostic: true })
    const dependencies = deps(harness)
    const useCase = recordScan(dependencies)

    await expect(useCase(input())).resolves.toBe('qualified')

    expect(harness.scans).toHaveLength(0)
    expect(harness.qualifiedScans).toHaveLength(1)
    expect(harness.events.capturedByTag('guest.qualified_scan.recorded')).toHaveLength(1)
    expect(dependencies.reportObservationLoss).toHaveBeenCalledOnce()
  })

  it('keeps a direct URL diagnostic-only without consulting artifact authority', async () => {
    const harness = observationHarness()
    const resolvePublishedAccessArtifact = vi.fn()
    const useCase = recordScan({
      ...deps(harness),
      accessArtifacts: { resolvePublishedAccessArtifact },
    })

    await expect(useCase(input(null))).resolves.toBe('diagnostic')

    expect(resolvePublishedAccessArtifact).not.toHaveBeenCalled()
    expect(harness.scans[0]?.source).toBe('direct')
    expect(harness.qualifiedScans).toHaveLength(0)
  })

  it('keeps an unknown or unpublished artifact diagnostic-only', async () => {
    const harness = observationHarness()
    const resolvePublishedAccessArtifact = vi.fn(async () => null)
    const useCase = recordScan({
      ...deps(harness),
      accessArtifacts: { resolvePublishedAccessArtifact },
    })

    await expect(useCase(input())).resolves.toBe('diagnostic')

    expect(resolvePublishedAccessArtifact).toHaveBeenCalledOnce()
    expect(harness.scans[0]?.source).toBe('direct')
    expect(harness.qualifiedScans).toHaveLength(0)
  })

  it('returns a retryable outcome when artifact authority is temporarily unavailable', async () => {
    const harness = observationHarness()
    const resolvePublishedAccessArtifact = vi.fn(async () => {
      throw new Error('artifact store unavailable')
    })
    const dependencies = deps(harness)
    const useCase = recordScan({
      ...dependencies,
      accessArtifacts: { resolvePublishedAccessArtifact },
    })

    await expect(useCase(input())).resolves.toBe('retryable')

    expect(resolvePublishedAccessArtifact).toHaveBeenCalledOnce()
    expect(harness.scans).toHaveLength(1)
    expect(harness.qualifiedScans).toHaveLength(0)
    expect(dependencies.reportObservationLoss).toHaveBeenCalledOnce()
  })

  it.each([
    { name: 'bot', patch: { userAgent: 'Googlebot/2.1' } },
    { name: 'prefetch', patch: { purpose: 'prefetch' } },
    { name: 'prerender', patch: { secPurpose: 'prefetch;prerender' } },
  ])('keeps a $name observation diagnostic-only', async ({ patch }) => {
    const harness = observationHarness()
    const resolvePublishedAccessArtifact = vi.fn()
    const useCase = recordScan({
      ...deps(harness),
      accessArtifacts: { resolvePublishedAccessArtifact },
    })

    await expect(useCase({ ...input(), ...patch })).resolves.toBe('diagnostic')

    expect(resolvePublishedAccessArtifact).not.toHaveBeenCalled()
    expect(harness.qualifiedScans).toHaveLength(0)
  })
})
