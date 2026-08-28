import { describe, expect, it } from 'vitest'
import {
  buildReconciliationReport,
  canonicalReconciliationReport,
  type ReconciliationFinding,
} from './reconciliation-report'

const AS_OF = new Date('2026-08-28T00:00:00.000Z')

const finding = (
  id: string,
  severity: ReconciliationFinding['severity'],
  count: number,
): ReconciliationFinding => ({
  id,
  severity,
  count,
  meaning: `${id} meaning`,
  remediation: `${id} remediation`,
})

describe('buildReconciliationReport', () => {
  it('declares itself non-mutating and sorts findings deterministically', () => {
    const report = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings: [
        finding('zeta', 'informational', 3),
        finding('alpha', 'needs_review', 1),
      ],
    })

    expect(report.mutation).toBe('none')
    expect(report.findings.map(({ id }) => id)).toEqual(['alpha', 'zeta'])
    expect(report.asOf).toBe('2026-08-28T00:00:00.000Z')
  })

  it('blocks migration only on a non-zero blocking finding', () => {
    const clear = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings: [
        finding('conflict', 'blocks_migration', 0),
        finding('info', 'informational', 9),
      ],
    })
    expect(clear.blocksMigration).toBe(false)
    expect(clear.blockingFindingIds).toEqual([])

    const blocked = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings: [finding('conflict', 'blocks_migration', 1)],
    })
    expect(blocked.blocksMigration).toBe(true)
    expect(blocked.blockingFindingIds).toEqual(['conflict'])
  })

  it('does not let a large informational count imply a block', () => {
    const report = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings: [finding('dormant_definitions', 'informational', 10_000)],
    })
    expect(report.blocksMigration).toBe(false)
  })

  it('fingerprints observed state, not the moment of observation', () => {
    const findings = [finding('a', 'needs_review', 2)]
    const morning = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings,
    })
    const evening = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: new Date('2026-08-28T18:00:00.000Z'),
      findings,
    })
    // Same data, later clock — an operator must be able to prove nothing moved.
    expect(evening.fingerprint).toBe(morning.fingerprint)

    const changed = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings: [finding('a', 'needs_review', 3)],
    })
    expect(changed.fingerprint).not.toBe(morning.fingerprint)
  })

  it('changes the fingerprint when a severity is reclassified', () => {
    const before = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings: [finding('a', 'blocks_migration', 1)],
    })
    const after = buildReconciliationReport({
      subject: 'legacy.example',
      version: 1,
      asOf: AS_OF,
      findings: [finding('a', 'needs_review', 1)],
    })
    // Downgrading a blocker must not be able to hide behind an unchanged hash.
    expect(after.fingerprint).not.toBe(before.fingerprint)
  })

  it('refuses an empty or ambiguous finding set', () => {
    expect(() =>
      buildReconciliationReport({
        subject: 'legacy.example',
        version: 1,
        asOf: AS_OF,
        findings: [],
      }),
    ).toThrowError(/no findings/)

    expect(() =>
      buildReconciliationReport({
        subject: 'legacy.example',
        version: 1,
        asOf: AS_OF,
        findings: [finding('a', 'needs_review', 1), finding('a', 'informational', 2)],
      }),
    ).toThrowError(/duplicate finding ids/)
  })

  it('emits stable JSON carrying counts only', () => {
    const json = canonicalReconciliationReport(
      buildReconciliationReport({
        subject: 'legacy.example',
        version: 1,
        asOf: AS_OF,
        findings: [finding('a', 'needs_review', 1)],
      }),
    )
    const parsed = JSON.parse(json) as {
      findings: ReadonlyArray<Record<string, unknown>>
    }
    expect(Object.keys(parsed.findings[0] as object).sort()).toEqual([
      'count',
      'id',
      'meaning',
      'remediation',
      'severity',
    ])
  })
})
