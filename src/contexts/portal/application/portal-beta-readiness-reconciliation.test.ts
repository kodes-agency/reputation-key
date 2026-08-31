import { describe, expect, it } from 'vitest'
import {
  PORTAL_BETA_READINESS_REASON_CODES,
  buildPortalBetaReadinessReport,
  canonicalPortalBetaReadinessReport,
  type PortalBetaReadinessGap,
} from './portal-beta-readiness-reconciliation'

const AS_OF = new Date('2026-08-27T12:00:00.000Z')

const gaps: readonly PortalBetaReadinessGap[] = [
  {
    organizationId: 'org-b',
    propertyId: 'property-b',
    portalId: 'portal-b',
    sourceId: 'link-b',
    reasonCode: 'raw_secondary_link_unclassified',
    relatedIds: ['destination-b', 'destination-b'],
  },
  {
    organizationId: 'org-a',
    propertyId: 'property-a',
    portalId: 'portal-a',
    sourceId: 'portal-a',
    reasonCode: 'creator_provenance_unknown',
    relatedIds: [],
  },
  {
    organizationId: 'org-a',
    propertyId: 'property-a',
    portalId: 'portal-a',
    sourceId: 'token-a',
    reasonCode: 'print_batch_token_requires_replacement',
    relatedIds: ['artifact-a'],
  },
]

describe('Portal beta-readiness reconciliation report', () => {
  it('is canonical for the same cutoff, scope, and identifier-only gaps', () => {
    const first = buildPortalBetaReadinessReport({
      asOf: AS_OF,
      organizationIds: ['org-b', 'org-a', 'org-a'],
      gaps,
    })
    const second = buildPortalBetaReadinessReport({
      asOf: AS_OF,
      organizationIds: ['org-a', 'org-b'],
      gaps: [gaps[2], gaps[0], gaps[1]],
    })

    expect(canonicalPortalBetaReadinessReport(second)).toBe(
      canonicalPortalBetaReadinessReport(first),
    )
    expect(second).toEqual(first)
    expect(first.ready).toBe(false)
    expect(first.counts).toMatchObject({ gapCount: 3, portalCount: 2 })
    expect(first.counts.byReason.creator_provenance_unknown).toBe(1)
    expect(first.counts.byReason.multiple_active_group_memberships).toBe(0)
    expect(Object.keys(first.counts.byReason)).toEqual([
      ...PORTAL_BETA_READINESS_REASON_CODES,
    ])
    expect(first.gaps.map((gap) => gap.sourceId)).toEqual([
      'portal-a',
      'token-a',
      'link-b',
    ])
    expect(first.gaps[1]?.relatedIds).toEqual(['artifact-a'])
    expect(first.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects duplicate reason facts instead of hiding an ambiguous row', () => {
    expect(() =>
      buildPortalBetaReadinessReport({ asOf: AS_OF, gaps: [gaps[0], gaps[0]] }),
    ).toThrow(/duplicate Portal readiness gap/i)
  })

  it('reports a scoped zero-gap inventory without manufacturing defaults', () => {
    const report = buildPortalBetaReadinessReport({
      asOf: AS_OF,
      organizationIds: ['org-a'],
      gaps: [],
    })

    expect(report).toMatchObject({
      ready: true,
      scope: { kind: 'organizations', organizationIds: ['org-a'] },
      counts: { gapCount: 0, portalCount: 0 },
      gaps: [],
    })
    expect(Object.values(report.counts.byReason).every((count) => count === 0)).toBe(true)
  })

  it('rejects content-shaped values at the identifier-only report boundary', () => {
    expect(() =>
      buildPortalBetaReadinessReport({
        asOf: AS_OF,
        gaps: [
          {
            ...gaps[0],
            relatedIds: ['https://private.example/a'],
          },
        ],
      }),
    ).toThrow(/identifier-only/i)
  })
})
