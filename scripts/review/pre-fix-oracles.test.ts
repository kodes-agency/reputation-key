import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  FROZEN_REVIEW_SHA,
  repositoryOracleReaders,
  runHistoricalOracleCase,
  runPreFixOracleCli,
  validatePreFixOracleIndex,
} from './pre-fix-oracles'

const INDEX_PATH = resolve(
  'docs/release-evidence/review/pre-fix-oracle-index-2026-08-26.json',
)

type MutableProof = Record<string, unknown> & {
  contains?: string[]
  sha256?: string
  expectedOutput?: string[]
}

type MutableOracle = Record<string, unknown> & {
  id: string
  baselineOutcome: string
  historicalChecks: Array<
    Record<string, unknown> & {
      conclusion: string
      proof: MutableProof
    }
  >
  failureArtifact: Record<string, unknown> & {
    command: string
    resultSha256: string
  }
  currentRegressionProofs: Array<
    Record<string, unknown> & { path: string; contains: string[] }
  >
  resolution: string
  remaining: string[]
}

type MutableIndex = Record<string, unknown> & {
  frozenSha: string
  oracles: MutableOracle[]
}

function readIndex(): MutableIndex {
  return JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as MutableIndex
}

describe('pre-fix regression oracles', () => {
  it('validates all 13 immutable historical artifacts and current gates', () => {
    expect(validatePreFixOracleIndex(readIndex())).toHaveLength(13)
  })

  it('runs a reproduced case as a deterministic expected failure artifact', () => {
    const first = runHistoricalOracleCase(readIndex(), 'PORTAL_UPLOAD_FOREIGN_KEY')
    const second = runHistoricalOracleCase(readIndex(), 'PORTAL_UPLOAD_FOREIGN_KEY')

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      exitCode: 1,
      result: {
        frozenSha: FROZEN_REVIEW_SHA,
        conclusion: 'reproduced_faulty_seam',
      },
    })
  })

  it('reports mixed historical evidence with its distinct operator exit code', () => {
    const output: string[] = []
    const errors: string[] = []

    expect(
      runPreFixOracleCli(['--case', '--', 'PUBLIC_CACHE_PRIVACY'], {
        stdout: (value) => output.push(value),
        stderr: (value) => errors.push(value),
      }),
    ).toBe(2)
    expect(errors).toEqual([])
    expect(JSON.parse(output.join(''))).toMatchObject({
      id: 'PUBLIC_CACHE_PRIVACY',
      conclusion: 'mixed_evidence',
    })
  })

  it('fails when a frozen marker is no longer exact', () => {
    const input = readIndex()
    input.oracles[0]!.historicalChecks[0]!.proof.contains = ['marker-that-never-existed']

    expect(() => validatePreFixOracleIndex(input)).toThrow(
      'does not contain required marker "marker-that-never-existed"',
    )
  })

  it('fails when a frozen or retained content digest changes', () => {
    const frozen = readIndex()
    frozen.oracles[0]!.historicalChecks[0]!.proof.sha256 = '0'.repeat(64)
    expect(() => validatePreFixOracleIndex(frozen)).toThrow('digest mismatch')

    const retained = readIndex()
    retained.oracles[12]!.historicalChecks[0]!.proof.sha256 = '0'.repeat(64)
    expect(() => validatePreFixOracleIndex(retained)).toThrow('digest mismatch')
  })

  it('pins retained evidence to the declared immutable evidence commit', () => {
    const input = readIndex()
    input.oracles[12]!.historicalChecks[0]!.proof.retainedAtCommit = FROZEN_REVIEW_SHA

    expect(() => validatePreFixOracleIndex(input)).toThrow(
      'retained evidence commit does not match the index evidenceCommit',
    )
  })

  it('fails when a zero-result historical search is relabeled', () => {
    const input = readIndex()
    input.oracles[10]!.historicalChecks[2]!.proof.expectedOutput = [
      'invented production import',
    ]

    expect(() => validatePreFixOracleIndex(input)).toThrow('search output mismatch')
  })

  it('does not treat a search execution error as an accepted zero-match result', () => {
    expect(() =>
      validatePreFixOracleIndex(readIndex(), {
        ...repositoryOracleReaders,
        searchGitSource: () => {
          throw new Error('historical search unavailable')
        },
      }),
    ).toThrow('historical search unavailable')
  })

  it('fails when the frozen SHA, case inventory, or order changes', () => {
    const sha = readIndex()
    sha.frozenSha = '0'.repeat(40)
    expect(() => validatePreFixOracleIndex(sha)).toThrowError(ZodError)

    const inventory = readIndex()
    inventory.oracles = inventory.oracles.slice(1)
    expect(() => validatePreFixOracleIndex(inventory)).toThrow(
      'oracle index must contain all 13 accepted cases exactly once and in order',
    )

    const order = readIndex()
    ;[order.oracles[0], order.oracles[1]] = [order.oracles[1]!, order.oracles[0]!]
    expect(() => validatePreFixOracleIndex(order)).toThrow(
      'oracle index must contain all 13 accepted cases exactly once and in order',
    )
  })

  it('uses stable proof IDs for every current regression marker', () => {
    const markers = readIndex().oracles.flatMap((oracle) =>
      oracle.currentRegressionProofs.flatMap((proof) => proof.contains),
    )

    expect(markers.every((marker) => /^@proof [A-Z_]+#\d+$/.test(marker))).toBe(true)
  })

  it('fails when current regression evidence is not an executable test or marker', () => {
    const path = readIndex()
    path.oracles[0]!.currentRegressionProofs[0]!.path = 'src/start.ts'
    expect(() => validatePreFixOracleIndex(path)).toThrow(
      'current regression proof must be an executable test file',
    )

    const marker = readIndex()
    marker.oracles[0]!.currentRegressionProofs[0]!.contains = [
      'current-test-marker-that-does-not-exist',
    ]
    expect(() => validatePreFixOracleIndex(marker)).toThrow(
      'does not contain required marker "current-test-marker-that-does-not-exist"',
    )
  })

  it('binds the operator command, exit code, conclusion, and result digest', () => {
    const command = readIndex()
    command.oracles[0]!.failureArtifact.command = 'pnpm test'
    expect(() => validatePreFixOracleIndex(command)).toThrow('command mismatch')

    const digest = readIndex()
    digest.oracles[0]!.failureArtifact.resultSha256 = '0'.repeat(64)
    expect(() => validatePreFixOracleIndex(digest)).toThrow(
      'failure artifact digest mismatch',
    )

    const exitCode = readIndex()
    exitCode.oracles[0]!.failureArtifact.expectedExitCode = 0
    expect(() => validatePreFixOracleIndex(exitCode)).toThrow(
      'failure artifact exit code must be 1',
    )

    const conclusion = readIndex()
    conclusion.oracles[0]!.failureArtifact.expectedConclusion = 'contrary_evidence'
    expect(() => validatePreFixOracleIndex(conclusion)).toThrow(
      'failure artifact conclusion does not match result',
    )
  })

  it('bounds absence claims to the named historical catalogue row', () => {
    const input = readIndex()
    input.oracles[8]!.historicalChecks[1]!.proof.omits = ['activity.event-handlers']

    expect(() => validatePreFixOracleIndex(input)).toThrow(
      'unexpectedly contains forbidden marker "activity.event-handlers"',
    )
  })

  it('rejects bulk relabeling of historical conclusions and resolutions', () => {
    const conclusions = readIndex()
    for (const entry of conclusions.oracles) {
      entry.baselineOutcome = 'contrary_evidence'
      for (const check of entry.historicalChecks) {
        check.conclusion = 'contrary_evidence'
      }
    }
    expect(() => validatePreFixOracleIndex(conclusions)).toThrow(
      'conclusion contract mismatch',
    )

    const resolutions = readIndex()
    for (const entry of resolutions.oracles) entry.resolution = 'closed'
    expect(() => validatePreFixOracleIndex(resolutions)).toThrow(
      'closed cases cannot retain unresolved work',
    )
  })

  it('requires every partial or open case to name exact remaining work', () => {
    const input = readIndex()
    input.oracles[0]!.remaining = []

    expect(() => validatePreFixOracleIndex(input)).toThrow(
      'partial/open cases must name the residual work',
    )
  })
})
