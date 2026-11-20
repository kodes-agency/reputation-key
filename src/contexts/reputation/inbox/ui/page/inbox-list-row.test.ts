// The Inbox row as rendered: which fill it wears and how its signals print.
// `inbox-list-row-tone.test.ts` measures the fills and inks; this holds the row
// to them, so an urgent row that lost its tint, or an open urgent row whose
// tint beat the open fill, fails here rather than only in a screenshot.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { InboxListRow } from './inbox-list-row'
import { URGENT_ROW_TINT } from './inbox-list-row-tone'

const OPEN_FILL = 'bg-accent'

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1' as InboxItem['id'],
    organizationId: 'org-1' as InboxItem['organizationId'],
    propertyId: 'prop-1' as InboxItem['propertyId'],
    sourceType: 'review',
    sourceId: 'review-1' as InboxItem['sourceId'],
    status: 'open',
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    rating: 2,
    sourceDate: new Date('2026-01-01T10:00:00Z'),
    platform: 'google',
    snippet: 'The room was not ready.',
    contentAvailability: 'text',
    assignedTo: null,
    reviewerName: 'Guest One',
    propertyName: 'Example Property',
    attention: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  }
}

const URGENT = { attention: 'urgent' } as const

function renderRow(
  item: InboxItem,
  state: Readonly<{
    isActive?: boolean
    isChecked?: boolean
    selectionMode?: boolean
  }> = {},
): string {
  return renderToStaticMarkup(
    createElement(InboxListRow, {
      item,
      isActive: state.isActive ?? false,
      isChecked: state.isChecked ?? false,
      selectionAtLimit: false,
      selectionMode: state.selectionMode ?? false,
      allProperties: false,
      assignmentOptions: [],
      viewedUpTo: null,
      onToggleSelect: () => undefined,
      onOpen: () => undefined,
    }),
  )
}

/** The classes on the row element itself, one utility each. */
function rowClasses(html: string): ReadonlyArray<string> {
  const tag = /<div\b[^>]*\bdata-inbox-list-row\b[^>]*>/.exec(html)?.[0]
  const classes = tag === undefined ? undefined : /\bclass="([^"]*)"/.exec(tag)?.[1]
  if (classes === undefined) throw new Error(`no row element in ${html}`)
  return classes.split(/\s+/)
}

/** The signal label that reads exactly `text`, with its classes and its icon. */
function signalLabel(html: string, text: string) {
  // The icon is matched up to its own closing tag only, so the label is never
  // read from an earlier span that holds another icon (the rating's star).
  const icon = '<svg\\b[^>]*>(?:(?!</svg>).)*</svg>'
  const match = new RegExp(`<span class="([^"]*)">(${icon})?${text} ·</span>`).exec(html)
  if (match === null) throw new Error(`no "${text} ·" label in ${html}`)
  return { classes: match[1]!.split(/\s+/), icon: match[2] ?? null }
}

describe('the row fill', () => {
  it('tints an urgent row at rest, and only its own fill', () => {
    const classes = rowClasses(renderRow(makeItem(URGENT)))

    expect(classes).toContain(URGENT_ROW_TINT)
    expect(classes).not.toContain(OPEN_FILL)
  })

  it.each([
    ['open', { isActive: true }],
    ['checked', { isChecked: true, selectionMode: true }],
    ['open and checked', { isActive: true, isChecked: true, selectionMode: true }],
  ] as const)('gives an %s urgent row the open fill, not the tint', (_state, state) => {
    const classes = rowClasses(renderRow(makeItem(URGENT), state))

    expect(classes).toContain(OPEN_FILL)
    expect(classes).not.toContain(URGENT_ROW_TINT)
  })

  it('keeps the tint on an unchecked urgent row while selecting', () => {
    const classes = rowClasses(renderRow(makeItem(URGENT), { selectionMode: true }))

    expect(classes).toContain(URGENT_ROW_TINT)
    expect(classes).not.toContain(OPEN_FILL)
  })

  it.each([
    ['a plain row', makeItem()],
    ['an escalated row that is not urgent', makeItem({ isEscalated: true })],
    ['a high-attention row', makeItem({ attention: 'high' })],
  ])('leaves %s on the page', (_name, item) => {
    const classes = rowClasses(renderRow(item))

    expect(classes).not.toContain(URGENT_ROW_TINT)
    expect(classes).not.toContain(OPEN_FILL)
  })
})

describe('the row signals', () => {
  it('prints Urgent in the text-grade red with the hidden alert icon', () => {
    const html = renderRow(makeItem(URGENT))
    const label = signalLabel(html, 'Urgent')

    expect(label.classes).toContain('text-negative')
    expect(label.icon).toContain('lucide-circle-alert')
    expect(label.icon).toContain('aria-hidden="true"')
    expect(html).toContain('aria-label="Open review from Guest One, Urgent"')
  })

  it('keeps the red Flag on Escalated beside the urgent label', () => {
    const html = renderRow(makeItem({ ...URGENT, isEscalated: true }))

    expect(signalLabel(html, 'Escalated').icon).toContain('lucide-flag')
    expect(signalLabel(html, 'Urgent').icon).toContain('lucide-circle-alert')
  })

  it('keeps the red label on an open urgent row', () => {
    const html = renderRow(makeItem(URGENT), { isActive: true })

    expect(signalLabel(html, 'Urgent').classes).toContain('text-negative')
  })
})

// A `text-<colour>/<alpha>` utility, behind any variant. Spelled in pieces:
// Tailwind scans tests, and a whole class here would ship its rule.
const TRANSLUCENT_INK = new RegExp(`(?<![\\w-])${['text', '[\\w-]+/\\d+'].join('-')}`)

describe('the fallback copy', () => {
  // The contrast test measures opaque inks only. The fallback copy used to be
  // dimmed to 70%, which read under 4.5:1 on every fill in both themes.
  it('is caught when it is translucent', () => {
    const dimmed = ['text', 'muted', 'foreground/70'].join('-')
    expect(TRANSLUCENT_INK.test(`<span class="${dimmed}">`)).toBe(true)
    expect(TRANSLUCENT_INK.test(`<span class="hover:${dimmed}">`)).toBe(true)
    expect(TRANSLUCENT_INK.test('<span class="text-muted-foreground">')).toBe(false)
  })

  it.each([
    [
      'a plain row',
      makeItem({ snippet: null, contentAvailability: 'rating_only' }),
      'Rating only — the guest left no text',
    ],
    [
      'an urgent row',
      makeItem({ ...URGENT, snippet: null, contentAvailability: 'unavailable' }),
      'Content unavailable',
    ],
  ])('prints in the summary ink on %s, never a translucent one', (_name, item, copy) => {
    const html = renderRow(item)

    expect(html).toContain(copy)
    expect(html).not.toMatch(TRANSLUCENT_INK)
  })
})

describe('the kind of the row', () => {
  const feedback = (overrides: Partial<InboxItem> = {}) =>
    makeItem({
      sourceType: 'feedback',
      reviewerName: null,
      platform: null,
      ...overrides,
    })

  /** The row's first line: its badge, rating and name. */
  const firstLine = (html: string) => {
    const start = html.indexOf('<span data-inbox-row-identity')
    return html.slice(start, html.indexOf('</span></span>', start))
  }

  it('marks private feedback "Private" with the locked message, before the rating', () => {
    const line = firstLine(renderRow(feedback()))

    expect(line).toContain('lucide-message-square-lock')
    expect(line).toContain('Private')
    expect(line.indexOf('Private')).toBeLessThan(line.indexOf('lucide-star'))
  })

  it('marks private feedback with no rating too, in place of the old chat glyph', () => {
    const line = firstLine(renderRow(feedback({ rating: null })))

    expect(line).toContain('Private')
    expect(line).not.toContain('lucide-star')
    expect(line).not.toContain('lucide-message-square-text')
  })

  it('leaves a Review with the rating star alone', () => {
    const html = renderRow(makeItem())

    expect(html).not.toContain('Private')
    expect(html).not.toContain('lucide-message-square-lock')
    expect(html).toContain('lucide-star')
  })

  it('keeps the row’s spoken name as it was: the badge is a mark, not the name', () => {
    expect(renderRow(feedback())).toContain(
      'aria-label="Open feedback from Guest feedback"',
    )
  })
})

describe('the row follows the effective priority (ADR 0071)', () => {
  it('prints High in the page ink with the three-bar glyph, and wears no tint', () => {
    const html = renderRow(makeItem({ attention: 'high' }))
    const label = signalLabel(html, 'High')

    expect(label.classes).toContain('text-foreground')
    expect(label.icon).toContain('data-priority-glyph="high"')
    expect(label.icon).toContain('aria-hidden="true"')
    expect(rowClasses(html)).not.toContain(URGENT_ROW_TINT)
    expect(html).toContain('aria-label="Open review from Guest One, High"')
  })

  it('takes the red off a review the AI calls Urgent when a manager set Low', () => {
    const html = renderRow(makeItem({ ...URGENT, managerPriority: 'low' }))

    expect(rowClasses(html)).not.toContain(URGENT_ROW_TINT)
    expect(html).not.toContain('Urgent ·')
    expect(html).toContain('aria-label="Open review from Guest One"')
  })

  it('tints private feedback a manager set to Urgent, which the AI never reads', () => {
    const html = renderRow(
      makeItem({ sourceType: 'feedback', managerPriority: 'urgent', rating: null }),
    )

    expect(rowClasses(html)).toContain(URGENT_ROW_TINT)
    expect(signalLabel(html, 'Urgent').classes).toContain('text-negative')
  })
})
