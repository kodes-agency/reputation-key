import { describe, expect, it } from 'vitest'
import {
  buildPeopleAuthorityReconciliationReport,
  canonicalPeopleAuthorityReconciliationReport,
  type PeopleAuthorityReconciliationRow,
} from './people-authority-reconciliation.server'

const AS_OF = new Date('2026-08-26T08:00:00.000Z')

const rows: readonly PeopleAuthorityReconciliationRow[] = [
  {
    source: 'team_membership',
    sourceId: 'team-row-2',
    dimension: 'team_quarantine',
    outcome: 'unsafe',
    organizationId: 'org-b',
    propertyId: 'property-b',
    portalId: null,
    userId: null,
    reasonCode: 'active_team_relation_quarantined',
    relatedIds: ['team-2', 'participation-2'],
  },
  {
    source: 'legacy_staff_assignment',
    sourceId: 'assignment-1',
    dimension: 'participant_mapping',
    outcome: 'mappable',
    organizationId: 'org-a',
    propertyId: 'property-a',
    portalId: null,
    userId: 'user-a',
    reasonCode: 'participant_and_participation_can_be_created',
    relatedIds: [],
  },
  {
    source: 'staff_participation',
    sourceId: 'participation-1',
    dimension: 'participation_integrity',
    outcome: 'exact',
    organizationId: 'org-a',
    propertyId: 'property-a',
    portalId: null,
    userId: null,
    reasonCode: 'canonical_participation_valid',
    relatedIds: ['participant-1'],
  },
]

describe('people authority reconciliation report', () => {
  it('is byte-for-byte stable for the same scope, observation time, and rows', () => {
    const first = buildPeopleAuthorityReconciliationReport({
      asOf: AS_OF,
      organizationIds: ['org-b', 'org-a', 'org-a'],
      rows,
    })
    const second = buildPeopleAuthorityReconciliationReport({
      asOf: AS_OF,
      organizationIds: ['org-a', 'org-b'],
      rows: [rows[2], rows[0], rows[1]],
    })

    expect(canonicalPeopleAuthorityReconciliationReport(first)).toBe(
      canonicalPeopleAuthorityReconciliationReport(second),
    )
    expect(first).toEqual(second)
    expect(first.counts).toEqual({
      exact: 1,
      mappable: 1,
      conflict: 0,
      orphan: 0,
      unsafe: 1,
      total: 3,
    })
    expect(first.rows.map((row) => row.sourceId)).toEqual([
      'assignment-1',
      'participation-1',
      'team-row-2',
    ])
    expect(first.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects duplicate source dimensions instead of hiding an unexplained row', () => {
    expect(() =>
      buildPeopleAuthorityReconciliationReport({
        asOf: AS_OF,
        rows: [rows[0], rows[0]],
      }),
    ).toThrow(/duplicate reconciliation row/i)
  })

  it('changes the fingerprint when a classification changes', () => {
    const first = buildPeopleAuthorityReconciliationReport({ asOf: AS_OF, rows })
    const changed = buildPeopleAuthorityReconciliationReport({
      asOf: AS_OF,
      rows: rows.map((row) =>
        row.sourceId === 'assignment-1'
          ? {
              ...row,
              outcome: 'conflict' as const,
              reasonCode: 'canonical_mapping_disagrees',
            }
          : row,
      ),
    })

    expect(changed.fingerprintSha256).not.toBe(first.fingerprintSha256)
  })
})
