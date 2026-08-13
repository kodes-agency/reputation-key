import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createOAuthStateHandleService } from './oauth-state-handle'

const KEY_A = '11'.repeat(32)
const KEY_B = '22'.repeat(32)

const build = (now: { value: number }, rawHandleKeys = `v2:${KEY_A},v1:${KEY_B}`) =>
  createOAuthStateHandleService({
    store: createInMemoryProviderEphemeralStore(() => now.value),
    handleKeys: createVersionedHmacKeyring(rawHandleKeys),
    sessionKeys: createVersionedHmacKeyring(`v3:${KEY_B},v2:${KEY_A}`),
    random: () => Buffer.alloc(32, 7),
  })

const issue = (
  service: ReturnType<typeof build>,
  nowMs: number,
  overrides: Partial<{
    purpose: 'reviews' | 'import_gbp_v2' | 'performance_reauth'
    connectionMode: 'new' | 'reauth' | 'reconnect'
    targetConnectionId: string | null
  }> = {},
) =>
  service.issue({
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'session-secret-1',
    visibility: 'private',
    purpose: 'reviews',
    connectionMode: 'new',
    targetConnectionId: null,
    nowMs,
    codeVerifier: 'v'.repeat(43),
    oidcNonce: 'n'.repeat(43),
    ...overrides,
  })

describe('OAuth state handles', () => {
  it('keeps authorization claims and verifier material outside the browser handle', async () => {
    const now = { value: 1_000 }
    const service = build(now)
    const handle = await issue(service, now.value)

    expect(handle).toMatch(/^v2\.v2\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/)
    expect(handle).not.toContain('org-1')
    expect(handle).not.toContain('user-1')
    expect(handle).not.toContain('session-secret-1')
    expect(handle).not.toContain('v'.repeat(43))

    await expect(
      service.redeem({
        handle,
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-secret-1',
        nowMs: now.value,
      }),
    ).resolves.toMatchObject({
      ok: true,
      visibility: 'private',
      purpose: 'reviews',
      verifierMaterial: { contractVersion: 'v2', codeVerifier: 'v'.repeat(43) },
    })
  })

  it('does not consume a handle when the session, user, or organization binding mismatches', async () => {
    const now = { value: 1_000 }
    const service = build(now)
    const handle = await issue(service, now.value)

    for (const mismatch of [
      {
        organizationId: 'org-2',
        userId: 'user-1',
        sessionId: 'session-secret-1',
      },
      {
        organizationId: 'org-1',
        userId: 'user-2',
        sessionId: 'session-secret-1',
      },
      {
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'same-user-other-session',
      },
    ]) {
      await expect(
        service.redeem({
          handle,
          ...mismatch,
          nowMs: now.value,
        }),
      ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    }

    await expect(
      service.redeem({
        handle,
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-secret-1',
        nowMs: now.value,
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('returns the server-frozen purpose, mode, and exact target without substitution', async () => {
    const now = { value: 1_000 }
    const service = build(now)
    const handle = await issue(service, now.value, {
      purpose: 'performance_reauth',
      connectionMode: 'reauth',
      targetConnectionId: 'connection-7',
    })

    await expect(
      service.redeem({
        handle,
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-secret-1',
        nowMs: now.value,
      }),
    ).resolves.toMatchObject({
      ok: true,
      purpose: 'performance_reauth',
      connectionMode: 'reauth',
      targetConnectionId: 'connection-7',
      returnRoute: '/import',
    })

    await expect(
      issue(service, now.value, {
        connectionMode: 'new',
        targetConnectionId: 'connection-7',
      }),
    ).rejects.toThrow('mode and target are inconsistent')
  })

  it('fails malformed, expired, and replayed handles closed', async () => {
    const now = { value: 1_000 }
    const service = build(now)
    await expect(
      service.redeem({
        handle: 'v2.v2.forged.value',
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-secret-1',
        nowMs: now.value,
      }),
    ).resolves.toEqual({ ok: false, code: 'malformed' })

    const replayHandle = await issue(service, now.value)
    const input = {
      handle: replayHandle,
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 'session-secret-1',
      nowMs: now.value,
    }
    await expect(service.redeem(input)).resolves.toMatchObject({ ok: true })
    await expect(service.redeem(input)).resolves.toEqual({ ok: false, code: 'not_found' })

    const expiredHandle = await issue(service, now.value)
    now.value += 601_000
    await expect(
      service.redeem({ ...input, handle: expiredHandle, nowMs: now.value }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
  })

  it('accepts retained handle signing keys during rotation', async () => {
    const now = { value: 1_000 }
    const store = createInMemoryProviderEphemeralStore(() => now.value)
    const issuing = createOAuthStateHandleService({
      store,
      handleKeys: createVersionedHmacKeyring(`v1:${KEY_B}`),
      sessionKeys: createVersionedHmacKeyring(`v2:${KEY_A}`),
      random: () => Buffer.alloc(32, 9),
    })
    const handle = await issue(issuing as ReturnType<typeof build>, now.value)
    const rotated = createOAuthStateHandleService({
      store,
      handleKeys: createVersionedHmacKeyring(`v2:${KEY_A},v1:${KEY_B}`),
      sessionKeys: createVersionedHmacKeyring(`v3:${KEY_B},v2:${KEY_A}`),
    })

    await expect(
      rotated.redeem({
        handle,
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-secret-1',
        nowMs: now.value,
      }),
    ).resolves.toMatchObject({ ok: true })
  })
})
