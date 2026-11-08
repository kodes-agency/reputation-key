import { describe, expect, it } from 'vitest'
import { quoteSegments } from './guest-voice-quote-segments'

const joined = (segments: ReturnType<typeof quoteSegments>) =>
  segments.map((segment) => segment.text).join('')

const marked = (segments: ReturnType<typeof quoteSegments>) =>
  segments.filter((segment) => segment.highlighted).map((segment) => segment.text)

/** Sentences of a made-up review, long enough to be cut. */
const FILLER = 'The lobby was quiet and the porter carried our bags up without a fuss.'
const CITED = "The air conditioning didn't work for two nights."
const LONG = [FILLER, FILLER, FILLER, CITED, FILLER, FILLER, FILLER].join(' ')

describe('quoteSegments', () => {
  it('underlines a cited sentence and keeps the text around it', () => {
    const text = "The room was lovely. The air conditioning didn't work. Nobody came."
    const start = text.indexOf('The air')
    const end = text.indexOf(' Nobody')

    const segments = quoteSegments(text, [{ start, end }])

    expect(segments).toEqual([
      { text: 'The room was lovely. ', highlighted: false },
      { text: "The air conditioning didn't work.", highlighted: true },
      { text: ' Nobody came.', highlighted: false },
    ])
  })

  it('quotes a review with nothing cited as plain text', () => {
    expect(quoteSegments('Breakfast was fine.', [])).toEqual([
      { text: 'Breakfast was fine.', highlighted: false },
    ])
  })

  it('keeps a quote whole when it is the cited sentence', () => {
    expect(quoteSegments('Great stay.', [{ start: 0, end: 11 }])).toEqual([
      { text: 'Great stay.', highlighted: true },
    ])
  })

  it('clamps a range that runs past the text and drops an empty or reversed one', () => {
    const segments = quoteSegments('Short review.', [
      { start: 6, end: 400 },
      { start: 3, end: 3 },
      { start: 9, end: 2 },
    ])

    expect(segments).toEqual([
      { text: 'Short ', highlighted: false },
      { text: 'review.', highlighted: true },
    ])
  })

  it('joins ranges that overlap or touch, in whatever order they arrive', () => {
    const segments = quoteSegments('abcdefghij', [
      { start: 5, end: 8 },
      { start: 2, end: 5 },
      { start: 7, end: 9 },
    ])

    expect(marked(segments)).toEqual(['cdefghi'])
    expect(joined(segments)).toBe('abcdefghij')
  })

  describe('a long review', () => {
    const start = LONG.indexOf(CITED)
    const range = { start, end: start + CITED.length }

    it('is cut to the cited sentence and its context, with an ellipsis each side', () => {
      const segments = quoteSegments(LONG, [range])
      const text = joined(segments)

      expect(LONG.length).toBeGreaterThan(280)
      expect(marked(segments)).toEqual([CITED])
      expect(text.startsWith('… ')).toBe(true)
      expect(text.endsWith(' …')).toBe(true)
      expect(text.length).toBeLessThan(LONG.length)
    })

    it('cuts only between words', () => {
      const segments = quoteSegments(LONG, [range])
      const body = joined(segments).replace(/^… /u, '').replace(/ …$/u, '')

      expect(LONG).toContain(body)
      expect(body.startsWith(' ')).toBe(false)
      expect(body.endsWith(' ')).toBe(false)
      // The first and last words are whole words of the review.
      const words = new Set(LONG.split(/\s+/u))
      expect(words.has(body.split(/\s+/u)[0] ?? '')).toBe(true)
      expect(words.has(body.split(/\s+/u).at(-1) ?? '')).toBe(true)
    })

    it('has no leading ellipsis when the cited sentence opens the review', () => {
      const text = `${CITED} ${[FILLER, FILLER, FILLER, FILLER, FILLER, FILLER].join(' ')}`
      const segments = quoteSegments(text, [{ start: 0, end: CITED.length }])

      expect(joined(segments).startsWith('… ')).toBe(false)
      expect(marked(segments)).toEqual([CITED])
      expect(joined(segments).endsWith(' …')).toBe(true)
    })

    it('shows the beginning when nothing is cited', () => {
      const segments = quoteSegments(LONG, [])

      expect(marked(segments)).toEqual([])
      expect(joined(segments).startsWith('The lobby')).toBe(true)
      expect(joined(segments).endsWith(' …')).toBe(true)
    })

    it('marks the gap once between two cited sentences that are far apart', () => {
      const other = 'Nobody answered the phone at the desk.'
      const text = [CITED, FILLER, FILLER, FILLER, FILLER, FILLER, FILLER, other].join(
        ' ',
      )
      const second = text.indexOf(other)
      const segments = quoteSegments(text, [
        { start: 0, end: CITED.length },
        { start: second, end: second + other.length },
      ])

      expect(marked(segments)).toEqual([CITED, other])
      expect(joined(segments).match(/…/gu)?.length).toBe(1)
    })

    it('leaves a cited stretch longer than the limit cut at a word', () => {
      const long = 'plenty '.repeat(120).trim()
      const segments = quoteSegments(long, [{ start: 0, end: long.length }])
      const [only] = marked(segments)

      expect(long).toContain(only ?? '')
      expect((only ?? '').length).toBeLessThanOrEqual(360)
      expect(only?.endsWith('plenty')).toBe(true)
    })
  })
})
