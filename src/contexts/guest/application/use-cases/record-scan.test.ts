import { recordScan } from './record-scan'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { scanEventId, organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { ScanEvent } from '../../domain/types'
import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'

function createInMemoryGuestRepo() {
  const scans: ScanEvent[] = []
  const repo: GuestInteractionRepository = {
    recordScan: async (scan: ScanEvent) => {
      scans.push(scan)
    },
    insertRating: async () => {},
    insertFeedback: async () => {},
    hasRated: async () => false,
  }
  return { ...repo, scans }
}

describe('recordScan', () => {
  it('records scan and emits event', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = recordScan({
      guestRepo: repo,
      events: bus,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
    })

    expect(repo.scans.length).toBe(1)
    expect(repo.scans[0].source).toBe('qr')
    expect(bus.capturedEvents).toHaveLength(1)
    expect(bus.capturedEvents[0]._tag).toBe('scan.recorded')
  })

  it('silently fails on repo error', async () => {
    const bus = createCapturingEventBus()
    const failingRepo = {
      recordScan: async () => {
        throw new Error('DB down')
      },
      insertRating: async () => {},
      insertFeedback: async () => {},
      hasRated: async () => false,
    }
    const useCase = recordScan({
      guestRepo: failingRepo,
      events: bus,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
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

    expect(bus.capturedEvents).toHaveLength(0)
  })
})
