import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../application/google-provider-contract'
import {
  createGoogleAuthorizedProviderExecutor,
  createSingle401RefreshExecutor,
  executeGoogleProviderJson,
  type GoogleProviderPermitAdmitter,
} from './google-client.server'

const authorization: GoogleProviderCallAuthorization = {
  capability: 'property.import_gbp_v2',
  organizationId: organizationId('organization-1'),
  propertyId: null,
  connectionId: googleConnectionId('11111111-1111-4111-8111-111111111111'),
  initiatorUserId: 'user-1',
  expectedCredentialGeneration: 3,
  authorizationVector: { credentialGeneration: 3 },
}
const descriptor = {
  routeKey: 'account-management.accounts.list' as const,
  accessToken: 'old-token',
}

function setup(denyRetry = false, changeScope = false) {
  const bodies: Uint8Array[] = []
  const gateway = {
    execute: vi.fn(async () => {
      const first = bodies.length === 0
      const body = new TextEncoder().encode(first ? '{}' : '{"accounts":[]}')
      bodies.push(body)
      return {
        ok: true as const,
        status: first ? 401 : 200,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body,
      }
    }),
  }
  const credentialAdmission = vi.fn(async () => true)
  const admit = vi.fn<GoogleProviderPermitAdmitter>(async () =>
    denyRetry && bodies.length > 0
      ? { ok: false as const, code: 'authorization_changed' as const }
      : { ok: true as const, permitId: `permit-${bodies.length}` },
  )
  const refreshed: GoogleProviderCallAuthorization = {
    ...authorization,
    ...(changeScope ? { organizationId: organizationId('organization-2') } : {}),
    expectedCredentialGeneration: 4,
    authorizationVector: { credentialGeneration: 4 },
  }
  const executor = createSingle401RefreshExecutor({
    executor: createGoogleAuthorizedProviderExecutor({
      bindCredential: (token) => createHash('sha256').update(token).digest('hex'),
      admitCredentialExecution: credentialAdmission,
      admit,
      gateway,
    }),
    refreshAccessToken: async () => undefined,
    getAccessToken: async () => 'fresh-token',
    reauthorize: async () => refreshed,
  })
  const request = () =>
    executeGoogleProviderJson({
      operation: 'listAccounts',
      descriptor,
      authorization,
      executor,
      nowMs: () => 1_800_000_000_000,
    })
  return { request, credentialAdmission, admit, gateway, bodies, refreshed }
}

describe('Google client call pipeline', () => {
  it('rechecks credentials and issues a fresh bound permit after refresh before parsing', async () => {
    const { request, credentialAdmission, admit, gateway, bodies, refreshed } = setup()

    await expect(request()).resolves.toEqual({ accounts: [] })

    expect(credentialAdmission).toHaveBeenCalledTimes(2)
    expect(credentialAdmission).toHaveBeenLastCalledWith({
      routeKey: descriptor.routeKey,
      authorization: refreshed,
    })
    expect(admit).toHaveBeenCalledTimes(2)
    expect(admit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        authorization: refreshed,
        admission: expect.objectContaining({
          credentialBinding: createHash('sha256').update('fresh-token').digest('hex'),
        }),
      }),
    )
    expect(gateway.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        permitId: 'permit-1',
        descriptor: { ...descriptor, accessToken: 'fresh-token' },
      }),
    )
    expect(bodies).toHaveLength(2)
    expect(bodies.every((body) => body.every((byte) => byte === 0))).toBe(true)
  })

  it('keeps answered evidence when refreshed authority refuses the second permit', async () => {
    const { request, admit, gateway } = setup(true)

    await expect(request()).rejects.toMatchObject({
      kind: 'permission_denied',
      dispatch: 'answered',
      providerStatus: 401,
      executionAdmissionCode: 'authorization_changed',
    })
    expect(admit).toHaveBeenCalledTimes(2)
    expect(gateway.execute).toHaveBeenCalledOnce()
  })

  it('never sends a second request if refresh changes the tenant scope', async () => {
    const { request, credentialAdmission, admit, gateway } = setup(false, true)

    await expect(request()).rejects.toMatchObject({
      kind: 'upstream_error',
      dispatch: 'unknown',
    })
    expect(credentialAdmission).toHaveBeenCalledOnce()
    expect(admit).toHaveBeenCalledOnce()
    expect(gateway.execute).toHaveBeenCalledOnce()
  })
})
