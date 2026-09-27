// Integration context — reconcile Google provider recovery tests.

import { describe, expect, it, vi } from 'vitest'
import { reconcileGoogleProviderRecovery } from './reconcile-google-provider-recovery'

const NOW = new Date('2026-08-28T08:00:00.000Z')

describe('reconcileGoogleProviderRecovery', () => {
  it('runs both bounded recovery stores with the same now and limit', async () => {
    const exchangeRecovery = { expire: vi.fn().mockResolvedValue({ expired: 2 }) }
    const disconnectRevoke = {
      reconcileElapsed: vi
        .fn()
        .mockResolvedValue({ visited: 5, confirmedNotSent: 3, cleanupAmbiguous: 1 }),
    }
    const reconcile = reconcileGoogleProviderRecovery({
      exchangeRecovery,
      disconnectRevoke,
    })

    const counts = await reconcile({ now: NOW, limit: 100 })

    expect(exchangeRecovery.expire).toHaveBeenCalledWith({ now: NOW, limit: 100 })
    expect(disconnectRevoke.reconcileElapsed).toHaveBeenCalledWith({
      now: NOW,
      limit: 100,
    })
    // Counts only: the result is what the sweep logs, so nothing else may ride along.
    expect(counts).toStrictEqual({
      oauthExchangeAttemptsExpired: 2,
      disconnectAttemptsVisited: 5,
      disconnectConfirmedNotSent: 3,
      disconnectCleanupAmbiguous: 1,
    })
  })
})
