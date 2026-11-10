import { describe, expect, it } from 'vitest'
import { validateLifecycleEvidenceRef } from './organization-lifecycle'

describe('Organization evidence references', () => {
  it('accepts only bounded content-free support evidence identifiers', () => {
    expect(validateLifecycleEvidenceRef('support:CASE-2048')).toBe('support:CASE-2048')
    expect(() => validateLifecycleEvidenceRef('free text with spaces')).toThrow(
      /content-free identifier/,
    )
    expect(() => validateLifecycleEvidenceRef('x'.repeat(201))).toThrow(/200/)
  })
})
