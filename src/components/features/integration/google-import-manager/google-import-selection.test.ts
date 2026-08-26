import { describe, expect, it, vi } from 'vitest'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import {
  selectAllEligibleCandidates,
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
  it('selects every eligible loaded row without a product-level cap', () => {
    const loaded = Array.from({ length: 130 }, (_, index) => candidate(String(index)))
    const result = toggleLoadedCandidates(new Set(), loaded, true)

    expect(result.selectedIds).toHaveLength(130)
    expect(result.selectedIds[0]).toBe('0')
    expect(result.selectedIds.at(-1)).toBe('129')
  })

  it('loads every remaining provider page before selecting all eligible locations', async () => {
    const first = Array.from({ length: 100 }, (_, index) => candidate(String(index)))
    const second = Array.from({ length: 100 }, (_, index) =>
      candidate(String(index + 100)),
    )
    const third = [
      ...Array.from({ length: 5 }, (_, index) => candidate(String(index + 200))),
      candidate('blocked', { kind: 'active_binding_conflict' }),
    ]
    const fetchNext = vi
      .fn()
      .mockResolvedValueOnce({ candidates: [...first, ...second], hasNextPage: true })
      .mockResolvedValueOnce({
        candidates: [...first, ...second, ...third],
        hasNextPage: false,
      })

    await expect(
      selectAllEligibleCandidates({ candidates: first, hasNextPage: true }, fetchNext),
    ).resolves.toHaveLength(205)
    expect(fetchNext).toHaveBeenCalledTimes(2)
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

  it('adds another eligible row after more than one worker batch is selected', () => {
    const selected = new Set(Array.from({ length: 130 }, (_, index) => String(index)))
    const result = toggleSelectedCandidate(selected, candidate('overflow'), true)

    expect(result.changed).toBe(true)
    expect(result.selectedIds).toEqual([...selected, 'overflow'])
  })

  it('searches only loaded tenant-visible fields without matching references', () => {
    const loaded = [candidate('secret-reference'), candidate('other')]
    loaded[0] = { ...loaded[0]!, businessName: 'Acme Bakery', address: '42 Oak Road' }

    expect(filterLoadedCandidates(loaded, 'bakery')).toEqual([loaded[0]])
    expect(filterLoadedCandidates(loaded, 'oak')).toEqual([loaded[0]])
    expect(filterLoadedCandidates(loaded, 'secret-reference')).toEqual([])
  })
})
