import { describe, expect, it, vi } from 'vitest'
import {
  renewLapsedMerchantAiAuthorizations,
  type StandingRenewalOutcome,
} from './renew-lapsed-merchant-ai-authorizations'

function harness(outcomes: readonly (StandingRenewalOutcome | Error)[]) {
  const candidates = outcomes.map((_, index) => ({
    organizationId: 'org',
    propertyId: `property-${index}`,
    stateVersion: 2,
  }))
  const renew = vi.fn(async (input: { propertyId: string }) => {
    const outcome = outcomes[Number(input.propertyId.split('-')[1])]!
    if (outcome instanceof Error) throw outcome
    return outcome
  })
  const deps = {
    store: { listLapsed: vi.fn(async () => candidates), renew },
    target: { noticeVersion: 'new-notice', noticeDigest: 'a'.repeat(64) },
    clock: () => new Date('2026-10-31T12:00:00Z'),
    idGen: vi.fn(() => 'run-ceremony'),
    logger: { info: vi.fn(), error: vi.fn() },
    captureUnexpected: vi.fn(),
  }
  return { deps, sweep: renewLapsedMerchantAiAuthorizations(deps) }
}

describe('standing renewal sweep', () => {
  it('uses one ceremony per run and isolates each Property, logging expected skips without Sentry', async () => {
    const { deps, sweep } = harness([
      { status: 'renewed' },
      { status: 'skipped', reason: 'no_account_admin' },
      { status: 'skipped', reason: 'org_suspended' },
      { status: 'skipped', reason: 'lock_timeout' },
    ])
    await expect(sweep()).resolves.toMatchObject({
      visited: 4,
      renewed: 1,
      skipped: 3,
      failed: 0,
    })
    expect(deps.idGen).toHaveBeenCalledOnce()
    for (const [input] of deps.store.renew.mock.calls)
      expect(input).toMatchObject({ ceremonyId: 'run-ceremony' })
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped:org_suspended' }),
      'Merchant AI standing renewal',
    )
    expect(deps.captureUnexpected).not.toHaveBeenCalled()
  })
  it('continues after an unexpected failure and reports it exactly once', async () => {
    const failure = new Error('storage unavailable')
    const { deps, sweep } = harness([failure, { status: 'renewed' }])
    await expect(sweep()).resolves.toMatchObject({ failed: 1, renewed: 1 })
    expect(deps.captureUnexpected).toHaveBeenCalledExactlyOnceWith(failure)
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed:unexpected' }),
      'Merchant AI standing renewal',
    )
  })
  it('reports a failed listing and a summary before allowing the job to retry', async () => {
    const { deps, sweep } = harness([])
    const failure = new Error('database unavailable')
    deps.store.listLapsed.mockRejectedValueOnce(failure)
    await expect(sweep()).rejects.toBe(failure)
    expect(deps.captureUnexpected).toHaveBeenCalledExactlyOnceWith(failure)
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ visited: 0, failed: 1 }),
      'Merchant AI standing renewal sweep completed',
    )
  })
  it('does only one listing when nothing is lapsed', async () => {
    const { deps, sweep } = harness([])
    await expect(sweep()).resolves.toMatchObject({ visited: 0, renewed: 0 })
    expect(deps.store.listLapsed).toHaveBeenCalledOnce()
    expect(deps.store.renew).not.toHaveBeenCalled()
  })
})
