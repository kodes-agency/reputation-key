import { describe, expect, it } from 'vitest'
import { wizardOnArrival } from './rating-goal-arrival'
import {
  CARD,
  CARD_REACHED,
  SETUP,
  SETUP_FEW_REVIEWS,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

const reads = {
  card: null,
  cardFailed: false,
  setup: SETUP,
  setupFailed: false,
  canCreate: true,
} as const

describe('wizardOnArrival', () => {
  it('opens the wizard on a goal to climb to where one can be set', () => {
    expect(wizardOnArrival(reads)).toEqual({ kind: 'open', intent: { kind: 'climb' } })
  })

  it('opens it on keeping the number when nothing higher is in reach', () => {
    expect(wizardOnArrival({ ...reads, setup: SETUP_KEEP_FIRST })).toEqual({
      kind: 'open',
      intent: { kind: 'keep', targetTenths: 50 },
    })
  })

  it('opens it when this read found the last goal reached: there is none now', () => {
    expect(wizardOnArrival({ ...reads, card: CARD_REACHED })).toMatchObject({
      kind: 'open',
    })
  })

  it('waits while the card or the setup is read', () => {
    expect(wizardOnArrival({ ...reads, card: undefined })).toEqual({ kind: 'wait' })
    expect(wizardOnArrival({ ...reads, setup: undefined })).toEqual({ kind: 'wait' })
  })

  it('opens nothing where a goal is active, none can be set, or the viewer may not', () => {
    for (const subject of [
      { ...reads, card: CARD },
      { ...reads, setup: SETUP_FEW_REVIEWS },
      { ...reads, setup: { ...SETUP, hasActiveGoal: true } },
      { ...reads, canCreate: false, card: undefined },
    ]) {
      expect(wizardOnArrival(subject)).toEqual({ kind: 'skip' })
    }
  })

  it('opens nothing when a read failed: the section says so in its own region', () => {
    expect(wizardOnArrival({ ...reads, card: undefined, cardFailed: true })).toEqual({
      kind: 'skip',
    })
    expect(wizardOnArrival({ ...reads, setup: undefined, setupFailed: true })).toEqual({
      kind: 'skip',
    })
  })
})
