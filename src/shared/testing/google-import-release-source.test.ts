import { describe, expect, it } from 'vitest'
import {
  assertGoogleImportReleaseImageIdentity,
  assertGoogleImportRuntimePackagePurity,
  createGoogleImportReleaseSourcePlan,
  releaseSourcePlanSha256,
  redactedReleaseCommandText,
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

describe('Google import release image identity', () => {
  const unlabeledHistoricalImage = {
    tag: 'repkey-release-baseline-web:baseline',
    sourceRevision: null,
    user: 'node',
  }

  it('accepts an unlabeled historical image only when its exact worktree bound the build', () => {
    expect(() =>
      assertGoogleImportReleaseImageIdentity(unlabeledHistoricalImage, BASELINE, {
        allowUnlabeledMaterializedSource: true,
      }),
    ).not.toThrow()

    expect(() =>
      assertGoogleImportReleaseImageIdentity(unlabeledHistoricalImage, BASELINE),
    ).toThrow('source revision label mismatch')
  })

  it('rejects a misleading revision label and a root runtime', () => {
    expect(() =>
      assertGoogleImportReleaseImageIdentity(
        {
          ...unlabeledHistoricalImage,
          sourceRevision: COMPATIBILITY,
        },
        BASELINE,
        { allowUnlabeledMaterializedSource: true },
      ),
    ).toThrow('source revision label mismatch')

    expect(() =>
      assertGoogleImportReleaseImageIdentity(
        {
          ...unlabeledHistoricalImage,
          sourceRevision: BASELINE,
          user: '',
        },
        BASELINE,
      ),
    ).toThrow('does not run as node')
  })
})

describe('Google import release runtime package purity', () => {
  const scriptBearingBaseline = {
    tag: 'repkey-release-baseline-web:baseline',
    hasScripts: true,
  }

  it('allows scripts only under an explicit image policy', () => {
    expect(() =>
      assertGoogleImportRuntimePackagePurity(scriptBearingBaseline, {
        scriptPolicy: 'allow',
      }),
    ).not.toThrow()

    expect(() => assertGoogleImportRuntimePackagePurity(scriptBearingBaseline)).toThrow(
      'contains package scripts',
    )
  })

  it('accepts a script-free runtime package', () => {
    expect(() =>
      assertGoogleImportRuntimePackagePurity({
        tag: 'repkey-release-final-web:final',
        hasScripts: false,
      }),
    ).not.toThrow()
  })
})

describe('Google import release command evidence', () => {
  it('redacts release credentials while preserving command identity', () => {
    expect(
      redactedReleaseCommandText('docker', [
        'run',
        '-e',
        'DATABASE_URL=postgresql://user:password@postgres:5432/repkey',
        '-e',
        'BETTER_AUTH_SECRET=secret',
        'release-image',
      ]),
    ).toBe(
      'docker run -e DATABASE_URL=[redacted] -e BETTER_AUTH_SECRET=[redacted] release-image',
    )
  })
})
