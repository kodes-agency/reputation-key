// Guest response form — the two precedence rules and the one grammar boundary
// that decide what a guest is told.
//
// The form serves two different acts through one set of fields: a first response
// and the single permitted correction of it. Each rule below is where those two
// acts disagree, so a wrong precedence either offers a guest something a
// correction may not do (touch media) or mislabels the button they are pressing.

import { describe, it, expect } from 'vitest'
import {
  GUEST_RATING_VALUES,
  guestMediaSection,
  guestRatingOptionLabel,
  guestSubmitLabel,
} from './guest-response-labels'

describe('guestSubmitLabel', () => {
  it('reports the in-flight save ahead of which act is being saved', () => {
    // A pressed button that keeps its idle label reads as a no-op and invites a
    // second submit — which, for a correction, is the one the guest cannot make.
    expect(guestSubmitLabel(true, false)).toBe('Saving…')
    expect(guestSubmitLabel(true, true)).toBe('Saving…')
  })

  it('names the single correction distinctly from a first response', () => {
    expect(guestSubmitLabel(false, true)).toBe('Save one correction')
    expect(guestSubmitLabel(false, false)).toBe('Submit response')
  })
})

describe('guestMediaSection', () => {
  it('hides media from a correction whatever the media setting says', () => {
    // A correction may not add or replace media, so the degradation copy
    // ("currently unavailable") would explain an absence it did not cause.
    expect(guestMediaSection(true, true)).toBe('hidden')
    expect(guestMediaSection(true, false)).toBe('hidden')
  })

  it('distinguishes "upload here" from "uploads are off" on a first response', () => {
    expect(guestMediaSection(false, true)).toBe('upload')
    expect(guestMediaSection(false, false)).toBe('unavailable')
  })
})

describe('guestRatingOptionLabel', () => {
  it('gives every offered rating a grammatical accessible name', () => {
    // These are the radio group's only accessible names, so the singular
    // boundary at 1 is the whole rule.
    expect(GUEST_RATING_VALUES.map(guestRatingOptionLabel)).toEqual([
      '1 star',
      '2 stars',
      '3 stars',
      '4 stars',
      '5 stars',
    ])
  })
})
