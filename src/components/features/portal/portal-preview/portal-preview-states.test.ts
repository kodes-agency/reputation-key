import { describe, expect, it } from 'vitest'
import {
  ARRIVAL_STATE,
  previewStateOptions,
  ratedState,
  stateCaption,
  tryAsGuestReducer,
  type PreviewPageState,
} from './portal-preview-states'

describe('ratedState', () => {
  it('offers the private note to a rating at or below the threshold', () => {
    expect(ratedState(3, 3)).toEqual({ phase: 'rated', rating: 3, note: 'offered' })
    expect(ratedState(1, 3)).toEqual({ phase: 'rated', rating: 1, note: 'offered' })
  })

  it('offers no note above the threshold', () => {
    expect(ratedState(4, 3)).toEqual({ phase: 'rated', rating: 4, note: 'none' })
  })
})

describe('previewStateOptions', () => {
  it('shows arrival, a low rating, a high rating and the sent note, as the board does', () => {
    const options = previewStateOptions(3)

    expect(options.map((option) => [option.id, option.label])).toEqual([
      ['arrival', 'Arrival'],
      ['low', 'After 2★'],
      ['high', 'After 5★'],
      ['done', 'Done'],
    ])
    expect(options.map((option) => option.state)).toEqual([
      ARRIVAL_STATE,
      { phase: 'rated', rating: 2, note: 'offered' },
      { phase: 'rated', rating: 5, note: 'none' },
      { phase: 'rated', rating: 2, note: 'sent' },
    ])
  })

  it('uses the highest rating that still offers a note when the threshold is 1', () => {
    expect(previewStateOptions(1).find((option) => option.id === 'low')).toMatchObject({
      label: 'After 1★',
      state: { rating: 1, note: 'offered' },
    })
  })

  it('leaves out the note states when no rating is offered a note', () => {
    expect(previewStateOptions(0).map((option) => option.id)).toEqual(['arrival', 'high'])
  })

  it('names each state in words for a screen reader', () => {
    expect(previewStateOptions(3).map((option) => option.name)).toEqual([
      'Arrival',
      'After a 2 star rating',
      'After a 5 star rating',
      'After the private note is sent',
    ])
  })
})

describe('stateCaption', () => {
  it('reads like the board: version, state, language', () => {
    expect(stateCaption('draft', 'Arrival', 'English')).toBe('Draft · Arrival · English')
    expect(stateCaption('live', 'After 5★', 'Bulgarian')).toBe(
      'Live · After 5★ · Bulgarian',
    )
  })
})

describe('tryAsGuestReducer', () => {
  const threshold = 3
  const step = (
    state: PreviewPageState,
    ...actions: Parameters<typeof tryAsGuestReducer>[1][]
  ) =>
    actions.reduce(
      (current, action) => tryAsGuestReducer(current, action, threshold),
      state,
    )

  it('starts at arrival with nothing chosen', () => {
    expect(ARRIVAL_STATE).toEqual({ phase: 'arrival', selected: null })
  })

  it('remembers the star a guest chose before they send it', () => {
    expect(step(ARRIVAL_STATE, { type: 'choose', rating: 4 })).toEqual({
      phase: 'arrival',
      selected: 4,
    })
  })

  it('moves to the rated page when the rating is sent', () => {
    expect(step(ARRIVAL_STATE, { type: 'choose', rating: 2 }, { type: 'send' })).toEqual({
      phase: 'rated',
      rating: 2,
      note: 'offered',
    })
  })

  it('does nothing when sent with no star chosen', () => {
    expect(step(ARRIVAL_STATE, { type: 'send' })).toEqual(ARRIVAL_STATE)
  })

  it('walks the private note from offered to writing to sent', () => {
    const rated = ratedState(2, threshold)

    expect(step(rated, { type: 'writeNote' })).toMatchObject({ note: 'writing' })
    expect(step(rated, { type: 'writeNote' }, { type: 'sendNote' })).toMatchObject({
      note: 'sent',
    })
  })

  it('ignores the note actions when no note is offered', () => {
    const rated = ratedState(5, threshold)

    expect(step(rated, { type: 'writeNote' })).toEqual(rated)
    expect(step(rated, { type: 'sendNote' })).toEqual(rated)
  })

  it('lets a guest change their rating and start again', () => {
    expect(step(ratedState(2, threshold), { type: 'change' })).toEqual({
      phase: 'arrival',
      selected: 2,
    })
    expect(step(ratedState(2, threshold), { type: 'restart' })).toEqual(ARRIVAL_STATE)
  })
})
