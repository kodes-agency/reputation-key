// The Inbox queue rail and strip keep their own composition (buttons that change a
// filter, a column and a bar of pills) but share a "you are here" cue, a focus ring
// and a count with every other section nav (UI consistency scan: NAV-05).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { InboxQueueCounts } from '#/contexts/inbox/application/public-api'
import { InboxQueueRail } from './inbox-queue-rail'
import { InboxQueueStrip } from './inbox-queue-strip'

const COUNTS: InboxQueueCounts = {
  reply: 12,
  approval: 3,
  waiting: 0,
  feedback: 5,
  escalated: 2,
  mine: 4,
  closed: 118,
  open: 24,
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

const rail = () =>
  renderToStaticMarkup(
    createElement(InboxQueueRail, {
      queue: 'reply',
      counts: COUNTS,
      canManageReplies: true,
      onQueueChange: noop,
      onOpenShortcuts: noop,
    }),
  )

const strip = () =>
  renderToStaticMarkup(
    createElement(InboxQueueStrip, {
      queue: 'reply',
      counts: COUNTS,
      canManageReplies: true,
      onQueueChange: noop,
    }),
  )

/** The queue buttons of a rendering, without the shortcuts button. */
const queueButtons = (html: string) =>
  [...html.matchAll(/<button [^>]*>[\s\S]*?<\/button>/gu)]
    .map((match) => match[0])
    .filter((button) => !button.includes('Keyboard shortcuts'))

describe.each([
  ['rail', rail],
  ['strip', strip],
])('the Inbox queue %s', (_name, render) => {
  const html = render()

  it('marks one queue current, and draws it from that attribute', () => {
    const buttons = queueButtons(html)
    const current = buttons.filter((button) => button.includes('aria-current="page"'))

    expect(current).toHaveLength(1)
    for (const button of buttons) {
      expect(button).toContain('aria-[current=page]:bg-accent')
    }
  })

  it('draws a count as the shared figure, only when there is one', () => {
    const buttons = queueButtons(html)
    const counted = buttons.filter((button) => button.includes('tabular-nums'))

    // Waiting is 0, so seven of the eight queues carry a figure (manager: reply,
    // approval, feedback, escalated, mine, open, closed).
    expect(counted).toHaveLength(7)
    expect(html).toContain('>12<')
    expect(html).not.toContain('>0<')
  })

  it('draws the Escalated count in the urgent ink, and no other', () => {
    const urgent = queueButtons(html).filter((button) => button.includes('text-negative'))

    expect(urgent).toHaveLength(1)
    expect(urgent[0]).toContain('Escalated')
  })
})

describe('the Inbox queue strip', () => {
  it('has the shared keyboard focus ring on every pill', () => {
    for (const button of queueButtons(strip())) {
      expect(button).toContain('focus-ring')
    }
  })

  it('names a pill by its label and its count, as it did when the count was text', () => {
    const names = queueButtons(strip()).map((button) => markupText(button, ''))

    expect(names).toContain('Needs reply 12')
    expect(names).toContain('Waiting for Google')
    expect(names).toContain('Closed 118')
  })
})

describe('the Inbox queue rail', () => {
  it('keeps the Button focus ring, which is the shared one', () => {
    expect(rail()).toContain('focus-visible:ring-[3px]')
  })

  it('keeps the active fill under the pointer, where the ghost Button would dim it', () => {
    for (const button of queueButtons(rail())) {
      expect(button).toContain('aria-[current=page]:hover:bg-accent')
    }
  })
})
