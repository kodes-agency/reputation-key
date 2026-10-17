import { describe, expect, it } from 'vitest'
import { GOOGLE_REVIEW_PRIMARY_SEGMENTS } from '../../../test-fixtures/generated/google-provider-identifiers-v1'
import {
  googleReviewsPageForDestination,
  MAX_GOOGLE_REVIEW_REPLY_URL_LENGTH,
  normalizeGoogleReviewReplyUrl,
} from './google-review-links'

// Synthetic only: the location is the catalogue's, the token says what it is.
const LOCATION_ID = GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId
const TOKEN = 'repkey-synthetic-do-not-use-reply-token_0001'
const PREFIX = `https://business.google.com/n/${LOCATION_ID}/reviews/`
const REPLY_URL = `${PREFIX}${TOKEN}`

describe('normalizeGoogleReviewReplyUrl', () => {
  it('keeps the Business Profile page of a review at its own location', () => {
    expect(normalizeGoogleReviewReplyUrl(REPLY_URL, LOCATION_ID)).toBe(REPLY_URL)
  })

  it('keeps a token of the longest accepted length', () => {
    const url = `${PREFIX}${'A'.repeat(512)}`
    expect(normalizeGoogleReviewReplyUrl(url, LOCATION_ID)).toBe(url)
  })

  it.each([
    ['an empty value', ''],
    ['http', REPLY_URL.replace('https://', 'http://')],
    ['another scheme', REPLY_URL.replace('https://', 'ftp://')],
    ['no scheme', REPLY_URL.replace('https://', '//')],
    ['another host', REPLY_URL.replace('business.google.com', 'evil.example')],
    [
      'a host that only starts with the Google one',
      REPLY_URL.replace('business.google.com', 'business.google.com.evil.example'),
    ],
    ['a subdomain', REPLY_URL.replace('business.google.com', 'www.business.google.com')],
    [
      'an upper-case host',
      REPLY_URL.replace('business.google.com', 'BUSINESS.GOOGLE.COM'),
    ],
    [
      'an explicit port',
      REPLY_URL.replace('business.google.com', 'business.google.com:443'),
    ],
    ['userinfo', REPLY_URL.replace('https://', 'https://user:password@')],
    ['a user name alone', REPLY_URL.replace('https://', 'https://user@')],
    ['a query', `${REPLY_URL}?hl=en`],
    ['an empty query', `${REPLY_URL}?`],
    ['a fragment', `${REPLY_URL}#reply`],
    ['a trailing slash', `${REPLY_URL}/`],
    ['an extra path segment', `${REPLY_URL}/edit`],
    ['no token', PREFIX],
    ['a percent-encoded token', `${PREFIX}abc%2Fdef`],
    ['a token with a dot', `${PREFIX}abc.def`],
    ['a token with a space', `${PREFIX}abc def`],
    ['a non-ASCII token', `${PREFIX}abcé`],
    ['a token longer than 512', `${PREFIX}${'A'.repeat(513)}`],
    ['a line feed', `${REPLY_URL}\n`],
    ['a carriage return', `${PREFIX}abc\rdef`],
    ['a tab', `${PREFIX}abc\tdef`],
    ['a NUL', `${PREFIX}abc\u0000def`],
    ['a DEL', `${PREFIX}abc\u007fdef`],
    ['leading whitespace', ` ${REPLY_URL}`],
    ['a path that is not /n/', REPLY_URL.replace('/n/', '/m/')],
    [
      'the review listing of the location',
      `https://business.google.com/n/${LOCATION_ID}/reviews`,
    ],
    ['a dot segment', REPLY_URL.replace('/reviews/', '/reviews/../')],
    ['a backslash', REPLY_URL.replace('/reviews/', '\\reviews\\')],
    ['another location', REPLY_URL.replace(LOCATION_ID, `${LOCATION_ID}9`)],
    [
      'the location only as a prefix',
      REPLY_URL.replace(`/${LOCATION_ID}/`, `/${LOCATION_ID}0/`),
    ],
  ])('rejects %s', (_case, value) => {
    expect(normalizeGoogleReviewReplyUrl(value, LOCATION_ID)).toBeNull()
  })

  it('rejects a value longer than 2,048 characters', () => {
    const value = `${REPLY_URL}${'A'.repeat(MAX_GOOGLE_REVIEW_REPLY_URL_LENGTH)}`
    expect(value.length).toBeGreaterThan(MAX_GOOGLE_REVIEW_REPLY_URL_LENGTH)
    expect(normalizeGoogleReviewReplyUrl(value, LOCATION_ID)).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['with a slash', `${LOCATION_ID}/reviews/x`],
    ['with a query character', `${LOCATION_ID}?`],
    ['a dot segment', '..'],
    ['starting with a hyphen', '-123'],
    ['longer than a provider segment', '1'.repeat(256)],
  ])('rejects every value when the expected location is %s', (_case, location) => {
    const value = `https://business.google.com/n/${location}/reviews/${TOKEN}`
    expect(normalizeGoogleReviewReplyUrl(value, location)).toBeNull()
  })
})

describe('googleReviewsPageForDestination', () => {
  it('turns the write-a-review page into the public reviews page of the same place', () => {
    expect(
      googleReviewsPageForDestination(
        'https://search.google.com/local/writereview?placeid=repkey-synthetic_place-0001',
      ),
    ).toBe('https://search.google.com/local/reviews?placeid=repkey-synthetic_place-0001')
  })

  it('keeps only the place id of a destination that carries other parameters', () => {
    expect(
      googleReviewsPageForDestination(
        'https://search.google.com/local/writereview?hl=en&placeid=place-0001#top',
      ),
    ).toBe('https://search.google.com/local/reviews?placeid=place-0001')
  })

  it.each([
    ['not a URL', 'not-a-url'],
    ['http', 'http://search.google.com/local/writereview?placeid=place-0001'],
    [
      'another Google host',
      'https://www.google.com/local/writereview?placeid=place-0001',
    ],
    ['a short link', 'https://g.page/r/place-0001/review'],
    ['another path', 'https://search.google.com/local/reviews?placeid=place-0001'],
    ['userinfo', 'https://user@search.google.com/local/writereview?placeid=place-0001'],
    ['no place id', 'https://search.google.com/local/writereview'],
    ['an empty place id', 'https://search.google.com/local/writereview?placeid='],
    [
      'two place ids',
      'https://search.google.com/local/writereview?placeid=place-0001&placeid=place-0002',
    ],
    [
      'a place id with a slash',
      'https://search.google.com/local/writereview?placeid=a%2Fb',
    ],
    [
      'a place id with a space',
      'https://search.google.com/local/writereview?placeid=a+b',
    ],
    [
      'a place id longer than 512',
      `https://search.google.com/local/writereview?placeid=${'A'.repeat(513)}`,
    ],
  ])('offers no page for %s', (_case, destination) => {
    expect(googleReviewsPageForDestination(destination)).toBeNull()
  })
})
