import { describe, expect, it, vi } from 'vitest'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { createDirectGoogleCredentialUseGate } from './google-credential-execution-gate'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'

describe('direct Google credential use gate', () => {
  it('admits the exact local home and every exact local Property target', async () => {
    const admitPropertyExecution = vi.fn(async () => ({
      kind: 'allow' as const,
      cell: 'us' as const,
      routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    }))
    const gate = createDirectGoogleCredentialUseGate({
      localCellId: 'us',
      admitPropertyExecution,
    })
    await expect(
      gate(buildTestGoogleConnection(), ['property-a', 'property-b']),
    ).resolves.toBeUndefined()
    expect(admitPropertyExecution).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['missing home', { credentialHomeCellId: null, credentialHomePolicyVersion: null }],
    ['wrong home', { credentialHomeCellId: 'europe' as const }],
    ['stale policy', { credentialHomePolicyVersion: 1 }],
  ] as const)('denies %s before property routing', async (_name, override) => {
    const admitPropertyExecution = vi.fn()
    const gate = createDirectGoogleCredentialUseGate({
      localCellId: 'us',
      admitPropertyExecution,
    })
    await expect(
      gate(buildTestGoogleConnection(override), ['property-a']),
    ).rejects.toThrow('unavailable in this data cell')
    expect(admitPropertyExecution).not.toHaveBeenCalled()
  })

  it('denies a wrong or unavailable Property target', async () => {
    const gate = createDirectGoogleCredentialUseGate({
      localCellId: 'us',
      admitPropertyExecution: async () => ({
        kind: 'deny',
        reason: 'wrong_cell',
        localCell: 'us',
        targetCell: 'europe',
      }),
    })
    await expect(gate(buildTestGoogleConnection(), ['property-a'])).rejects.toThrow(
      'unavailable for this Property',
    )
  })
})
