import { describe, expect, it, vi } from 'vitest'
import { createRecoveryCutoverRunReader } from './recovery-cutover-run-reader'

describe('Recovery cutover run reader', () => {
  it('returns the latest persisted run projection', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ id: 'run-4', generation: 4 }],
    })

    await expect(
      createRecoveryCutoverRunReader({ execute } as never).findLatest(),
    ).resolves.toEqual({ id: 'run-4', generation: 4 })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('returns undefined when there is no completed run', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })

    await expect(
      createRecoveryCutoverRunReader({ execute } as never).findLatest(),
    ).resolves.toBeUndefined()
  })
})
