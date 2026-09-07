import { describe, expect, it, vi } from 'vitest'
import { retractMetric } from './retract-metric'

describe('retractMetric', () => {
  it('exposes the command-store operation without adapting its command or result', async () => {
    const command = { sourceEventId: 'retraction-1' } as never
    const result = { status: 'retracted' as const }
    const retract = vi.fn().mockResolvedValue(result)
    const useCase = retractMetric({ retractMetric: retract } as never)

    await expect(useCase(command)).resolves.toBe(result)
    expect(retract).toHaveBeenCalledWith(command)
  })
})
