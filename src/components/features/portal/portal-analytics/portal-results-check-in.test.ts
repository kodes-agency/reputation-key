import { describe, expect, it } from 'vitest'
import { portalResultsCheckIn } from './portal-results-check-in'
import { portalResultsQuietLines } from './portal-results-quiet-lines'
import {
  RESULTS_HEALTHY as data,
  resultsCount,
  resultsEvidence,
} from './portal-results-stories-data'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
const place = {
  propertyId: 'p',
  portalId: 'q',
  isLive: true,
  scansCounted: true,
  canOpenInbox: true,
}
const read = (patch: Partial<PortalAnalyticsData> = {}) =>
  portalResultsCheckIn({ ...data, ...patch }, place)
const kpis = data.kpis

describe('Are guests using it?', () => {
  it.each([
    [1, '1 guest scanned the code'],
    [3, '3 guests scanned the code'],
    [9, '9 guests scanned the code'],
    [10, 'Yes, 10 guests scanned the code'],
    [412, 'Yes, 412 guests scanned the code'],
  ])('%i scans', (n, answer) =>
    expect(read({ kpis: { ...kpis, scans: resultsCount(n, null) } }).using.answer).toBe(
      answer,
    ),
  )
  it.each([
    [443, '31 more than the 30 days before'],
    [400, '12 fewer than the 30 days before'],
    [412, 'The same as the 30 days before'],
  ])('compares %i', (n, hint) =>
    expect(read({ kpis: { ...kpis, scans: resultsCount(n, 412) } }).using.hint).toBe(
      hint,
    ),
  )
  it('does not compare a missing prior figure', () =>
    expect(
      read({ kpis: { ...kpis, scans: resultsCount(3, null) } }).using.hint,
    ).toBeNull())
  it('uses the day before for a single day', () =>
    expect(
      read({ localDays: { ...data.localDays!, start: '2026-09-30', end: '2026-09-30' } })
        .using.hint,
    ).toBe('31 more than the day before'))
  it('names an all-NFC code', () =>
    expect(
      read({
        kpis: { ...kpis, scans: resultsCount(1, null) },
        scanPatterns: { channels: { qr: 0, nfc: 1 }, busiest: null },
      }).using.answer,
    ).toBe('1 guest tapped the NFC tag'))
  it.each([
    [0, 'neutral'],
    [5, 'warn'],
  ])('zero scans after %i prior scans', (prior, tone) =>
    expect(
      read({
        kpis: {
          ...kpis,
          ratings: resultsCount(0, 0),
          feedback: resultsCount(0, 0),
          googleOpens: resultsCount(0, 0),
          scans: resultsCount(0, prior),
        },
      }).using,
    ).toMatchObject({ answer: 'No guests scanned in these days', tone }),
  )
  it('does not call an uncounted code zero', () =>
    expect(
      portalResultsCheckIn(data, { ...place, scansCounted: false }).using,
    ).toMatchObject({
      answer: 'We can’t count scans on this code',
      tone: 'warn',
      lines: [
        'This code is older than scan counting. Replace it on Share (it needs reprinting).',
      ],
    }))
  it('keeps an updating figure unknown', () =>
    expect(
      read({ kpis: { ...kpis, scans: { ...kpis.scans, value: null } } }).using.answer,
    ).toBe('Scans are updating'))
  it('explains why All Time has no chart', () =>
    expect(read({ localDays: null }).using.lines).toEqual([
      'All time shows the total. Choose a range to see days and weeks.',
    ]))
})
describe('Are they happy?', () => {
  it.each([
    [1, '1 guest rated their visit'],
    [3, '3 guests rated their visit'],
  ])('withholds the average for %i', (count, answer) => {
    const happy = read({
      kpis: {
        ...kpis,
        ratings: resultsCount(count, null),
        avgRating: {
          ...kpis.avgRating,
          value: null,
          evidence: resultsEvidence({ availabilityReason: 'below_minimum_sample' }),
        },
      },
    }).happy
    expect(happy.answer).toBe(answer)
    expect(happy.lines).toEqual([
      'An average shows from 5 ratings, so it can’t give one guest’s rating away.',
    ])
    expect(happy.answer).not.toContain('★')
  })
  it.each([
    [4.5, 'Yes', 'positive'],
    [4.4, 'Mostly', 'positive'],
    [4, 'Mostly', 'positive'],
    [3, 'Mixed', 'warn'],
    [2.9, 'Not really', 'negative'],
  ])('verdict at %i', (average, word, tone) =>
    expect(
      read({ kpis: { ...kpis, avgRating: { ...kpis.avgRating, value: average } } }).happy,
    ).toMatchObject({ answer: `${word}. ${average.toFixed(1)}★ from 118 ratings`, tone }),
  )
  it.each([
    [0.1, 'Up 0.1 from the 30 days before'],
    [-0.2, 'Down 0.2 from the 30 days before'],
    [0, 'About the same as the 30 days before'],
    [null, null],
  ])('comparison %s', (comparison, hint) =>
    expect(
      read({ kpis: { ...kpis, avgRating: { ...kpis.avgRating, comparison } } }).happy
        .hint,
    ).toBe(hint),
  )
  it('keeps notes independent from low ratings', () => {
    expect(read().happy.lines).toEqual([
      '100 guests gave 4 or 5★.',
      '18 gave 3★ or less.',
    ])
    expect(read().notes).toBe('9 guests left a private note')
    expect(read({ kpis: { ...kpis, feedback: resultsCount(1, null) } }).notes).toBe(
      '1 guest left a private note',
    )
    expect(
      read({ kpis: { ...kpis, feedback: { ...kpis.feedback, value: null } } }).notes,
    ).toBeNull()
  })
  it('zero ratings', () =>
    expect(read({ kpis: { ...kpis, ratings: resultsCount(0, 0) } }).happy).toMatchObject({
      answer: 'No guest rated in these days',
      lines: ['Guests rate on your page after they scan.'],
    }))
  it('updating ratings', () =>
    expect(
      read({ kpis: { ...kpis, ratings: { ...kpis.ratings, value: null } } }).happy.answer,
    ).toBe('Ratings are updating'))
})
describe('Are they going on to Google?', () => {
  it.each([
    [0, 'No guest went on to Google'],
    [1, '1 guest went on to Google'],
    [64, '64 guests went on to Google'],
    [null, 'Google opens are updating'],
  ])('%s opens', (value, answer) =>
    expect(
      read({ kpis: { ...kpis, googleOpens: { ...kpis.googleOpens, value } } }).google
        .answer,
    ).toBe(answer),
  )
  it.each([
    [118, 64, 'That’s 54% of the guests who rated.'],
    [3, 1, '1 of the 3 guests who rated.'],
    [20, 10, 'That’s 50% of the guests who rated.'],
  ])('%i ratings and %i opens', (ratings, opens, line) =>
    expect(
      read({
        kpis: { ...kpis, googleOpens: resultsCount(opens, null) },
        engagementFunnel: { qualifiedScans: 200, ratings, googleOpens: opens },
      }).google.lines,
    ).toEqual([line, 'We can’t see whether they posted a review.']),
  )
  it('never shows a share over 100%', () =>
    expect(
      read({ engagementFunnel: { qualifiedScans: 200, ratings: 3, googleOpens: 64 } })
        .google.lines,
    ).toEqual(['We can’t see whether they posted a review.']))
  it('uses the scan comparison wording', () =>
    expect(read().google.hint).toBe('4 more than the 30 days before'))
})
describe('What else do they tap?', () => {
  it('can be absent', () => expect(read({ linkTaps: null }).links).toBeNull())
  it.each([
    [0, 0, 'No taps yet'],
    [1, 1, '1 tap on your links'],
    [4, 4, '4 taps on your links'],
    [5, 3, 'Mostly Menu'],
    [6, 3, 'Mostly Menu'],
    [169, 40, '169 taps on your links'],
  ])('%i taps, %i on top', (total, taps, answer) =>
    expect(
      read({
        linkTaps: {
          total,
          countedSince: '2026-11-01',
          removedTaps: 0,
          rows: [{ linkId: 'menu', label: 'Menu', iconKey: null, taps }],
        },
      }).links?.answer,
    ).toBe(answer),
  )
  it('says when counting began', () =>
    expect(read().links?.hint).toBe('Counted from 1 Nov'))
})
it.each([
  [1, 'The 1 scan came from the QR code.'],
  [2, 'Both scans came from the QR code.'],
  [3, 'All 3 scans came from the QR code.'],
])('says where %i scans from one code came from', (qr, channel) => {
  const patterns = { channels: { qr, nfc: 0 }, busiest: null }
  expect(portalResultsQuietLines({ ...data, scanPatterns: patterns }, true).channel).toBe(
    channel,
  )
})
it('says three quiet observations in plain English', () =>
  expect(portalResultsQuietLines(data, true)).toEqual({
    channel: '380 scans came from the QR code and 32 from the NFC tag.',
    language:
      'Guests who rated read the page mostly in English (58%), then Bulgarian (24%).',
    busiest: 'Busiest around 12–2 pm and 7–9 pm, and on Saturdays.',
  }))
