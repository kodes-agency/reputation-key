import { describe, expect, it } from 'vitest'
import {
  validateBqcStatusManifest,
  isAllowedStateTransition,
  assertAllowedStateTransition,
  type BqcStatusManifest,
} from './status-schema'

function validManifest(overrides: Partial<BqcStatusManifest> = {}): BqcStatusManifest {
  return {
    schemaVersion: 1,
    program: 'BQC',
    updatedAt: '2026-07-17T00:00:00.000Z',
    baseline: {
      validationReport:
        'docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/bqr-implementation-validation-report-2026-07-16.md',
      validationBaselineSha: '29b021875c145a7f8827f0ee70fc20935fc5dc79',
    },
    entries: [
      {
        id: 'BQC-0',
        kind: 'phase',
        title: 'Truthful rebaseline and containment',
        state: 'not_started',
        owner: 'engineering',
        requiredEvidenceIds: [],
        openFindings: ['STD-P0-01', 'SPEC-P2-01'],
        exceptions: [],
      },
    ],
    ...overrides,
  }
}

describe('validateBqcStatusManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validateBqcStatusManifest(validManifest())
    expect(result.ok).toBe(true)
  })

  it('rejects wrong schemaVersion', () => {
    const result = validateBqcStatusManifest({
      ...validManifest(),
      schemaVersion: 2,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('schemaVersion'))).toBe(true)
    }
  })

  it('rejects duplicate entry ids', () => {
    const base = validManifest()
    const result = validateBqcStatusManifest({
      ...base,
      entries: [base.entries[0], { ...base.entries[0] }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true)
    }
  })

  it('rejects accepted without evidence or reviewer', () => {
    const result = validateBqcStatusManifest(
      validManifest({
        entries: [
          {
            id: 'BQC-0',
            kind: 'phase',
            title: 'Truthful rebaseline',
            state: 'accepted',
            owner: 'engineering',
            requiredEvidenceIds: [],
            openFindings: [],
            exceptions: [],
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('requiredEvidenceIds'))).toBe(true)
      expect(result.errors.some((e) => e.includes('independentReviewer'))).toBe(true)
      expect(result.errors.some((e) => e.includes('acceptedAt'))).toBe(true)
    }
  })

  it('accepts accepted with evidence, reviewer, and timestamp', () => {
    const result = validateBqcStatusManifest(
      validManifest({
        entries: [
          {
            id: 'BQC-0',
            kind: 'phase',
            title: 'Truthful rebaseline',
            state: 'accepted',
            owner: 'engineering',
            independentReviewer: 'reviewer@example.com',
            requiredEvidenceIds: ['evidence/baseline.md'],
            acceptedAt: '2026-07-17T12:00:00.000Z',
            openFindings: [],
            exceptions: [],
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('rejects blocked without dependency and next review date', () => {
    const result = validateBqcStatusManifest(
      validManifest({
        entries: [
          {
            id: 'BQC-8',
            kind: 'phase',
            title: 'Scale recovery',
            state: 'blocked',
            owner: 'engineering',
            requiredEvidenceIds: [],
            openFindings: [],
            exceptions: [],
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('blockedDependency'))).toBe(true)
      expect(result.errors.some((e) => e.includes('nextReviewDate'))).toBe(true)
    }
  })

  it('rejects slice without parentId', () => {
    const result = validateBqcStatusManifest(
      validManifest({
        entries: [
          {
            id: 'BQC-0.1',
            kind: 'slice',
            title: 'Status manifest',
            state: 'not_started',
            owner: 'engineering',
            requiredEvidenceIds: [],
            openFindings: [],
            exceptions: [],
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('parentId'))).toBe(true)
    }
  })

  it('rejects unknown parentId', () => {
    const result = validateBqcStatusManifest(
      validManifest({
        entries: [
          {
            id: 'BQC-0.1',
            kind: 'slice',
            parentId: 'BQC-99',
            title: 'Status manifest',
            state: 'not_started',
            owner: 'engineering',
            requiredEvidenceIds: [],
            openFindings: [],
            exceptions: [],
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('parentId'))).toBe(true)
    }
  })
})

describe('isAllowedStateTransition', () => {
  it('allows not_started → implementation_in_progress', () => {
    expect(isAllowedStateTransition('not_started', 'implementation_in_progress')).toBe(
      true,
    )
  })

  it('rejects not_started → accepted', () => {
    expect(isAllowedStateTransition('not_started', 'accepted')).toBe(false)
  })

  it('rejects leaving accepted', () => {
    expect(isAllowedStateTransition('accepted', 'implementation_in_progress')).toBe(false)
  })

  it('assertAllowedStateTransition throws on illegal edge', () => {
    expect(() => assertAllowedStateTransition('accepted', 'blocked')).toThrow(
      /invalid BQC state transition/,
    )
  })
})
