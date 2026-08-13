import { describe, expect, it, vi } from 'vitest'
import type { CredentialLifecycleStore } from './credential-lifecycle'
import { createCredentialCleanupDispatcher } from './credential-cleanup'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

const NOW = new Date('2026-08-10T12:00:00.000Z')
const ORG_ID = 'org-1'
const REVOKE_ID = '00000000-0000-4000-8000-000000000001'
const TOKEN = 'provider-refresh-token-marker'

function lifecycle(
  overrides: Partial<CredentialLifecycleStore> = {},
): CredentialLifecycleStore {
  return {
    registerSource: vi.fn(),
    markProviderStarted: vi.fn(),
    completeWithoutCleanup: vi.fn(),
    activateCleanup: vi.fn(),
    finishCleanupWithoutDispatch: vi.fn(async () => ({
      ok: true as const,
      value: { sourceOperationId: 'source-1' },
    })),
    acquireCleanupDispatch: vi.fn(async () => ({
      ok: true as const,
      value: { sourceOperationId: 'source-1' },
    })),
    finishCleanup: vi.fn(async () => ({
      ok: true as const,
      value: { sourceOperationId: 'source-1' },
    })),
    markProviderOutcomeAmbiguous: vi.fn(),
    expireDeadlines: vi.fn(),
    ...overrides,
  }
}

const tokenKeys = () => createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)

describe('credential cleanup dispatcher', () => {
  it('records confirmed-not-sent without consuming or sending on admission denial', async () => {
    const store = lifecycle()
    const revokeToken = vi.fn(async () => undefined)
    const dispatch = createCredentialCleanupDispatcher({
      lifecycle: store,
      tokenKeys: tokenKeys(),
      admit: vi.fn(async () => ({ ok: false as const, code: 'quota_exhausted' })),
      oauth: { revokeToken },
      clock: () => NOW,
    })
    await expect(
      dispatch({ organizationId: ORG_ID, revokePermitId: REVOKE_ID, token: TOKEN }),
    ).resolves.toEqual({ ok: true, outcome: 'confirmed_not_sent' })
    expect(store.finishCleanupWithoutDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        revokePermitId: REVOKE_ID,
        outcomeCode: 'quota_exhausted',
      }),
    )
    expect(store.acquireCleanupDispatch).not.toHaveBeenCalled()
    expect(revokeToken).not.toHaveBeenCalled()
  })

  it('consumes exact-token authorization before the provider send', async () => {
    const order: string[] = []
    const store = lifecycle({
      acquireCleanupDispatch: vi.fn(async () => {
        order.push('consume')
        return { ok: true as const, value: { sourceOperationId: 'source-1' } }
      }),
      finishCleanup: vi.fn(async () => {
        order.push('finish')
        return { ok: true as const, value: { sourceOperationId: 'source-1' } }
      }),
    })
    const revokeToken = vi.fn(async (token: string) => {
      expect(token).toBe(TOKEN)
      order.push('provider')
    })
    const dispatch = createCredentialCleanupDispatcher({
      lifecycle: store,
      tokenKeys: tokenKeys(),
      admit: vi.fn(async () => ({ ok: true as const })),
      oauth: { revokeToken },
      clock: () => NOW,
    })
    const result = await dispatch({
      organizationId: ORG_ID,
      revokePermitId: REVOKE_ID,
      token: TOKEN,
    })
    expect(result).toEqual({ ok: true, outcome: 'confirmed_revoked' })
    expect(order).toEqual(['consume', 'provider', 'finish'])
    expect(store.acquireCleanupDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHmacKeyVersion: 'v1',
        tokenHmac: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    )
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('records every post-consumption provider failure as ambiguous', async () => {
    const store = lifecycle()
    const dispatch = createCredentialCleanupDispatcher({
      lifecycle: store,
      tokenKeys: tokenKeys(),
      admit: vi.fn(async () => ({ ok: true as const })),
      oauth: {
        revokeToken: vi.fn(async () => {
          throw new Error('connection reset after write')
        }),
      },
      clock: () => NOW,
    })
    await expect(
      dispatch({ organizationId: ORG_ID, revokePermitId: REVOKE_ID, token: TOKEN }),
    ).resolves.toEqual({ ok: true, outcome: 'cleanup_ambiguous' })
    expect(store.finishCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'cleanup_ambiguous',
        outcomeCode: 'google_revoke_outcome_ambiguous',
      }),
    )
  })

  it('makes no provider call when the exact-token consume is rejected', async () => {
    const store = lifecycle({
      acquireCleanupDispatch: vi.fn(async () => ({
        ok: false as const,
        code: 'token_mismatch' as const,
      })),
    })
    const revokeToken = vi.fn(async () => undefined)
    const dispatch = createCredentialCleanupDispatcher({
      lifecycle: store,
      tokenKeys: tokenKeys(),
      admit: vi.fn(async () => ({ ok: true as const })),
      oauth: { revokeToken },
      clock: () => NOW,
    })
    await expect(
      dispatch({ organizationId: ORG_ID, revokePermitId: REVOKE_ID, token: TOKEN }),
    ).resolves.toEqual({ ok: false, code: 'lifecycle_denied' })
    expect(revokeToken).not.toHaveBeenCalled()
  })
})
