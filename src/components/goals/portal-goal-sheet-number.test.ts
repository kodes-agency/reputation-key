import { describe, expect, it } from 'vitest'
import {
  changedDraft,
  openingDraft,
  portalGoalSheetModel,
  type PortalGoalSheetDraft,
} from './portal-goal-sheet-view'
import { SHEET_READY as READY } from './portal-goal.stories.fixtures'

// The set sheet's number box (copy deck S-11): what a typed text reads as, the
// − and + along the goal grid, and what Enter or leaving the box writes. On
// Seaview's Oct 23, 40 recommended for November.
const ratings = { measure: 'portal_rating_count' } as const

const typed = (draft: PortalGoalSheetDraft, text: string) =>
  changedDraft(draft, { kind: 'type', text }, READY)

describe('the set sheet number box', () => {
  it('0 is invalid', () => {
    const model = portalGoalSheetModel(typed(openingDraft(READY, ratings), '0'), READY)

    expect(model.number).toMatchObject({ text: '0', value: null, invalid: true })
    expect(model.number.lower).toEqual({ label: 'Lower', to: null })
    expect(model.number.raise).toEqual({ label: 'Raise to 1', to: 1 })
    expect(model.primary).toEqual({ label: 'Set goal', disabled: true })
    expect(model.submission).toBeNull()
  })

  it('steps follow the grid at 29/30, 99/100, 499/500', () => {
    const at = (text: string) =>
      portalGoalSheetModel(typed(openingDraft(READY, ratings), text), READY).number

    expect(at('29')).toMatchObject({ lower: { to: 28 }, raise: { to: 30 } })
    expect(at('30')).toMatchObject({ lower: { to: 29 }, raise: { to: 35 } })
    expect(at('99')).toMatchObject({ lower: { to: 95 }, raise: { to: 100 } })
    expect(at('100')).toMatchObject({ lower: { to: 95 }, raise: { to: 110 } })
    expect(at('499')).toMatchObject({ lower: { to: 490 }, raise: { to: 500 } })
    expect(at('500')).toMatchObject({ lower: { to: 490 }, raise: { to: 550 } })
    expect(at('1')).toMatchObject({
      lower: { label: 'Lower', to: null },
      raise: { to: 2 },
    })
    // The highest number a goal takes has nothing above it.
    expect(at('1000000')).toMatchObject({
      raise: { label: 'Raise', to: null },
      lower: { to: 999_950 },
    })
  })

  it('never throws on letters, spaces or a huge number', () => {
    const opening = openingDraft(READY, ratings)

    for (const text of [
      'abc',
      '  ',
      '4o',
      '12.5',
      '-3',
      '١٢',
      '99999999999999999999999',
    ]) {
      expect(() => portalGoalSheetModel(typed(opening, text), READY), text).not.toThrow()
      expect(() =>
        changedDraft(typed(opening, text), { kind: 'commit' }, READY),
      ).not.toThrow()
    }
    expect(portalGoalSheetModel(typed(opening, 'abc'), READY).number).toMatchObject({
      value: null,
      invalid: true,
      lower: { to: null },
      raise: { to: 1 },
    })
    expect(portalGoalSheetModel(typed(opening, '  '), READY).number).toMatchObject({
      value: null,
      invalid: false,
    })
    // Above what a goal takes, − comes back down to it.
    expect(
      portalGoalSheetModel(typed(opening, '99999999999999999999999'), READY).number,
    ).toMatchObject({
      value: null,
      invalid: true,
      lower: { label: 'Lower to 1,000,000', to: 1_000_000 },
      raise: { to: null },
    })
    // Spaces and grouping around a number still read as it.
    expect(portalGoalSheetModel(typed(opening, ' 1,200 '), READY).number.value).toBe(1200)
  })

  it('Enter or leaving the box writes the number plainly and keeps what is half-typed', () => {
    const opening = openingDraft(READY, ratings)
    const commit = (text: string) =>
      changedDraft(typed(opening, text), { kind: 'commit' }, READY).text

    expect(commit(' 012 ')).toBe('12')
    expect(commit('1,200')).toBe('1200')
    expect(commit('4o')).toBe('4o')
    expect(commit('')).toBe('')
  })

  it('one rating is singular', () => {
    const model = portalGoalSheetModel(typed(openingDraft(READY, ratings), '1'), READY)

    expect(model.unit).toBe('private rating')
    expect(model.number.valueText).toBe('1 private rating')
  })
})
