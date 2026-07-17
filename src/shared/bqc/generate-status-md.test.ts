import { describe, expect, it } from 'vitest'
import { generateBqcStatusMarkdown } from './generate-status-md'
import { validateBqcStatusManifest, type BqcStatusManifest } from './status-schema'

const sample: BqcStatusManifest = {
  schemaVersion: 1,
  program: 'BQC',
  updatedAt: '2026-07-17T12:00:00.000Z',
  baseline: {
    validationReport: 'path/to/report.md',
    validationBaselineSha: '29b02187',
    workingTreeSha: 'abc1234',
  },
  entries: [
    {
      id: 'BQC-0',
      kind: 'phase',
      title: 'Truthful rebaseline and containment',
      state: 'implementation_in_progress',
      owner: 'engineering',
      requiredEvidenceIds: [],
      openFindings: ['STD-P0-01'],
      exceptions: [],
    },
    {
      id: 'BQC-0.1',
      kind: 'slice',
      parentId: 'BQC-0',
      title: 'Machine-readable program status',
      state: 'implementation_in_progress',
      owner: 'engineering',
      requiredEvidenceIds: [],
      openFindings: ['SPEC-P2-01'],
      exceptions: [],
    },
  ],
}

describe('generateBqcStatusMarkdown', () => {
  it('includes baseline SHA and entry rows', () => {
    const md = generateBqcStatusMarkdown(sample)
    expect(md).toContain('29b02187')
    expect(md).toContain('BQC-0')
    expect(md).toContain('BQC-0.1')
    expect(md).toContain('implementation_in_progress')
    expect(md).toContain('STD-P0-01')
    expect(md).toContain('Generated file')
  })

  it('round-trips with a validatable manifest', () => {
    const validated = validateBqcStatusManifest(sample)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const md = generateBqcStatusMarkdown(validated.manifest)
    expect(md.length).toBeGreaterThan(100)
  })
})
