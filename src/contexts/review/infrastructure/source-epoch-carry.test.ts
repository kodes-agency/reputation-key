import { describe, expect, it } from 'vitest'
import { isSourceEpochCarry, type SourceEpochCarryEvidence } from './source-epoch-carry'

const V1 = 'review-material-v1'
const LEGACY = 'legacy-unverified-v0'

const evidence = (
  sourceEpoch: number,
  normalizedDigest: string | null,
  normalizationVersion = V1,
): SourceEpochCarryEvidence => ({ sourceEpoch, normalizationVersion, normalizedDigest })

describe('isSourceEpochCarry', () => {
  it('attests unchanged material re-bound to a newer epoch', () => {
    expect(isSourceEpochCarry(evidence(0, 'a'), evidence(1, 'a'), 'unchanged')).toBe(true)
    // The digests alone are enough when no observation is at hand.
    expect(isSourceEpochCarry(evidence(0, 'a'), evidence(1, 'a'), null)).toBe(true)
  })

  it('never treats a guest edit as a carry, whichever epoch it lands in', () => {
    expect(
      isSourceEpochCarry(evidence(0, 'a'), evidence(1, 'b'), 'material_change'),
    ).toBe(false)
    expect(
      isSourceEpochCarry(evidence(0, 'a'), evidence(0, 'b'), 'material_change'),
    ).toBe(false)
  })

  it('requires the epoch to have moved on', () => {
    expect(isSourceEpochCarry(evidence(1, 'a'), evidence(1, 'a'), 'unchanged')).toBe(
      false,
    )
    expect(isSourceEpochCarry(evidence(2, 'a'), evidence(1, 'a'), 'unchanged')).toBe(
      false,
    )
  })

  it("follows Review's recorded comparison for a baseline recorded before digests", () => {
    const legacy = evidence(0, null, LEGACY)
    expect(
      isSourceEpochCarry(legacy, evidence(1, 'a'), 'normalization_shadow_match'),
    ).toBe(true)
    expect(isSourceEpochCarry(legacy, evidence(1, 'a'), 'baseline_unavailable')).toBe(
      true,
    )
    expect(isSourceEpochCarry(legacy, evidence(1, 'a'), 'material_change')).toBe(false)
    expect(isSourceEpochCarry(legacy, evidence(1, 'a'), null)).toBe(false)
  })
})
