import { describe, expect, it } from 'vitest'
import {
  createGoogleImportReleaseSourcePlan,
  releaseSourcePlanSha256,
} from './google-import-release-source'

const BASELINE = '1'.repeat(40)
const COMPATIBILITY = '2'.repeat(40)
const FINAL = '3'.repeat(40)

describe('Google import release source plan', () => {
  it('freezes three ordered, distinct full commit identities', () => {
    const plan = createGoogleImportReleaseSourcePlan({
      baselineCommit: BASELINE,
      compatibilityCommit: COMPATIBILITY,
      finalCommit: FINAL,
    })

    expect(plan).toEqual({
      schemaVersion: 'google-import-release-source-v1',
      baselineCommit: BASELINE,
      compatibilityCommit: COMPATIBILITY,
      finalCommit: FINAL,
    })
    expect(releaseSourcePlanSha256(plan)).toMatch(/^[a-f0-9]{64}$/)
    expect(releaseSourcePlanSha256(plan)).toBe(releaseSourcePlanSha256({ ...plan }))
  })

  it.each([
    ['', COMPATIBILITY, FINAL],
    ['abc', COMPATIBILITY, FINAL],
    ['g'.repeat(40), COMPATIBILITY, FINAL],
    ['A'.repeat(40), COMPATIBILITY, FINAL],
  ])(
    'rejects a non-canonical commit identity',
    (baselineCommit, compatibilityCommit, finalCommit) => {
      expect(() =>
        createGoogleImportReleaseSourcePlan({
          baselineCommit,
          compatibilityCommit,
          finalCommit,
        }),
      ).toThrow('full lowercase 40-character Git commit')
    },
  )

  it.each([
    [BASELINE, BASELINE, FINAL],
    [BASELINE, COMPATIBILITY, COMPATIBILITY],
    [BASELINE, BASELINE, BASELINE],
  ])(
    'rejects aliased release source points',
    (baselineCommit, compatibilityCommit, finalCommit) => {
      expect(() =>
        createGoogleImportReleaseSourcePlan({
          baselineCommit,
          compatibilityCommit,
          finalCommit,
        }),
      ).toThrow('must be distinct')
    },
  )
})
