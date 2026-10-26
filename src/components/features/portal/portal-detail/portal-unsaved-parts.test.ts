import { describe, expect, it } from 'vitest'
import { describeUnsaved, unsavedPartName } from './portal-unsaved-parts'

const none = { failed: [], invalid: [], explicit: [] } as const

describe('unsavedPartName', () => {
  it('names a field in the words of its label', () => {
    expect(unsavedPartName('welcome')).toBe('the portal’s name')
    expect(unsavedPartName('responsible-managers')).toBe('the responsible managers')
  })

  it('names the language of a per-language field', () => {
    expect(unsavedPartName('override-bg')).toBe(
      'this portal’s welcome line and link preview in Bulgarian',
    )
    expect(unsavedPartName('content-en')).toBe('the property wording in English')
  })

  // A portal's own look has keys of its own, so the prompt never says "the
  // property look" for an edit that was only about one portal.
  it('names a portal’s own look apart from the property’s', () => {
    expect(unsavedPartName('portal-look-colours')).toBe('this portal’s colours')
    expect(unsavedPartName('portal-look-wordmark')).toBe('this portal’s wordmark')
    expect(unsavedPartName('portal-photo-focal')).toBe('this portal’s photo focus point')
    expect(unsavedPartName('look')).toBe('the property look')
    expect(unsavedPartName('photo-focal')).toBe('the photo’s focus point')
  })

  it('names a link without its id', () => {
    expect(unsavedPartName('link-texts:7f3c')).toBe('a Linktree link’s words')
  })

  it('leaves out a key it cannot name', () => {
    expect(unsavedPartName('something-new')).toBeNull()
  })
})

describe('describeUnsaved', () => {
  it('offers a retry when every cause is a write that failed', () => {
    expect(describeUnsaved({ ...none, failed: ['override-bg'] })).toEqual({
      line: 'Not saved: this portal’s welcome line and link preview in Bulgarian.',
      retryable: true,
    })
  })

  it('offers no retry when a field refused its value or a Save is waiting', () => {
    expect(
      describeUnsaved({ ...none, failed: ['welcome'], invalid: ['private-note'] }),
    ).toEqual({
      line: 'Not saved: the portal’s name and the private note setting.',
      retryable: false,
    })
    expect(
      describeUnsaved({ ...none, explicit: ['responsible-managers'] }).retryable,
    ).toBe(false)
  })

  it('lists three or more with commas, each once', () => {
    expect(
      describeUnsaved({
        failed: ['welcome', 'link-texts:a', 'link-texts:b'],
        invalid: [],
        explicit: ['content-bg'],
      }).line,
    ).toBe(
      'Not saved: the portal’s name, a Linktree link’s words and the property wording in Bulgarian.',
    )
  })

  it('says nothing about keys it cannot name', () => {
    expect(describeUnsaved({ ...none, failed: ['mystery'] })).toEqual({
      line: null,
      retryable: true,
    })
  })
})
