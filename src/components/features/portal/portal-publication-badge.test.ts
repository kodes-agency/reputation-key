// Portal list badge rules — the two things the status cell used to compute
// inline: the label and the "is this one filled?" decision.
//
// The `Record` types already make a NEW domain publication state a compile
// error. What they cannot catch is a wrong *value*: a label regressing to the
// raw identifier, or `disabled`/`archived` drifting into the filled variant and
// so reading as live in the list. These tests pin the values.

import { describe, it, expect } from 'vitest'
import {
  PUBLICATION_BADGE_VARIANTS,
  PUBLICATION_LABELS,
  type PublicationState,
} from './portal-publication-badge'

const STATES = Object.keys(PUBLICATION_LABELS) as PublicationState[]

describe('portal publication labels', () => {
  it('labels every state as a human word, never the raw identifier', () => {
    expect(PUBLICATION_LABELS).toEqual({
      draft: 'Draft',
      published: 'Published',
      disabled: 'Disabled',
      archived: 'Archived',
    })
    for (const state of STATES) {
      expect(PUBLICATION_LABELS[state]).not.toBe(state)
    }
  })
})

describe('portal publication badge variants', () => {
  it('fills only the published badge', () => {
    expect(PUBLICATION_BADGE_VARIANTS.published).toBe('default')
    expect(
      STATES.filter((state) => PUBLICATION_BADGE_VARIANTS[state] === 'default'),
    ).toEqual(['published'])
  })

  it('outlines the states that are not publicly available, including the ex-public ones', () => {
    expect(PUBLICATION_BADGE_VARIANTS.draft).toBe('outline')
    expect(PUBLICATION_BADGE_VARIANTS.disabled).toBe('outline')
    expect(PUBLICATION_BADGE_VARIANTS.archived).toBe('outline')
  })

  it('decides a variant for exactly the states it labels', () => {
    expect(Object.keys(PUBLICATION_BADGE_VARIANTS).sort()).toEqual([...STATES].sort())
  })
})
