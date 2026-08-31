import { describe, expect, it } from 'vitest'
import {
  PEOPLE_CUTOVER_EVIDENCE_VERSION,
  canonicalPeopleCutoverEvidence,
  createPeopleCutoverEvidence,
  parsePeopleCutoverEvidence,
  peopleCutoverEvidenceSha256,
} from './people-cutover-evidence'

const digest = (value: string): string => value.repeat(64).slice(0, 64)

function evidence() {
  return createPeopleCutoverEvidence({
    checkedAt: new Date('2026-08-25T10:00:00.000Z'),
    scope: { kind: 'global', organizationIds: [] },
    fingerprintSha256: digest('a'),
    counts: {
      legacyAssignments: 4,
      expectedParticipations: 3,
      matchedParticipations: 3,
      expectedResponsibilities: 3,
      matchedResponsibilities: 3,
      expectedGroupMemberships: 1,
      matchedGroupMemberships: 1,
      anomalies: 0,
      missingMappings: 0,
    },
    operator: { id: 'release-operator', correlationId: 'corr-people-cutover' },
  })
}

describe('people cutover evidence', () => {
  it('round-trips only canonical, content-minimal passing evidence', () => {
    const value = evidence()
    expect(value.version).toBe(PEOPLE_CUTOVER_EVIDENCE_VERSION)

    const content = canonicalPeopleCutoverEvidence(value)
    const parsed = parsePeopleCutoverEvidence(content)

    expect(parsed).toMatchObject({
      ok: true,
      digest: peopleCutoverEvidenceSha256(content),
      evidence: value,
    })
    expect(content).not.toContain('user-')
    expect(content).not.toContain('portal-')
  })

  it('rejects non-canonical and non-exact artifacts', () => {
    const value = evidence()
    expect(parsePeopleCutoverEvidence(`${JSON.stringify(value, null, 2)}\n`)).toEqual({
      ok: false,
      errors: ['people cutover evidence must use canonical JSON encoding'],
    })

    expect(() =>
      createPeopleCutoverEvidence({
        ...value,
        checkedAt: new Date(value.checkedAt),
        counts: { ...value.counts, missingMappings: 1 },
      }),
    ).toThrow(/exact parity/i)
  })

  it('rejects v1 artifacts so retired Team parity cannot be silently trusted', () => {
    const value = evidence()
    const legacy = {
      ...value,
      version: 'repkey-people-cutover-1',
      counts: {
        ...value.counts,
        expectedMemberships: 2,
        matchedMemberships: 2,
      },
    }

    const parsed = parsePeopleCutoverEvidence(`${JSON.stringify(legacy)}\n`)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) expect(parsed.errors.join('\n')).toMatch(/version|unrecognized key/i)
  })

  it('normalizes organization-scoped evidence deterministically', () => {
    const value = createPeopleCutoverEvidence({
      ...evidence(),
      checkedAt: new Date('2026-08-25T10:00:00.000Z'),
      scope: { kind: 'organizations', organizationIds: ['org-b', 'org-a', 'org-a'] },
    })

    expect(value.scope.organizationIds).toEqual(['org-a', 'org-b'])
  })
})
