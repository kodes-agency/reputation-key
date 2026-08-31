import { describe, expect, it } from 'vitest'
import { OrganizationExportRetrievalSecretDeriver } from './organization-export-retrieval-secret'

const REQUEST = '18deca2e-91a7-46e4-b92b-73163568ed84'
const OPERATION = 'c0f7b313-9f89-4b76-8693-dba1259af489'

describe('Organization Export retrieval secret derivation', () => {
  it('derives a stable 256-bit secret bound to both request and operation', () => {
    const deriver = OrganizationExportRetrievalSecretDeriver.create('k'.repeat(32))

    expect(deriver.derive({ requestId: REQUEST, operationId: OPERATION })).toEqual(
      deriver.derive({ requestId: REQUEST, operationId: OPERATION }),
    )
    expect(deriver.derive({ requestId: REQUEST, operationId: OPERATION })).toHaveLength(
      32,
    )
    expect(
      deriver.derive({
        requestId: REQUEST,
        operationId: '5bb0f51d-bc86-4a97-8e22-997da171ef47',
      }),
    ).not.toEqual(deriver.derive({ requestId: REQUEST, operationId: OPERATION }))
  })

  it('refuses weak keys and non-UUID identities', () => {
    expect(() => OrganizationExportRetrievalSecretDeriver.create('short')).toThrow(
      /at least 32 bytes/,
    )
    const deriver = OrganizationExportRetrievalSecretDeriver.create('k'.repeat(32))
    expect(() =>
      deriver.derive({ requestId: 'request', operationId: OPERATION }),
    ).toThrow(/UUID-bound/)
  })
})
