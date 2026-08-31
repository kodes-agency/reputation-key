import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, portalId, propertyId, scanEventId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createGuestInteractionRepository } from './repositories/guest-interaction.repository'

describe('Guest interaction repository runtime', () => {
  it('uses the injected logger and monotonic timer for scan diagnostics', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    const db = {
      insert: vi.fn(() => ({ values })),
    } as unknown as Database
    const debug = vi.fn()
    const childLogger = { ...createMockLogger(), debug }
    const child = vi.fn(() => childLogger)
    const readings = [100, 107]
    const repository = createGuestInteractionRepository(db, {
      logger: { child },
      monotonicNow: () => readings.shift() ?? 107,
    })

    await repository.recordScan({
      id: scanEventId('93000000-0000-4000-8000-000000000001'),
      organizationId: organizationId('guest-runtime-org'),
      propertyId: propertyId('93000000-0000-4000-8000-000000000002'),
      portalId: portalId('93000000-0000-4000-8000-000000000003'),
      source: 'qr',
      sessionId: '93000000-0000-4000-8000-000000000004',
      ipHash: null,
      createdAt: new Date('2026-08-28T12:00:00.000Z'),
    })

    expect(child).toHaveBeenCalledWith({ component: 'guest-interaction-repo' })
    expect(debug).toHaveBeenNthCalledWith(1, 'guest recordScan start')
    expect(debug).toHaveBeenNthCalledWith(2, { duration: 7 }, 'guest recordScan complete')
    expect(values).toHaveBeenCalledOnce()
  })
})
