import { describe, expect, it } from 'vitest'
import {
  createInMemoryOAuthCallbackQuotaCounter,
  createOAuthCallbackAbuseGate,
  type OAuthCallbackQuotaCounter,
} from './oauth-callback-abuse-gate'

const SECRET = 's'.repeat(32)

describe('OAuth callback abuse admission', () => {
  it('uses audience-separated HMAC keys rather than tenant or session identifiers', async () => {
    const calls: Array<Parameters<OAuthCallbackQuotaCounter['consume']>[0]> = []
    const gate = createOAuthCallbackAbuseGate({
      counter: {
        consume: async (input) => {
          calls.push(input)
          return true
        },
      },
      hmacSecret: SECRET,
      projectIdentity: 'google-client-1',
    })

    await expect(
      gate.admitPreState({
        sessionId: 'session-secret-1',
        trustedSourceId: null,
        nowMs: 1_000,
      }),
    ).resolves.toEqual({ ok: true })
    await expect(
      gate.admitResolvedTenant({
        organizationId: 'org-secret-1',
        userId: 'user-secret-1',
        nowMs: 1_000,
      }),
    ).resolves.toEqual({ ok: true })

    expect(calls.map((call) => call.audience)).toEqual(['pre_state', 'resolved_tenant'])
    expect(JSON.stringify(calls)).not.toContain('session-secret-1')
    expect(JSON.stringify(calls)).not.toContain('org-secret-1')
    expect(JSON.stringify(calls)).not.toContain('user-secret-1')
    expect(calls[0].subjectKey).not.toBe(calls[1].subjectKey)
  })

  it('bounds repeated session and resolved-tenant attempts independently', async () => {
    const gate = createOAuthCallbackAbuseGate({
      counter: createInMemoryOAuthCallbackQuotaCounter(),
      hmacSecret: SECRET,
      projectIdentity: 'google-client-1',
    })
    for (let index = 0; index < 30; index += 1) {
      await expect(
        gate.admitPreState({
          sessionId: 'session-1',
          trustedSourceId: null,
          nowMs: 1_000,
        }),
      ).resolves.toEqual({ ok: true })
    }
    await expect(
      gate.admitPreState({
        sessionId: 'session-1',
        trustedSourceId: null,
        nowMs: 1_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'pre_state_quota_exhausted' })

    for (let index = 0; index < 20; index += 1) {
      await expect(
        gate.admitResolvedTenant({
          organizationId: 'org-1',
          userId: 'user-1',
          nowMs: 1_000,
        }),
      ).resolves.toEqual({ ok: true })
    }
    await expect(
      gate.admitResolvedTenant({
        organizationId: 'org-1',
        userId: 'user-1',
        nowMs: 1_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'tenant_quota_exhausted' })
  })

  it('fails closed when the shared counter is unavailable', async () => {
    const gate = createOAuthCallbackAbuseGate({
      counter: { consume: async () => Promise.reject(new Error('redis down')) },
      hmacSecret: SECRET,
      projectIdentity: 'google-client-1',
    })
    await expect(
      gate.admitPreState({
        sessionId: null,
        trustedSourceId: null,
        nowMs: 1_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'quota_unavailable' })
  })
})
