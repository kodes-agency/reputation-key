// The Inbox queue rail and the phone's queue bar keep their own composition
// (buttons that change a filter, sections down a column, one button and a chip
// across a bar) but share a "you are here" cue, a focus ring and a count with
// every other section nav (UI consistency scan: NAV-05), and the same sections
// (ADR 0057, amended 2026-10-28).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { InboxQueueCounts } from '#/contexts/inbox/application/public-api'
import { InboxQueueBar } from './inbox-queue-bar'
import { InboxQueueRail } from './inbox-queue-rail'
import type { InboxQueueViewer } from './inbox-queue-sections'

const COUNTS: InboxQueueCounts = {
  reply: 12,
  approval: 3,
  waiting: 0,
  feedback: 5,
  escalated: 2,
  mine: 4,
  open: 24,
  replied: null,
  handled: null,
  closed: null,
}

const MANAGER: InboxQueueViewer = {
  canManageReplies: true,
  canReadReviews: true,
  canReadFeedback: true,
}

const noop = () => undefined

/** Text of rendered markup: tags stripped until none is left, spaces collapsed. */
function markupText(html: string, tagGap: string): string {
  let text = html
  let previous: string
  do {
    previous = text
    text = text.replace(/<[^>]*>/gu, tagGap)
  } while (text !== previous)
  return text.replace(/\s+/gu, ' ').trim()
}

const rail = (viewer: InboxQueueViewer = MANAGER) =>
  renderToStaticMarkup(
    createElement(InboxQueueRail, {
      queue: 'reply',
      counts: COUNTS,
      viewer,
      onQueueChange: noop,
      onOpenShortcuts: noop,
    }),
  )

const bar = (queue: 'reply' | 'feedback' | 'mine' = 'reply') =>
  renderToStaticMarkup(
    createElement(InboxQueueBar, {
      queue,
      counts: COUNTS,
      viewer: MANAGER,
      onQueueChange: noop,
    }),
  )

/** The queue buttons of a rendering, without the shortcuts button. */
const queueButtons = (html: string) =>
  [...html.matchAll(/<button [^>]*>[\s\S]*?<\/button>/gu)]
    .map((match) => match[0])
    .filter((button) => !button.includes('Keyboard shortcuts'))

describe('the Inbox queue rail', () => {
  const html = rail()

  it('marks one queue current, and draws it from that attribute', () => {
    const buttons = queueButtons(html)
    const current = buttons.filter((button) => button.includes('aria-current="page"'))

    expect(current).toHaveLength(1)
    expect(markupText(current[0] ?? '', '')).toBe('Needs reply12')
    for (const button of buttons) {
      expect(button).toContain('aria-[current=page]:bg-accent')
    }
  })

  it('draws a count as the shared figure, only when there is one', () => {
    const counted = queueButtons(html).filter((button) => button.includes('tabular-nums'))

    // Waiting is 0 and the closed folders are never counted, so six of the nine
    // queues carry a figure (reply, approval, feedback, escalated, mine, open).
    expect(counted).toHaveLength(6)
    expect(html).toContain('>12<')
    expect(html).not.toContain('>0<')
  })

  it('draws no count on Replied and Handled', () => {
    const names = queueButtons(html).map((button) => markupText(button, ''))

    expect(names).toContain('Replied')
    expect(names).toContain('Handled')
  })

  it('draws the Escalated count in the urgent ink, and no other', () => {
    const urgent = queueButtons(html).filter((button) => button.includes('text-negative'))

    expect(urgent).toHaveLength(1)
    expect(urgent[0]).toContain('Escalated')
  })

  it('titles its two sections as labelled groups inside the one Queues navigation', () => {
    expect(html).toMatch(/<nav aria-label="Queues">/u)
    const groups = [
      ...html.matchAll(
        /<div role="group" aria-labelledby="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gu,
      ),
    ]

    expect(groups.map((group) => markupText(group[2] ?? '', ''))).toEqual([
      'Reviews',
      'Private feedback',
    ])
    for (const [, id] of groups) expect(html).toContain(`id="${id}"`)
  })

  it('puts the shared views below a separator, with no heading of their own', () => {
    const afterFeedback = html.slice(html.indexOf('Handled'))

    expect(afterFeedback).toMatch(/data-slot="separator"/u)
    expect(markupText(afterFeedback, ' ')).toContain('Mine 4 Escalated 2 All open 24')
    expect(afterFeedback.match(/role="group"/gu)).toBeNull()
  })

  it('keeps the Button focus ring, which is the shared one', () => {
    expect(html).toContain('focus-visible:ring-[3px]')
  })

  it('keeps the active fill under the pointer, where the ghost Button would dim it', () => {
    for (const button of queueButtons(html)) {
      expect(button).toContain('aria-[current=page]:hover:bg-accent')
    }
  })

  it('hides a section whose kind the viewer cannot read', () => {
    const reviewsOnly = rail({ ...MANAGER, canReadFeedback: false })

    expect(reviewsOnly).toContain('Reviews')
    expect(reviewsOnly).not.toContain('Private feedback')
    expect(reviewsOnly).not.toContain('All open')
  })

  it('draws the one reply row as Open when reply stages are unavailable', () => {
    const names = queueButtons(rail({ ...MANAGER, canManageReplies: false })).map(
      (button) => markupText(button, ''),
    )

    expect(names).toContain('Open12')
    expect(names.some((name) => name.startsWith('Awaiting approval'))).toBe(false)
  })
})

describe('the Inbox queue bar', () => {
  it('names the queue in view by its label and its count', () => {
    const [button] = queueButtons(bar())

    expect(markupText(button ?? '', ' ')).toBe('Needs reply 12')
    expect(button).toContain('data-inbox-queue-button')
    expect(button).toContain('aria-haspopup="dialog"')
  })

  it('offers the other kind’s open queue as a chip, with its count', () => {
    const [, chip] = queueButtons(bar())

    expect(markupText(chip ?? '', ' ')).toBe('To handle 5')
    expect(
      queueButtons(bar('feedback')).map((button) => markupText(button, ' ')),
    ).toEqual(['To handle 5', 'Needs reply 12'])
  })

  it('offers no chip in a shared view', () => {
    expect(queueButtons(bar('mine'))).toHaveLength(1)
  })

  it('is one 44 px bar on the 16 px gutter', () => {
    expect(bar()).toMatch(/data-inbox-queue-bar[^>]*class="[^"]*\bh-11\b[^"]*\bpx-4\b/u)
  })

  it('has the shared keyboard focus ring on its controls', () => {
    for (const button of queueButtons(bar())) {
      expect(button).toContain('focus-visible:ring-[3px]')
    }
  })
})
