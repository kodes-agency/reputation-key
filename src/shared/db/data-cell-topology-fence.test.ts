import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import {
  DataCellTopologyCutoverFencedError,
  assertSingleUsBetaDataCellAdmissionOpen,
} from './data-cell-topology-fence'

function txWithState(state: string | undefined) {
  const execute = vi.fn(async () => ({
    rows: state === undefined ? [] : [{ state }],
  }))
  return { tx: { execute } as unknown as Tx, execute }
}

describe('single-US beta topology admission fence', () => {
  it.each(['open', 'completed'])('admits while the authority is %s', async (state) => {
    const { tx, execute } = txWithState(state)
    await expect(assertSingleUsBetaDataCellAdmissionOpen(tx)).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('refuses while the operator fence is active', async () => {
    const { tx } = txWithState('fenced')
    await expect(assertSingleUsBetaDataCellAdmissionOpen(tx)).rejects.toBeInstanceOf(
      DataCellTopologyCutoverFencedError,
    )
  })

  it('fails closed if the durable authority is missing or malformed', async () => {
    const missing = txWithState(undefined)
    await expect(assertSingleUsBetaDataCellAdmissionOpen(missing.tx)).rejects.toThrow(
      'authority is unavailable',
    )
    const malformed = txWithState('surprise')
    await expect(assertSingleUsBetaDataCellAdmissionOpen(malformed.tx)).rejects.toThrow(
      'authority is unavailable',
    )
  })
})
