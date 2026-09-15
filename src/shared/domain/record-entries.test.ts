import { describe, expect, it } from 'vitest'
import { sameRecordEntries } from './record-entries'

describe('sameRecordEntries', () => {
  it('ignores key insertion order', () => {
    expect(
      sameRecordEntries(
        { organizationId: 'organization-1', sourceEpoch: 3, enabled: true },
        { enabled: true, sourceEpoch: 3, organizationId: 'organization-1' },
      ),
    ).toBe(true)
  })

  it('compares values strictly by default', () => {
    expect(
      sameRecordEntries<string | number>({ sourceEpoch: 3 }, { sourceEpoch: '3' }),
    ).toBe(false)
    expect(sameRecordEntries({ lineage: null }, { lineage: null })).toBe(true)
  })

  it('refuses a key present on one side only, even with an undefined value', () => {
    expect(sameRecordEntries({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameRecordEntries({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    expect(
      sameRecordEntries<string | undefined>(
        { review_analysis: 'v1', property_trends: undefined },
        { review_analysis: 'v1' },
      ),
    ).toBe(false)
  })

  it('refuses the same key count under different keys', () => {
    expect(sameRecordEntries({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false)
  })

  it('lets a caller relax a value but never the key set', () => {
    const ignoringGeneration = (
      left: Readonly<Record<string, number>>,
      right: Readonly<Record<string, number>>,
    ) =>
      sameRecordEntries(
        left,
        right,
        (key) => key === 'credentialGeneration' || left[key] === right[key],
      )

    expect(
      ignoringGeneration(
        { accessVersion: 4, credentialGeneration: 7 },
        { credentialGeneration: 8, accessVersion: 4 },
      ),
    ).toBe(true)
    expect(
      ignoringGeneration(
        { accessVersion: 4, credentialGeneration: 7 },
        { accessVersion: 5, credentialGeneration: 7 },
      ),
    ).toBe(false)
    expect(
      ignoringGeneration(
        { accessVersion: 4, credentialGeneration: 7 },
        { accessVersion: 4 },
      ),
    ).toBe(false)
  })

  it('treats two empty records as the same', () => {
    expect(sameRecordEntries({}, {})).toBe(true)
  })
})
