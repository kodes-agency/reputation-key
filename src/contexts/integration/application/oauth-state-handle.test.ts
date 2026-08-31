import { createHash } from 'node:crypto'
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
    newExchangeAttemptId: () => '60000000-0000-4000-8000-000000000001',
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
      kind: 'exchange',
      exchangeAttemptId: '60000000-0000-4000-8000-000000000001',
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
      returnRoute: '/properties/import-google',
    })

    await expect(
      issue(service, now.value, {
        connectionMode: 'new',
        targetConnectionId: 'connection-7',
      }),
    ).rejects.toThrow('mode and target are inconsistent')
  })

  it('fails malformed and expired handles closed and turns replay into recovery only', async () => {
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
    await expect(service.redeem(input)).resolves.toEqual({
      ok: true,
      kind: 'recovery',
      exchangeAttemptId: '60000000-0000-4000-8000-000000000001',
      returnRoute: '/properties/import-google',
    })

    const expiredService = build(now)
    const expiredHandle = await issue(expiredService, now.value)
    now.value += 601_000
    await expect(
      expiredService.redeem({ ...input, handle: expiredHandle, nowMs: now.value }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
  })

  it('holds the ceremony record under a keyring-derived key, not a digest of the handle', async () => {
    const now = { value: 1_000 }
    const store = createInMemoryProviderEphemeralStore(() => now.value)
    const handleKeys = createVersionedHmacKeyring(`v2:${KEY_A},v1:${KEY_B}`)
    const service = createOAuthStateHandleService({
      store,
      handleKeys,
      sessionKeys: createVersionedHmacKeyring(`v3:${KEY_B},v2:${KEY_A}`),
      random: () => Buffer.alloc(32, 7),
      newExchangeAttemptId: () => '60000000-0000-4000-8000-000000000001',
    })
    const handle = await issue(service, now.value)

    // The handle reaches Google in a redirect URL, so anyone who later reads it
    // out of history or a log must not be able to compute the store key.
    const unkeyed = createHash('sha256').update(handle).digest('base64url')
    await expect(store.read('oauth-state', unkeyed)).resolves.toBeUndefined()

    const derived = handleKeys.derive('google-oauth-state-record-key', handle, 'v2')!
    const stored = await store.read('oauth-state', derived)
    expect(stored).toBeDefined()
    expect(JSON.parse(stored!)).toMatchObject({
      state: 'issued',
      codeVerifier: 'v'.repeat(43),
      oidcNonce: 'n'.repeat(43),
    })
  })

  it('does not fall back to the pre-cutover unkeyed record key', async () => {
    const now = { value: 1_000 }
    const store = createInMemoryProviderEphemeralStore(() => now.value)
    const handleKeys = createVersionedHmacKeyring(`v2:${KEY_A}`)
    const service = createOAuthStateHandleService({
      store,
      handleKeys,
      sessionKeys: createVersionedHmacKeyring(`v3:${KEY_B}`),
      random: () => Buffer.alloc(32, 7),
      newExchangeAttemptId: () => '60000000-0000-4000-8000-000000000001',
    })
    const handle = await issue(service, now.value)

    // Restage the record exactly where a pre-cutover release wrote it. An
    // OAuth ceremony that spans the deploy fails closed and restartable; it
    // never resolves through the guessable key.
    const derived = handleKeys.derive('google-oauth-state-record-key', handle, 'v2')!
    const stored = await store.read('oauth-state', derived)
    expect(stored).toBeDefined()
    await store.remove('oauth-state', derived)
    await store.putIfAbsent(
      'oauth-state',
      createHash('sha256').update(handle).digest('base64url'),
      stored!,
      600,
    )

    await expect(
      service.redeem({
        handle,
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-secret-1',
        nowMs: now.value,
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
  })

  it('refuses to issue when the injected nonce source does not yield a 32-byte nonce', async () => {
    const now = { value: 1_000 }
    const service = createOAuthStateHandleService({
      store: createInMemoryProviderEphemeralStore(() => now.value),
      handleKeys: createVersionedHmacKeyring(`v2:${KEY_A}`),
      sessionKeys: createVersionedHmacKeyring(`v3:${KEY_B}`),
      // A 10-byte nonce base64url-encodes to 14 characters, so the handle the
      // signer produces no longer satisfies `recordKey`'s nonce shape. This is
      // the one seam that reaches the issue-time derivability guard; with the
      // default `randomBytes` it cannot fire.
      random: () => Buffer.alloc(10, 7),
      newExchangeAttemptId: () => '60000000-0000-4000-8000-000000000001',
    })

    await expect(issue(service, now.value)).rejects.toThrow(
      'OAuth state record key is not derivable',
    )
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
