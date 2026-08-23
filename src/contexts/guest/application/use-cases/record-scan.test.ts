import { recordScan } from './record-scan'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
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
    hasRatedByIpWithin: async () => false,
    getLatestScanBySession: async (orgId, sessionId) =>
      [...scans]
        .reverse()
        .find((scan) => scan.organizationId === orgId && scan.sessionId === sessionId) ??
      null,
    findFeedbackById: async () => null,
    findRatingById: async () => null,
    findFeedbackSnippetsByIds: async () => [],
    findEligibleFeedbackIds: async () => [],
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

    expect(repo.scans.length).toBe(1)
    expect(repo.scans[0].source).toBe('qr')
    expect(bus.capturedEvents).toHaveLength(1)
    expect(bus.capturedEvents[0]._tag).toBe('guest.scan.recorded')
  })

  it('records at most one scan per guest session so a refresh cannot inflate portal.scan', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = recordScan({
      guestRepo: repo,
      events: bus,
      idGen: () => scanEventId('scan-1'),
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

    expect(repo.scans).toHaveLength(1)
    expect(bus.capturedEvents).toHaveLength(1)
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
      hasRatedByIpWithin: async () => false,
      getLatestScanBySession: async () => null,
      findFeedbackById: async () => null,
      findRatingById: async () => null,
      findFeedbackSnippetsByIds: async () => [],
      findEligibleFeedbackIds: async () => [],
    }
    const useCase = recordScan({
      guestRepo: failingRepo,
      events: bus,
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

    expect(bus.capturedEvents).toHaveLength(0)
  })
})
