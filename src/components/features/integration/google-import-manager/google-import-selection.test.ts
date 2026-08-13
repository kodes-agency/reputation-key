import { describe, expect, it } from 'vitest'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import {
  GOOGLE_IMPORT_SELECTION_LIMIT,
  filterLoadedCandidates,
  selectionCheckState,
  toggleLoadedCandidates,
  toggleSelectedCandidate,
} from './google-import-selection'

const candidate = (
  id: string,
  eligibility: ImportCandidateDto['eligibility'] = { kind: 'create' },
): ImportCandidateDto => ({
  candidateId: id,
  candidateRef:
    eligibility.kind === 'create' || eligibility.kind === 'relink'
      ? `candidate.${id}`
      : null,
  accountRef: 'account.ref',
  accountDisplayName: 'North region',
  businessName: `Property ${id}`,
  address: `${id} Main Street`,
  primaryCategory: 'Restaurant',
  countryCode: 'US',
  eligibility,
})

describe('Google import loaded-row selection', () => {
  it('caps selection at 100 while preserving the earliest loaded rows', () => {
    const loaded = Array.from({ length: 130 }, (_, index) => candidate(String(index)))
    const result = toggleLoadedCandidates(new Set(), loaded, true)

    expect(result.selectedIds).toHaveLength(GOOGLE_IMPORT_SELECTION_LIMIT)
    expect(result.selectedIds[0]).toBe('0')
    expect(result.selectedIds.at(-1)).toBe('99')
    expect(result.limitReached).toBe(true)
  })

  it('never selects unavailable rows and reports an indeterminate loaded selection', () => {
    const loaded = [
      candidate('create'),
      candidate('relink', {
        kind: 'relink',
        propertyId: '10000000-0000-4000-8000-000000000001' as never,
        profile: {
          name: 'Existing',
          address: null,
          countryCode: 'US',
          timezone: 'America/New_York',
          profileVersion: 2,
        },
      }),
      candidate('blocked', { kind: 'active_binding_conflict' }),
    ]

    const result = toggleLoadedCandidates(new Set(), loaded, true)
    expect(result.selectedIds).toEqual(['create', 'relink'])
    expect(selectionCheckState(new Set(['create']), loaded)).toBe('indeterminate')
    expect(selectionCheckState(new Set(result.selectedIds), loaded)).toBe(true)
  })

  it('rejects a row toggle at the cap without dropping prior selection', () => {
    const selected = new Set(
      Array.from({ length: GOOGLE_IMPORT_SELECTION_LIMIT }, (_, index) => String(index)),
    )
    const result = toggleSelectedCandidate(selected, candidate('overflow'), true)

    expect(result.changed).toBe(false)
    expect(result.limitReached).toBe(true)
    expect(result.selectedIds).toEqual([...selected])
  })

  it('searches only loaded tenant-visible fields without matching references', () => {
    const loaded = [candidate('secret-reference'), candidate('other')]
    loaded[0] = { ...loaded[0]!, businessName: 'Acme Bakery', address: '42 Oak Road' }

    expect(filterLoadedCandidates(loaded, 'bakery')).toEqual([loaded[0]])
    expect(filterLoadedCandidates(loaded, 'oak')).toEqual([loaded[0]])
    expect(filterLoadedCandidates(loaded, 'secret-reference')).toEqual([])
  })
})
