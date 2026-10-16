import { describe, expect, it } from 'vitest'
import { likelyText, spanText, whenText } from './rating-goal-setup-time'

const days = (num: number, den = 1) => ({ num, den })

describe('how long a goal takes, in words', () => {
  it.each([
    [days(1), 'about 1 day'],
    [days(1, 2), 'about 1 day'],
    [days(13), 'about 13 days'],
    [days(14), 'about 2 weeks'],
    [days(40), 'about 6 weeks'],
    [days(36), 'about 5 weeks'],
    [days(70), 'about 2 months'],
    [days(81), 'about 3 months'],
    [days(110), 'about 4 months'],
    [days(178), 'about 6 months'],
    [days(282), 'about 9 months'],
    [days(349), 'about 11 months'],
    [days(350), 'about a year'],
    [days(600), 'about 2 years'],
    [days(1095), 'about 3 years'],
    [days(1096), 'more than 3 years'],
  ])('reads %o as %s', (span, words) => {
    expect(spanText(span)).toBe(words)
  })

  it('says when, or that it is more than three years away', () => {
    expect(whenText(days(81))).toBe('in about 3 months')
    expect(whenText(days(2000))).toBe('more than 3 years away')
  })

  it('decides on the exact fraction, never a rounded float (6 weeks is 42 days)', () => {
    expect(spanText(days(69_999, 1000))).toBe('about 10 weeks')
    expect(spanText(days(70_000, 1000))).toBe('about 2 months')
  })
})

describe('the likely range, in words', () => {
  it.each([
    // The four approved ranges.
    [days(462_000, 7700), days(721_000, 6300), '9 weeks to 4 months'],
    [days(26.4 * 10, 10), days(744, 10), '4 weeks to 2 months'],
    [days(782, 10), days(1711, 10), '3–6 months'],
    [days(234, 10), days(667, 10), '3–10 weeks'],
  ])('reads %o to %o as %s', (fast, slow, words) => {
    expect(likelyText({ fast, slow })).toBe(words)
  })

  it('reads days when even the slow end is under two weeks', () => {
    expect(likelyText({ fast: days(3), slow: days(9) })).toBe('3–9 days')
  })

  it('collapses equal ends', () => {
    expect(likelyText({ fast: days(20), slow: days(22) })).toBe('3 weeks')
  })

  it('runs to over a year when the slow end is that far', () => {
    expect(likelyText({ fast: days(100), slow: days(400) })).toBe(
      '3 months to over a year',
    )
  })

  it('leaves the slow end open when 0.1★ less never gets there', () => {
    expect(likelyText({ fast: days(91), slow: null })).toBe('3 months or more')
    expect(likelyText({ fast: days(2000), slow: null })).toBe('more than 3 years')
  })
})
