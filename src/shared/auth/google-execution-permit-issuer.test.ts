import { describe, expect, it, vi } from 'vitest'
import {
  createGoogleExecutionPermitIssuer,
  type GoogleExecutionPermitAdmissionInput,
  type GoogleExecutionPermitRecord,
} from './google-execution-permit-issuer'

const NOW = new Date('2026-08-10T10:00:00.000Z')
type Tx = Readonly<Record<string, never>>

const admissionInput = (
  overrides: Partial<GoogleExecutionPermitAdmissionInput> = {},
): GoogleExecutionPermitAdmissionInput => ({
  capability: 'property.import_gbp_v2',
  scope: {
    organizationId: 'org-1',
    propertyId: null,
    connectionId: 'connection-1',
    initiatorUserId: 'user-1',
  },
  expectedAuthorizationVector: { grantGeneration: 3, connectionGeneration: 8 },
  operationKey: 'import.start',
  routeKey: 'google.business-information.locations.list',
  routeCatalogVersion: 'google-provider-routes-1',
  quotaPolicyId: 'gbp-business-information-interactive-1',
  providerRequestBinding: {
    requestBindingSha256: 'a'.repeat(64),
    credentialBinding: 'b'.repeat(64),
    projectFingerprint: 'c'.repeat(64),
    requestBodySha256: null,
    requestBodyBytes: 0,
  },
  ...overrides,
})

function fixture(
  options: Readonly<{
    killed?: boolean
    vector?: Readonly<Record<string, string | number | boolean | null>>
  }> = {},
) {
  const records: GoogleExecutionPermitRecord[] = []
  const authorize = vi.fn(async () => ({
    allowed: true as const,
    vector: options.vector ?? { grantGeneration: 3, connectionGeneration: 8 },
  }))
  const issuer = createGoogleExecutionPermitIssuer<Tx>({
    store: {
      transaction: (run) => run({}),
      loadControl: async () => ({
        killedCapabilities: options.killed ? ['property.import_gbp_v2'] : [],
      }),
      insertPermit: async (_tx, record) => {
        records.push(record)
      },
    },
    clock: () => NOW,
    newPermitId: () => 'permit-1',
    authorize,
  })
  return { issuer, authorize, records }
}

describe('Google execution permit issuer', () => {
  it('fails closed at the live capability control before resolving authorization', async () => {
    const { issuer, authorize, records } = fixture({ killed: true })

    await expect(issuer(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'capability_killed',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('rejects a changed authorization vector without persisting a permit', async () => {
    const { issuer, records } = fixture({ vector: { grantGeneration: 4 } })

    await expect(issuer(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
    expect(records).toEqual([])
  })

  it('keeps provider request bindings out of the authorization resolver vector', async () => {
    const { issuer, records } = fixture({
      vector: {
        grantGeneration: 3,
        connectionGeneration: 8,
        requestBindingSha256: 'd'.repeat(64),
      },
    })

    await expect(
      issuer(
        admissionInput({
          expectedAuthorizationVector: {
            grantGeneration: 3,
            connectionGeneration: 8,
            requestBindingSha256: 'd'.repeat(64),
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(records).toEqual([])
  })

  it('rejects a malformed provider request binding', async () => {
    const { issuer, records } = fixture()

    await expect(
      issuer(
        admissionInput({
          providerRequestBinding: {
            ...admissionInput().providerRequestBinding,
            requestBodySha256: null,
            requestBodyBytes: 1,
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(records).toEqual([])
  })

  it('persists the resolved vector and request binding in one admitted permit', async () => {
    const { issuer, records } = fixture()

    await expect(issuer(admissionInput())).resolves.toMatchObject({
      ok: true,
      permit: {
        id: 'permit-1',
        state: 'admitted',
        startDeadlineAt: new Date('2026-08-10T10:00:10.000Z'),
      },
    })
    expect(records).toEqual([
      expect.objectContaining({
        authorizationVector: {
          grantGeneration: 3,
          connectionGeneration: 8,
          requestBindingSha256: 'a'.repeat(64),
          credentialBinding: 'b'.repeat(64),
          projectFingerprint: 'c'.repeat(64),
          requestBodySha256: null,
          requestBodyBytes: 0,
        },
      }),
    ])
  })
})
