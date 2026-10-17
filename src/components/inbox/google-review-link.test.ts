// Which Google link the Inbox renders, and the sentences it links. The anchors
// are rendered to markup and read back (the unit project has no DOM); the menu
// that holds one is exercised in `inbox-detail-copy-menu.stories.tsx`.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GOOGLE_REVIEW_PRIMARY_SEGMENTS } from '../../../test-fixtures/generated/google-provider-identifiers-v1'
import { GoogleLinkedText } from './google-review-anchor'
import {
  GOOGLE_REVIEW_LINK_COPY,
  googleReviewLink,
  sentenceAroundGoogle,
  type GoogleReviewLink,
} from './google-review-link'
import { REPLY_CHECK_COPY } from './reply-check-feedback'
import { REPLY_STATE_COPY, replyStateDescription } from './reply-state-copy'

// Synthetic only (test-fixtures/google-provider-identifiers-v1.json).
const REVIEW_PAGE = `https://business.google.com/n/${GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId}/reviews/repkey-synthetic-do-not-use-reply-token-0001`
const PROPERTY_PAGE =
  'https://search.google.com/local/reviews?placeid=repkey-synthetic-place-0001'

describe('googleReviewLink', () => {
  it('sends a manager to the review itself when Google gave its page', () => {
    expect(
      googleReviewLink({
        googleReviewUrl: REVIEW_PAGE,
        googlePropertyReviewsUrl: PROPERTY_PAGE,
      }),
    ).toEqual({ kind: 'review', href: REVIEW_PAGE })
  })

  it("falls back to the property's reviews when the review has no page", () => {
    expect(
      googleReviewLink({
        googleReviewUrl: null,
        googlePropertyReviewsUrl: PROPERTY_PAGE,
      }),
    ).toEqual({ kind: 'property', href: PROPERTY_PAGE })
  })

  it('offers nothing when there is neither, or no detail yet', () => {
    expect(
      googleReviewLink({ googleReviewUrl: null, googlePropertyReviewsUrl: null }),
    ).toBeNull()
    expect(googleReviewLink(null)).toBeNull()
    expect(googleReviewLink(undefined)).toBeNull()
  })

  it.each([
    ['a script URL', 'javascript:alert(1)'],
    ['plain http', REVIEW_PAGE.replace('https://', 'http://')],
    ['another host', REVIEW_PAGE.replace('business.google.com', 'evil.example')],
    ['the public host', REVIEW_PAGE.replace('business.google.com', 'search.google.com')],
    ['not a URL', 'not a url'],
  ])('renders no review page that is %s, and falls back', (_case, href) => {
    expect(
      googleReviewLink({
        googleReviewUrl: href,
        googlePropertyReviewsUrl: PROPERTY_PAGE,
      }),
    ).toEqual({ kind: 'property', href: PROPERTY_PAGE })
  })

  it.each([
    ['a script URL', 'javascript:alert(1)'],
    [
      'the merchant host',
      PROPERTY_PAGE.replace('search.google.com', 'business.google.com'),
    ],
    ['plain http', PROPERTY_PAGE.replace('https://', 'http://')],
  ])('renders no property page that is %s', (_case, href) => {
    expect(
      googleReviewLink({ googleReviewUrl: null, googlePropertyReviewsUrl: href }),
    ).toBeNull()
  })
})

describe('the sentences that send a manager to Google', () => {
  const stoppedChecking = replyStateDescription(REPLY_STATE_COPY.ambiguous_stopped)

  it.each([
    ['the description of a reply RepKey stopped checking', stoppedChecking],
    ['the check line for an unreadable reply', REPLY_CHECK_COPY.unreadableStopped],
  ])('%s carries the words that become the link', (_case, sentence) => {
    expect(sentence).not.toBeNull()
    expect(sentenceAroundGoogle(sentence ?? '')?.phrase.toLowerCase()).toBe(
      'look at the review on google',
    )
  })

  it('finds no words to link in a sentence that does not send anyone to Google', () => {
    expect(sentenceAroundGoogle(REPLY_CHECK_COPY.notShowing)).toBeNull()
  })
})

const render = (text: string, link: GoogleReviewLink | null) =>
  renderToStaticMarkup(createElement(GoogleLinkedText, { text, link }))

describe('GoogleLinkedText', () => {
  const sentence = REPLY_CHECK_COPY.unreadableStopped

  it('makes the words a new-tab link that sends Google no referrer', () => {
    const html = render(sentence, { kind: 'review', href: REVIEW_PAGE })

    expect(html).toContain(`href="${REVIEW_PAGE}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('>Look at the review on Google<')
    expect(html).toContain(GOOGLE_REVIEW_LINK_COPY.newTab)
    expect(html.startsWith('Google shows a reply RepKey can&#x27;t read')).toBe(true)
    expect(html.endsWith('</a>.')).toBe(true)
  })

  it("links the property's reviews the same way when that is all there is", () => {
    const html = render(sentence, { kind: 'property', href: PROPERTY_PAGE })

    expect(html).toContain(`href="${PROPERTY_PAGE.replace('&', '&amp;')}"`)
    expect(html).toContain('referrerPolicy="no-referrer"')
  })

  it('leaves the sentence plain text when there is no link', () => {
    expect(render(sentence, null)).toBe(sentence.replaceAll("'", '&#x27;'))
  })

  it('leaves a sentence without the words plain text even with a link', () => {
    expect(
      render('Publishing was cancelled.', { kind: 'review', href: REVIEW_PAGE }),
    ).toBe('Publishing was cancelled.')
  })
})
