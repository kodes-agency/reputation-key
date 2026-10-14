import { describe, expect, it } from 'vitest'
import { googleGoalCell } from './property-list-goal'

describe('googleGoalCell', () => {
  it('names an active goal’s target and the status it last stored', () => {
    // Act
    const cell = googleGoalCell(
      { kind: 'set', mode: 'climb', target: 4.5, status: 'on_pace' },
      true,
    )

    // Assert
    expect(cell).toEqual({ kind: 'goal', text: '4.5 · On pace' })
  })

  it('names a goal that keeps a number the same way', () => {
    expect(
      googleGoalCell(
        { kind: 'set', mode: 'keep', target: 4.3, status: 'holding' },
        false,
      ),
    ).toEqual({ kind: 'goal', text: '4.3 · Holding' })
  })

  it('names the target alone while no status is stored yet', () => {
    expect(
      googleGoalCell({ kind: 'set', mode: 'climb', target: 4.4, status: null }, true),
    ).toEqual({ kind: 'goal', text: '4.4' })
  })

  it('offers "Set goal" where a goal is offered and the viewer may set one', () => {
    expect(googleGoalCell({ kind: 'none', offered: true }, true)).toEqual({ kind: 'set' })
  })

  it('shows a dash where no goal is offered, or the viewer may not set one', () => {
    expect(googleGoalCell({ kind: 'none', offered: false }, true)).toEqual({
      kind: 'none',
    })
    expect(googleGoalCell({ kind: 'none', offered: true }, false)).toEqual({
      kind: 'none',
    })
  })

  it('shows a dash while goals are not read for this reader', () => {
    expect(googleGoalCell(null, true)).toEqual({ kind: 'none' })
  })
})
