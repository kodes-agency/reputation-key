// Portal settings publication rules — the three decisions the settings section
// used to make with nested ternaries. The `Record` types make a NEW domain state
// a compile error; these tests pin the values, which the types cannot: a state
// telling the manager guests can reach a page they cannot, a toggle that
// publishes when it should disable, or an archived portal growing a toggle.

import { describe, expect, it } from 'vitest'
import {
  PUBLICATION_DESCRIPTIONS,
  PUBLICATION_TOGGLES,
  saveStatusMessage,
} from './portal-settings-rules'
import type { PortalPublicationState } from '../shared/types'

const STATES = Object.keys(PUBLICATION_DESCRIPTIONS) as PortalPublicationState[]

describe('PUBLICATION_DESCRIPTIONS', () => {
  it('promises guest access for exactly one state', () => {
    const reachable = STATES.filter((s) =>
      /guests with the link can open/i.test(PUBLICATION_DESCRIPTIONS[s]),
    )
    expect(reachable).toEqual(['published'])
  })

  it('explains archival as retained rather than as unpublished', () => {
    // Archived and disabled are both unreachable, but only one of them is
    // terminal — the manager needs to know which.
    expect(PUBLICATION_DESCRIPTIONS.archived).toMatch(/configuration and history/i)
    expect(PUBLICATION_DESCRIPTIONS.archived).not.toBe(PUBLICATION_DESCRIPTIONS.disabled)
  })

  it('gives draft and disabled the same next action', () => {
    expect(PUBLICATION_DESCRIPTIONS.draft).toBe(PUBLICATION_DESCRIPTIONS.disabled)
    expect(PUBLICATION_DESCRIPTIONS.draft).toMatch(/until you publish it/i)
  })
})

describe('PUBLICATION_TOGGLES', () => {
  it('offers no toggle at all for an archived portal', () => {
    expect(PUBLICATION_TOGGLES.archived).toBeNull()
  })

  it('turns access off from published, and on from anywhere else', () => {
    expect(PUBLICATION_TOGGLES.published?.nextState).toBe('disabled')
    expect(PUBLICATION_TOGGLES.draft?.nextState).toBe('published')
    expect(PUBLICATION_TOGGLES.disabled?.nextState).toBe('published')
  })

  it('never offers a transition into the state it is already in', () => {
    for (const state of STATES) {
      expect(PUBLICATION_TOGGLES[state]?.nextState).not.toBe(state)
    }
  })

  it('reserves the primary button for the action that grants access', () => {
    // Taking a live page away must not read as the obvious thing to do here.
    expect(PUBLICATION_TOGGLES.published?.variant).toBe('outline')
    expect(PUBLICATION_TOGGLES.draft?.variant).toBe('default')
    expect(PUBLICATION_TOGGLES.disabled?.variant).toBe('default')
  })

  it('labels each toggle by its effect, not by the current state', () => {
    expect(PUBLICATION_TOGGLES.published?.label).toBe('Disable public page')
    expect(PUBLICATION_TOGGLES.draft?.label).toBe('Publish portal')
    expect(PUBLICATION_TOGGLES.disabled?.label).toBe('Publish portal')
  })
})

describe('saveStatusMessage', () => {
  it('prefers the in-flight save over the previous success', () => {
    expect(saveStatusMessage(true, true)).toBe('Saving portal settings')
    expect(saveStatusMessage(true, false)).toBe('Saving portal settings')
  })

  it('announces a settled save', () => {
    expect(saveStatusMessage(false, true)).toBe('Portal settings saved')
  })

  it('stays silent until there is something to announce', () => {
    expect(saveStatusMessage(false, false)).toBe('')
  })
})
