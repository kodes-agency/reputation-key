import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { organizationId, googleConnectionId, propertyId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import { createGoogleAuthorizedProviderExecutor } from './google-authorized-provider-executor.adapter'

const authorization: GoogleProviderCallAuthorization = Object.freeze({
  capability: 'property.import_gbp_v2',
  organizationId: organizationId('organization-1'),
  propertyId: null,
  connectionId: googleConnectionId('11111111-1111-4111-8111-111111111111'),
  initiatorUserId: 'user-1',
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({ connectionLifecycleVersion: 3 }),
})
const bindCredential = (credential: string) =>
  createHmac('sha256', 'credential-test-key').update(credential).digest('hex')

const descriptor = Object.freeze({
  routeKey: 'account-management.accounts.list' as const,
  accessToken: 'access-token',
})

function setup(admitted = true) {
  const admit = vi.fn(async () =>
    admitted
      ? { ok: true as const, permitId: 'permit-1' }
      : { ok: false as const, code: 'authorization_denied' as const },
  )
  const gateway = {
    execute: vi.fn(async () => ({
      ok: true as const,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: 'no-store',
        retryAfter: null,
      },
      body: new TextEncoder().encode('{"accounts":[]}'),
    })),
  }
  const executor = createGoogleAuthorizedProviderExecutor({
    bindCredential,
    admit,
    gateway,
  })
  return { admit, gateway, executor }
}

describe('createGoogleAuthorizedProviderExecutor', () => {
  it('binds the exact request into a one-use permit before calling the gateway', async () => {
    const { admit, gateway, executor } = setup()

    await expect(
      executor.execute(descriptor, {
        authorization,
        deadlineMs: Date.parse('2026-08-12T10:00:15.000Z'),
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 })

    expect(admit).toHaveBeenCalledOnce()
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization,
        admission: expect.objectContaining({
          routeKey: 'account-management.accounts.list',
          credentialBinding: bindCredential('access-token'),
          requestBodySha256: null,
          requestBodyBytes: 0,
        }),
      }),
    )
    expect(gateway.execute).toHaveBeenCalledWith({
      permitId: 'permit-1',
      descriptor,
      deadlineMs: Date.parse('2026-08-12T10:00:15.000Z'),
    })
  })

  it('fails closed without sending provider material when admission is denied', async () => {
    const { gateway, executor } = setup(false)

    await expect(
      executor.execute(descriptor, {
        authorization,
        deadlineMs: Date.parse('2026-08-12T10:00:15.000Z'),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'authorization_denied',
      retryAfterMs: 0,
    })
    expect(gateway.execute).not.toHaveBeenCalled()
  })

  it('denies a wrong-cell Property before permit admission or gateway egress', async () => {
    const admit = vi.fn(async () => ({ ok: true as const, permitId: 'permit-1' }))
    const gateway = { execute: vi.fn() }
    const executor = createGoogleAuthorizedProviderExecutor({
      bindCredential,
      admit,
      gateway,
      admitPropertyExecution: async () => ({
        kind: 'deny',
        reason: 'wrong_cell',
        localCell: 'europe',
        targetCell: 'us',
      }),
    })

    await expect(
      executor.execute(descriptor, {
        authorization: {
          ...authorization,
          propertyId: propertyId('33333333-3333-4333-8333-333333333333'),
        },
        deadlineMs: Date.parse('2026-08-12T10:00:15.000Z'),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'wrong_cell',
      retryAfterMs: 0,
    })
    expect(admit).not.toHaveBeenCalled()
    expect(gateway.execute).not.toHaveBeenCalled()
  })

  it.each(['credential_home_unavailable', 'credential_home_mismatch'] as const)(
    'denies %s before permit admission or gateway egress',
    async (code) => {
      const admit = vi.fn(async () => ({ ok: true as const, permitId: 'permit-1' }))
      const gateway = { execute: vi.fn() }
      const executor = createGoogleAuthorizedProviderExecutor({
        bindCredential,
        admit,
        gateway,
        admitDirectCredentialExecution: async () => code,
      })

      await expect(
        executor.execute(descriptor, {
          authorization,
          deadlineMs: Date.parse('2026-08-12T10:00:15.000Z'),
        }),
      ).resolves.toEqual({
        ok: false,
        code: 'admission_denied',
        admissionCode: code,
        retryAfterMs: 0,
      })
      expect(admit).not.toHaveBeenCalled()
      expect(gateway.execute).not.toHaveBeenCalled()
    },
  )

  it.each([
    'authorization_changed',
    'authorization_denied',
    'runtime_unavailable',
  ] as const)('forwards the content-free %s authority denial', async (code) => {
    // Collapsing these to a bare `admission_denied` made a real authorization
    // change indistinguishable from a transient upstream outage downstream.
    const admit = vi.fn(async () => ({ ok: false as const, code }))
    const gateway = { execute: vi.fn() }
    const executor = createGoogleAuthorizedProviderExecutor({
      bindCredential,
      admit,
      gateway,
    })

    await expect(
      executor.execute(descriptor, {
        authorization,
        deadlineMs: Date.parse('2026-08-12T10:00:15.000Z'),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: code,
      retryAfterMs: 0,
    })
    expect(gateway.execute).not.toHaveBeenCalled()
  })

  it('durably prepares and acquires an exact disconnect revoke before gateway dispatch', async () => {
    const now = new Date('2026-08-12T10:00:00.000Z')
    const cleanupAuthorization = {
      ...authorization,
      authorizationVector: Object.freeze({
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 5,
      }),
      disconnectRevoke: Object.freeze({
        attemptId: '70000000-0000-4000-8000-000000000001',
        cleanupDeadlineAtMs: now.getTime() + 60_000,
      }),
    }
    const prepare = vi.fn(async () => ({
      ok: true as const,
      value: { prepared: true as const },
    }))
    const acquireDispatch = vi.fn(async () => ({
      ok: true as const,
      value: { dispatching: true as const },
    }))
    const admit = vi.fn(async () => ({
      ok: true as const,
      permitId: '80000000-0000-4000-8000-000000000001',
    }))
    const gateway = {
      execute: vi.fn(async () => ({
        ok: false as const,
        code: 'transport_error' as const,
        retryAfterMs: 0,
      })),
    }
    const executor = createGoogleAuthorizedProviderExecutor({
      bindCredential,
      admit,
      gateway,
      disconnectRevoke: { prepare, acquireDispatch },
      now: () => now,
    })

    await executor.execute(
      { routeKey: 'oauth.revoke', token: 'refresh-token' },
      { authorization: cleanupAuthorization, deadlineMs: now.getTime() + 30_000 },
    )

    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: cleanupAuthorization.disconnectRevoke.attemptId,
        credentialBinding: bindCredential('refresh-token'),
      }),
    )
    expect(acquireDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupWorkPermitId: '80000000-0000-4000-8000-000000000001',
        credentialBinding: bindCredential('refresh-token'),
      }),
    )
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      admit.mock.invocationCallOrder[0]!,
    )
    expect(admit.mock.invocationCallOrder[0]).toBeLessThan(
      acquireDispatch.mock.invocationCallOrder[0]!,
    )
    expect(acquireDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.execute.mock.invocationCallOrder[0]!,
    )
  })

  it('does not open the gateway when durable disconnect dispatch acquisition fails', async () => {
    const now = new Date('2026-08-12T10:00:00.000Z')
    const gateway = { execute: vi.fn() }
    const executor = createGoogleAuthorizedProviderExecutor({
      bindCredential,
      admit: async () => ({
        ok: true,
        permitId: '80000000-0000-4000-8000-000000000001',
      }),
      gateway,
      disconnectRevoke: {
        prepare: async () => ({ ok: true, value: { prepared: true } }),
        acquireDispatch: async () => ({
          ok: false,
          code: 'scope_mismatch',
        }),
      },
      now: () => now,
    })

    await expect(
      executor.execute(
        { routeKey: 'oauth.revoke', token: 'refresh-token' },
        {
          authorization: {
            ...authorization,
            disconnectRevoke: {
              attemptId: '70000000-0000-4000-8000-000000000001',
              cleanupDeadlineAtMs: now.getTime() + 60_000,
            },
          },
          deadlineMs: now.getTime() + 30_000,
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'admission_denied' })
    expect(gateway.execute).not.toHaveBeenCalled()
  })
})
