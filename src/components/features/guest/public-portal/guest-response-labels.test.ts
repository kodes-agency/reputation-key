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
  guestDraftBlockReason,
  guestMediaSection,
  guestMediaSelectionMessage,
  guestRatingOptionLabel,
  guestResponseDraft,
  guestResponsePhase,
  guestSubmitLabel,
  type GuestResponseDraft,
} from './guest-response-labels'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

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

// The rules below decide whether a guest's draft may go, and what they open the
// form holding. Each is a place where "not given" and "given, empty" have to stay
// distinguishable, or where consent must be demanded for exactly the optional
// parts the guest actually filled in.

const persisted = (over: Partial<GuestResponseView>): GuestResponseView => ({
  id: 'r1',
  status: 'submitted',
  responseConsent: true,
  textConsent: true,
  rating: 4,
  category: null,
  text: 'Lovely stay',
  mediaConsent: false,
  submittedAt: '2026-02-01T10:00:00Z',
  correctedAt: null,
  correctionDeadline: '2026-02-01T11:00:00Z',
  deletedAt: null,
  ...over,
})

const BLANK: GuestResponseDraft = {
  rating: null,
  text: '',
  responseConsent: false,
  textConsent: false,
  mediaConsent: false,
}

describe('guestResponseDraft', () => {
  it('opens a blank draft when there is no response to open from', () => {
    expect(guestResponseDraft(null)).toEqual(BLANK)
  })

  it('reads content the response never carried as empty, not as null', () => {
    // A withdrawal nulls the content it removed. Seeding the fields from those
    // nulls would put `null` in a text input and re-offer the removed feedback.
    // The consent answers are not content and survive — they are what the guest
    // said, and a correction starts from the answers they already gave.
    expect(
      guestResponseDraft(persisted({ status: 'deleted', rating: null, text: null })),
    ).toEqual({
      rating: null,
      text: '',
      responseConsent: true,
      textConsent: true,
      mediaConsent: false,
    })
  })

  it('carries a persisted response forward so a correction starts from it', () => {
    expect(guestResponseDraft(persisted({ mediaConsent: true }))).toEqual({
      rating: 4,
      text: 'Lovely stay',
      responseConsent: true,
      textConsent: true,
      mediaConsent: true,
    })
  })
})

describe('guestResponsePhase', () => {
  it('treats only a submitted response as correctable, and never both at once', () => {
    expect(guestResponsePhase(persisted({}))).toEqual({
      isCorrecting: true,
      isTerminal: false,
    })
    for (const status of ['corrected', 'deleted'] as const) {
      expect(guestResponsePhase(persisted({ status }))).toEqual({
        isCorrecting: false,
        isTerminal: true,
      })
    }
    expect(guestResponsePhase(null)).toEqual({ isCorrecting: false, isTerminal: false })
  })
})

describe('guestDraftBlockReason', () => {
  it('asks for something to say before asking permission to say it', () => {
    expect(guestDraftBlockReason(BLANK, false)).toBe(
      'Choose a rating or enter feedback before submitting.',
    )
    // Whitespace is not feedback, and must not be sent as though it were.
    expect(guestDraftBlockReason({ ...BLANK, text: '   ' }, false)).toBe(
      'Choose a rating or enter feedback before submitting.',
    )
  })

  it('demands consent for each optional part the guest actually filled in', () => {
    expect(guestDraftBlockReason({ ...BLANK, rating: 4 }, false)).toBe(
      'Choose whether to share the optional rating.',
    )
    expect(guestDraftBlockReason({ ...BLANK, text: 'good' }, false)).toBe(
      'Choose whether to share the optional written feedback.',
    )
    expect(
      guestDraftBlockReason({ ...BLANK, rating: 4, responseConsent: true }, true),
    ).toBe('Choose whether to share the optional image.')
  })

  it('never blocks on consent for a part left empty', () => {
    // An untouched field with no consent is the ordinary case; treating it as a
    // gap made an unanswered checkbox for a field nobody filled unsubmittable.
    expect(
      guestDraftBlockReason({ ...BLANK, rating: 4, responseConsent: true }, false),
    ).toBe(null)
    expect(
      guestDraftBlockReason({ ...BLANK, text: 'good', textConsent: true }, false),
    ).toBe(null)
  })
})

describe('guestMediaSelectionMessage', () => {
  it('shows the rejection while a rejected file is selected', () => {
    expect(guestMediaSelectionMessage(true, '')).toBe(
      'Choose a JPEG, PNG, or WebP image up to 10 MiB.',
    )
  })

  it('clears a stale rejection but leaves an unrelated message standing', () => {
    // Choosing an acceptable image must not swallow a save error the guest still
    // has to act on.
    expect(
      guestMediaSelectionMessage(
        false,
        'Choose a JPEG, PNG, or WebP image up to 10 MiB.',
      ),
    ).toBe('')
    expect(guestMediaSelectionMessage(false, 'The response could not be saved.')).toBe(
      'The response could not be saved.',
    )
  })
})
