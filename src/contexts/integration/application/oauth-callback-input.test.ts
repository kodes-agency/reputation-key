import { describe, expect, it } from 'vitest'
import { buildOpaqueOAuthConnectInput } from './oauth-callback-input'

const verifierMaterial = {
  contractVersion: 'v2' as const,
  codeVerifier: 'v'.repeat(43),
  oidcNonce: 'n'.repeat(43),
}

describe('opaque OAuth callback input', () => {
  it('carries only the redeemed server-authoritative ceremony facts', () => {
    expect(
      buildOpaqueOAuthConnectInput('provider-code', {
        ok: true,
        kind: 'exchange',
        exchangeAttemptId: '60000000-0000-4000-8000-000000000001',
        visibility: 'organization',
        purpose: 'performance_reauth',
        connectionMode: 'reauth',
        targetConnectionId: 'connection-7',
        returnRoute: '/properties/import-google',
        verifierMaterial,
      }),
    ).toEqual({
      exchangeAttemptId: '60000000-0000-4000-8000-000000000001',
      code: 'provider-code',
      visibility: 'organization',
      purpose: 'performance_reauth',
      connectionMode: 'reauth',
      targetConnectionId: 'connection-7',
      verifierMaterial,
    })
  })
})
