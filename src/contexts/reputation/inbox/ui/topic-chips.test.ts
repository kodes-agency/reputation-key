import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { InboxReviewAnalysis } from '#/contexts/inbox/application/public-api'
import { TopicChips } from './topic-chips'

const ANALYSIS: InboxReviewAnalysis = {
  status: 'ready',
  sentiment: 'mixed',
  aspects: [
    { aspect: 'service', polarity: 'negative', intensity: -82 },
    { aspect: 'room', polarity: 'positive', intensity: 68 },
    { aspect: 'room', polarity: 'negative', intensity: -40 },
  ],
  primaryCategory: 'service',
  attention: 'low',
  generatedAtEpochMillis: Date.parse('2026-08-16T12:00:00Z'),
}

const render = (matched: Parameters<typeof TopicChips>[0]['matched']) =>
  renderToStaticMarkup(createElement(TopicChips, { analysis: ANALYSIS, matched }))

/** The chip's own markup, by its words. */
function chip(markup: string, words: string): string {
  const start = markup.indexOf(words)
  const open = markup.lastIndexOf('<span data-slot="badge"', start)
  return markup.slice(open, markup.indexOf('</span></li>', start))
}

describe('TopicChips matched topic', () => {
  it('marks the chip a link followed and says which, in words', () => {
    const markup = render({ aspect: 'room', polarity: 'negative' })

    expect(markup).toContain('Matched: Room, complaint')
    expect(chip(markup, 'Room · Complaint')).toContain('ring-2')
    expect(chip(markup, 'Room · Complaint')).toContain('matches the topic you followed')
    // Only the one that matched: the same topic's praise and another topic are left alone.
    expect(chip(markup, 'Room · Praise')).not.toContain('ring-2')
    expect(chip(markup, 'Service · Complaint')).not.toContain('ring-2')
  })

  it('marks every chip of the topic when the link named no polarity', () => {
    const markup = render({ aspect: 'room', polarity: undefined })

    expect(markup).toContain('Matched: Room')
    expect(markup).not.toContain('Matched: Room,')
    expect(chip(markup, 'Room · Praise')).toContain('ring-2')
    expect(chip(markup, 'Room · Complaint')).toContain('ring-2')
    expect(chip(markup, 'Service · Complaint')).not.toContain('ring-2')
  })

  it('says nothing about a topic this review does not hold', () => {
    const markup = render({ aspect: 'parking', polarity: 'negative' })

    expect(markup).not.toContain('Matched')
    expect(markup).not.toContain('ring-2')
  })

  it('says nothing when the Inbox was not opened on a topic', () => {
    const markup = render(null)

    expect(markup).not.toContain('Matched')
    expect(markup).not.toContain('ring-2')
    expect(markup).toContain('Service · Complaint')
  })
})
