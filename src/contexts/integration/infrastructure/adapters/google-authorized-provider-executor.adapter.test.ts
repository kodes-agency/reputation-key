import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { organizationId, googleConnectionId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import { createGoogleAuthorizedProviderExecutor } from './google-authorized-provider-executor.adapter'

const authorization: GoogleProviderCallAuthorization = Object.freeze({
  capability: 'property.import_gbp_v2',
  organizationId: organizationId('organization-1'),
  propertyId: null,
  connectionId: googleConnectionId('11111111-1111-4111-8111-111111111111'),
  initiatorUserId: 'user-1',
  approvalBindingId: '22222222-2222-4222-8222-222222222222',
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

  it.each([
    'authorization_changed',
    'approval_binding_changed',
    'authorization_denied',
    'policy_refresh_unavailable',
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
})
