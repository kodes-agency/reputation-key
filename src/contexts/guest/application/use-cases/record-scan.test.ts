import { recordScan } from './record-scan'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { scanEventId, organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { ScanEvent } from '../../domain/types'
import type { GuestObservationStore } from '../ports/guest-observation-store.port'

function observationHarness(options?: { fail?: boolean }) {
  const scans: ScanEvent[] = []
  const events = createCapturingEventBus()
  const store: GuestObservationStore = {
    commitScan: async (scan, fact) => {
      if (options?.fail) throw new Error('DB down')
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
    commitReviewLinkClick: async () => 'applied',
  }
  return { store, scans, events }
}

describe('recordScan', () => {
  it('commits the scan and fact through one store operation', async () => {
    const harness = observationHarness()
    const useCase = recordScan({
      observationStore: harness.store,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
      logger: createMockLogger(),
    })

    await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
    })

    expect(harness.scans).toHaveLength(1)
    expect(harness.scans[0]!.source).toBe('qr')
    expect(harness.events.capturedByTag('guest.scan.recorded')).toHaveLength(1)
  })

  it('records at most one scan per Portal-scoped guest session', async () => {
    const harness = observationHarness()
    const useCase = recordScan({
      observationStore: harness.store,
      idGen: () => scanEventId(crypto.randomUUID()),
      clock: () => new Date('2026-05-01T12:00:00Z'),
      logger: createMockLogger(),
    })
    const input = {
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr' as const,
      sessionId: 'session-abc',
      ipHash: 'hash123',
    }

    await useCase(input)
    await useCase(input)

    expect(harness.scans).toHaveLength(1)
    expect(harness.events.capturedByTag('guest.scan.recorded')).toHaveLength(1)
  })

  it('keeps the public render path available when observation persistence fails', async () => {
    const harness = observationHarness({ fail: true })
    const useCase = recordScan({
      observationStore: harness.store,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
      logger: createMockLogger(),
    })

    await expect(
      useCase({
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        source: 'qr',
        sessionId: 'session-abc',
        ipHash: 'hash123',
      }),
    ).resolves.toBeUndefined()

    expect(harness.scans).toHaveLength(0)
    expect(harness.events.capturedEvents).toHaveLength(0)
  })
})
