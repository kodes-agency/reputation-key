import { describe, expect, it } from 'vitest'
import { CAPABILITY_POLICY_VERSION } from '../auth/beta-capabilities'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '../domain/data-cell-catalogue'
import { canonicalReleaseEvidence } from './candidate-bound-evidence'
import {
  CANDIDATE_FREEZE_RECORD_VERSION,
  REQUIRED_FREEZE_DRIFT_GATES,
  canonicalCandidateFreezeRecord,
  candidateFreezeRecordPath,
  parseCandidateFreezeRecord,
  type CandidateFreezeRecord,
} from './candidate-freeze-record'

const digest = (value: string): string => value.repeat(64).slice(0, 64)

function candidateFreezeRecordFixture(
  overrides: Partial<CandidateFreezeRecord> = {},
): CandidateFreezeRecord {
  return {
    version: CANDIDATE_FREEZE_RECORD_VERSION,
    evidenceKind: 'candidate-freeze',
    releaseSha: 'a'.repeat(40),
    frozenAt: '2026-08-28T08:00:00.000Z',
    frozenBy: 'release-operator',
    changeRecord: 'CHG-REL-01-001',
    cells: ['us'],
    dependencies: {
      lockfilePath: 'pnpm-lock.yaml',
      lockfileSha256: digest('1'),
      nodeVersion: '22.23.2',
      packageManager: 'pnpm@10.0.0',
    },
    migrations: {
      journalPath: 'drizzle/meta/_journal.json',
      journalSha256: digest('2'),
      migrationHead: '0168_identity_organization_lifecycle_receipts',
      entryCount: 169,
    },
    generatedArtifacts: {
      routeTreePath: 'src/routeTree.gen.ts',
      routeTreeSha256: digest('3'),
      driftGates: REQUIRED_FREEZE_DRIFT_GATES.map((script) => ({
        script,
        outcome: 'clean' as const,
      })),
    },
    authority: {
      releaseControllerSha256: digest('4'),
      iacSha256: digest('5'),
    },
    policy: {
      capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
      dataCellCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    },
    browsers: {
      playwrightPackageVersion: '1.55.0',
      installed: [{ name: 'chromium', version: '1187' }],
    },
    legalRevisionSetSha256: digest('6'),
    ...overrides,
  }
}

describe('candidate freeze record', () => {
  it('pins every artifact REL-01 candidate creation step 1 names', () => {
    const parsed = parseCandidateFreezeRecord(
      canonicalCandidateFreezeRecord(candidateFreezeRecordFixture()),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const record = parsed.evidence
    expect(record.version).toBe('repkey-candidate-freeze-1')
    expect(record.releaseSha).toMatch(/^[0-9a-f]{40}$/u)
    expect(record.dependencies.lockfilePath).toBe('pnpm-lock.yaml')
    expect(record.dependencies.lockfileSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(record.migrations.migrationHead).toMatch(/^[0-9]{4}_/u)
    expect(record.generatedArtifacts.routeTreePath).toBe('src/routeTree.gen.ts')
    expect(record.authority.releaseControllerSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(record.authority.iacSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(record.policy.capabilityPolicyVersion).toBe(CAPABILITY_POLICY_VERSION)
    expect(record.policy.dataCellCataloguePolicyVersion).toBe(
      DATA_CELL_CATALOGUE_POLICY_VERSION,
    )
    expect(record.browsers.playwrightPackageVersion).toBe('1.55.0')
    expect(record.browsers.installed[0]?.name).toBe('chromium')
    expect(record.legalRevisionSetSha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('binds cells to the exact tuple [us] and rejects a second cell', () => {
    const twoCells = canonicalReleaseEvidence({
      ...candidateFreezeRecordFixture(),
      cells: ['us', 'europe'],
    })

    expect(parseCandidateFreezeRecord(twoCells)).toMatchObject({ ok: false })
    expect(
      parseCandidateFreezeRecord(
        canonicalReleaseEvidence({
          ...candidateFreezeRecordFixture(),
          cells: ['europe'],
        }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('rejects a policy version that is not the one this checkout ships', () => {
    const drifted = canonicalReleaseEvidence({
      ...candidateFreezeRecordFixture(),
      policy: {
        capabilityPolicyVersion: 'beta-local-1',
        dataCellCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      },
    })

    expect(parseCandidateFreezeRecord(drifted)).toMatchObject({ ok: false })
  })

  it('requires every generated-artifact drift gate to be clean', () => {
    const partial = canonicalReleaseEvidence({
      ...candidateFreezeRecordFixture(),
      generatedArtifacts: {
        ...candidateFreezeRecordFixture().generatedArtifacts,
        driftGates: [{ script: 'check:schema-drift', outcome: 'clean' }],
      },
    })
    const parsed = parseCandidateFreezeRecord(partial)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('missing required drift gate')
    }
  })

  it('never defaults an absent pin', () => {
    const draft = JSON.parse(
      canonicalCandidateFreezeRecord(candidateFreezeRecordFixture()),
    ) as Record<string, unknown>
    for (const key of Object.keys(draft)) {
      if (key === 'version' || key === 'evidenceKind') continue
      const without = Object.fromEntries(
        Object.entries(draft).filter(([name]) => name !== key),
      )

      expect(parseCandidateFreezeRecord(canonicalReleaseEvidence(without))).toMatchObject(
        { ok: false },
      )
    }
  })

  it('gives each candidate exactly one canonical freeze path', () => {
    expect(candidateFreezeRecordPath('a'.repeat(40))).toBe(
      `docs/release-evidence/beta/freeze/${'a'.repeat(40)}.json`,
    )
  })

  it('requires canonical JSON encoding', () => {
    const reindented = `${JSON.stringify(candidateFreezeRecordFixture(), null, 2)}\n`

    expect(parseCandidateFreezeRecord(reindented)).toMatchObject({ ok: false })
  })
})
