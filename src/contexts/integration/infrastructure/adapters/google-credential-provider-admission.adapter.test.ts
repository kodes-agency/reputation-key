import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { createDirectGoogleProviderCredentialAdmission } from './google-credential-provider-admission.adapter'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'

function dbWith(rows: readonly Record<string, unknown>[]) {
  return {
    execute: vi.fn(async () => ({ rows })),
  } as unknown as Pick<Database, 'execute'>
}

const valid = {
  connection_id: '00000000-0000-4000-8000-000000000101',
  connection_home_cell_id: 'us',
  connection_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION,
  connection_authority_generation: 4,
  status: 'active',
  credential_use_state: 'active',
  authority_home_cell_id: 'us',
  authority_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION,
  authority_generation: 4,
}

const authorization = (
  authorizationVector: GoogleProviderCallAuthorization['authorizationVector'] = {
    credentialGeneration: 1,
  },
): GoogleProviderCallAuthorization => ({
  capability: 'property.import_gbp_v2',
  organizationId: organizationId('org-admission'),
  propertyId: null,
  connectionId: googleConnectionId('00000000-0000-4000-8000-000000000101'),
  initiatorUserId: 'user-admission',
  approvalBindingId: 'approval-admission',
  expectedCredentialGeneration: Number(authorizationVector.credentialGeneration ?? 1),
  authorizationVector,
})

const existingInput = {
  routeKey: 'oauth.token.refresh' as const,
  authorization: authorization(),
}

describe('direct Google provider credential admission', () => {
  it('admits only an exact connection + canonical Organization home in this cell', async () => {
    const admit = createDirectGoogleProviderCredentialAdmission({
      db: dbWith([valid]),
      localCellId: 'us',
    })
    await expect(admit(existingInput)).resolves.toBe('direct')
  })

  it.each([
    ['missing authority', { authority_home_cell_id: null }],
    ['authority conflict', { authority_home_cell_id: 'europe' }],
    [
      'stale authority policy',
      { authority_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION - 1 },
    ],
    ['stale authority generation', { authority_generation: 5 }],
    ['missing connection generation', { connection_authority_generation: null }],
    ['inactive grant', { credential_use_state: 'none' }],
  ] as const)('fails closed for %s', async (_name, override) => {
    const admit = createDirectGoogleProviderCredentialAdmission({
      db: dbWith([{ ...valid, ...override }]),
      localCellId: 'us',
    })
    await expect(admit(existingInput)).resolves.toBe('credential_home_unavailable')
  })

  it('distinguishes an exact canonical home in another cell', async () => {
    const admit = createDirectGoogleProviderCredentialAdmission({
      db: dbWith([
        {
          ...valid,
          connection_home_cell_id: 'europe',
          authority_home_cell_id: 'europe',
        },
      ]),
      localCellId: 'us',
    })
    await expect(admit(existingInput)).resolves.toBe('credential_home_mismatch')
  })

  it('admits a first exchange only when its frozen prospective vector matches the current Organization home', async () => {
    const admit = createDirectGoogleProviderCredentialAdmission({
      db: dbWith([
        {
          connection_id: null,
          connection_home_cell_id: null,
          connection_policy_version: null,
          connection_authority_generation: null,
          status: null,
          credential_use_state: null,
          authority_home_cell_id: 'us',
          authority_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION,
          authority_generation: 4,
        },
      ]),
      localCellId: 'us',
    })

    await expect(
      admit({
        routeKey: 'oauth.token.exchange',
        authorization: authorization({
          credentialGeneration: 0,
          oauthCredentialOperation: 'exchange_new',
          credentialHomeCellId: 'us',
          credentialHomePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
          credentialHomeAuthorityGeneration: 4,
        }),
      }),
    ).resolves.toBe('direct')
  })

  it.each([
    ['a non-exchange route', 'oauth.token.refresh', 'exchange_new', 4],
    ['a missing prospective marker', 'oauth.token.exchange', null, 4],
    ['a stale home generation', 'oauth.token.exchange', 'exchange_new', 3],
  ] as const)(
    'rejects a connectionless credential admission for %s',
    async (_name, routeKey, operation, generation) => {
      const admit = createDirectGoogleProviderCredentialAdmission({
        db: dbWith([
          {
            connection_id: null,
            connection_home_cell_id: null,
            connection_policy_version: null,
            connection_authority_generation: null,
            status: null,
            credential_use_state: null,
            authority_home_cell_id: 'us',
            authority_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION,
            authority_generation: 4,
          },
        ]),
        localCellId: 'us',
      })
      await expect(
        admit({
          routeKey,
          authorization: authorization({
            credentialGeneration: 0,
            ...(operation === null ? {} : { oauthCredentialOperation: operation }),
            credentialHomeCellId: 'us',
            credentialHomePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
            credentialHomeAuthorityGeneration: generation,
          }),
        }),
      ).resolves.toBe('credential_home_unavailable')
    },
  )

  it('rejects a prospective exchange once that connection id already exists', async () => {
    const admit = createDirectGoogleProviderCredentialAdmission({
      db: dbWith([valid]),
      localCellId: 'us',
    })
    await expect(
      admit({
        routeKey: 'oauth.token.exchange',
        authorization: authorization({
          credentialGeneration: 0,
          oauthCredentialOperation: 'exchange_new',
          credentialHomeCellId: 'us',
          credentialHomePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
          credentialHomeAuthorityGeneration: 4,
        }),
      }),
    ).resolves.toBe('credential_home_unavailable')
  })

  it('does not mistake an existing legacy row with a null home for a prospective connection id', async () => {
    const admit = createDirectGoogleProviderCredentialAdmission({
      db: dbWith([
        {
          ...valid,
          connection_home_cell_id: null,
          connection_policy_version: null,
          connection_authority_generation: null,
          status: 'disconnected',
          credential_use_state: 'none',
        },
      ]),
      localCellId: 'us',
    })
    await expect(
      admit({
        routeKey: 'oauth.token.exchange',
        authorization: authorization({
          credentialGeneration: 0,
          oauthCredentialOperation: 'exchange_new',
          credentialHomeCellId: 'us',
          credentialHomePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
          credentialHomeAuthorityGeneration: 4,
        }),
      }),
    ).resolves.toBe('credential_home_unavailable')
  })

  it('admits an exact disconnected target for a governed replacement exchange', async () => {
    const admit = createDirectGoogleProviderCredentialAdmission({
      db: dbWith([
        {
          ...valid,
          status: 'disconnected',
          credential_use_state: 'none',
          lifecycle_version: 5,
          access_version: 8,
          credential_generation: 13,
        },
      ]),
      localCellId: 'us',
    })
    await expect(
      admit({
        routeKey: 'oauth.token.exchange',
        authorization: authorization({
          oauthCredentialOperation: 'exchange_existing',
          connectionStatus: 'disconnected',
          credentialUseState: 'none',
          connectionLifecycleVersion: 5,
          connectionAccessVersion: 8,
          credentialGeneration: 13,
          credentialHomeCellId: 'us',
          credentialHomePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
          credentialHomeAuthorityGeneration: 4,
        }),
      }),
    ).resolves.toBe('direct')
  })
})
