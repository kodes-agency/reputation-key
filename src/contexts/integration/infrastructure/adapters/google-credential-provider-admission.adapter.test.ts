import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createGoogleProviderCredentialAdmission } from './google-credential-provider-admission.adapter'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'

function dbWith(rows: readonly Record<string, unknown>[]) {
  return {
    execute: vi.fn(async () => ({ rows })),
  } as unknown as Pick<Database, 'execute'>
}

const activeRow = {
  status: 'active',
  credential_use_state: 'active',
  lifecycle_version: 2,
  access_version: 3,
  credential_generation: 4,
}

function authorization(
  authorizationVector: GoogleProviderCallAuthorization['authorizationVector'] = {
    connectionLifecycleVersion: 2,
    connectionAccessVersion: 3,
    credentialGeneration: 4,
  },
): GoogleProviderCallAuthorization {
  return {
    capability: 'property.import_gbp_v2',
    organizationId: organizationId('org-admission'),
    propertyId: null,
    connectionId: googleConnectionId('00000000-0000-4000-8000-000000000101'),
    initiatorUserId: 'user-admission',
    expectedCredentialGeneration: Number(authorizationVector.credentialGeneration ?? 4),
    authorizationVector,
  }
}

describe('Google provider credential admission', () => {
  it('admits an exact active connection generation', async () => {
    const admit = createGoogleProviderCredentialAdmission(dbWith([activeRow]))

    await expect(
      admit({
        routeKey: 'oauth.token.refresh',
        authorization: authorization(),
      }),
    ).resolves.toBe(true)
  })

  it.each([
    ['inactive grant', { credential_use_state: 'none' }],
    ['lifecycle changed', { lifecycle_version: 3 }],
    ['access changed', { access_version: 4 }],
    ['credential changed', { credential_generation: 5 }],
  ] as const)('denies when %s', async (_name, override) => {
    const admit = createGoogleProviderCredentialAdmission(
      dbWith([{ ...activeRow, ...override }]),
    )

    await expect(
      admit({
        routeKey: 'oauth.token.refresh',
        authorization: authorization(),
      }),
    ).resolves.toBe(false)
  })

  it('admits a first exchange only while its prospective connection id is unused', async () => {
    const input = {
      routeKey: 'oauth.token.exchange' as const,
      authorization: authorization({
        oauthCredentialOperation: 'exchange_new',
        credentialGeneration: 0,
      }),
    }

    await expect(
      createGoogleProviderCredentialAdmission(dbWith([]))(input),
    ).resolves.toBe(true)
    await expect(
      createGoogleProviderCredentialAdmission(dbWith([activeRow]))(input),
    ).resolves.toBe(false)
  })

  it('admits an exact disconnected target for a replacement exchange', async () => {
    const row = {
      ...activeRow,
      status: 'disconnected',
      credential_use_state: 'none',
    }
    const admit = createGoogleProviderCredentialAdmission(dbWith([row]))

    await expect(
      admit({
        routeKey: 'oauth.token.exchange',
        authorization: authorization({
          oauthCredentialOperation: 'exchange_existing',
          connectionStatus: 'disconnected',
          credentialUseState: 'none',
          connectionLifecycleVersion: 2,
          connectionAccessVersion: 3,
          credentialGeneration: 4,
        }),
      }),
    ).resolves.toBe(true)
  })
})
