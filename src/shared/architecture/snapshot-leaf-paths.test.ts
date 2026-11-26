import { describe, expect, it } from 'vitest'
import { SNAPSHOT_LEAF_PATHS } from './snapshot-leaf-paths.test-fixtures'

describe('snapshot leaf path list', () => {
  it('is not empty and every path has the dotted shape', () => {
    expect(SNAPSHOT_LEAF_PATHS.size).toBeGreaterThan(0)
    for (const p of SNAPSHOT_LEAF_PATHS) expect(p).toMatch(/^[a-zA-Z][a-zA-Z0-9.*[\]]*$/)
  })

  it('lists every immediate-email source-clock acceptance signal', () => {
    const base = 'notifications.deliveryLag.immediateEmailAcceptance.'
    for (const leaf of [
      'awaitingProviderAcceptance',
      'attemptedAwaitingProviderAcceptance',
      'oldestAwaitingSourceAgeMs',
      'acceptedLatencyP99Ms',
      'acceptedSampleCount',
      'sourceUnlinked',
      'saturated',
    ]) {
      expect(SNAPSHOT_LEAF_PATHS.has(base + leaf), leaf).toBe(true)
    }
  })
})
