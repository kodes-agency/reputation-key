// How the case toolbar fits the pane it is given, read from its class lists.
//
// The widths are CSS, and the unit project has no layout, so this holds the
// MECHANISM and `e2e/storybook-metrics/inbox-case-toolbar-floor.metrics.ts`
// measures the result. What it pins is the part a refactor could take away
// without a story noticing, because no story compiles Tailwind: the toolbar is
// the `@container`, the Priority control's classes all answer to that container
// and not to the window (a pane 472 px wide in a 1280 px window is not a phone),
// and the owner is the member that gives.
//
// The bug these hold: Priority kept its word and chevron from `md` up, the group
// needed 478 px of a 424 px toolbar, and the status — the only member built to
// give — was squeezed to its dot, so the `inbox-triage` journey could not see
// `Open`.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import type { InboxItem, InboxPriority } from '#/contexts/inbox/application/public-api'
import { InboxCaseToolbar } from './inbox-case-toolbar'

const permissions = vi.hoisted(() => ({ canCommand: true }))

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => permissions.canCommand }),
}))

const noop = () => undefined

const REVIEW: InboxItem = makeInboxItem({ id: 'rev-geometry', sourceType: 'review' })

/** The set level, as a person set it: an Inbox item with Urgent or High on it. */
const withLevel = (level: NonNullable<InboxItem['managerPriority']>): InboxItem => ({
  ...REVIEW,
  managerPriority: level,
  managerPrioritySetBy: 'user-ada' as InboxItem['managerPrioritySetBy'],
  managerPrioritySetAt: new Date('2026-02-01T10:00:00Z'),
})

function render(
  options: Readonly<{
    item?: InboxItem
    suggestion?: InboxPriority | null
    canCommand?: boolean
  }> = {},
): string {
  permissions.canCommand = options.canCommand ?? true
  return renderToStaticMarkup(
    createElement(InboxCaseToolbar, {
      item: options.item ?? REVIEW,
      target: null,
      feedbackHandling: null,
      assignmentOptions: [],
      // Without a viewer the owner has no move to offer, and draws a fact.
      currentUser: { id: 'user-viewer', name: 'Maria Petrova', image: null },
      isPending: false,
      isEscalationActive: false,
      onReopen: noop,
      onAssign: noop,
      onEscalate: noop,
      onResolveEscalation: noop,
      prioritySuggestion: options.suggestion ?? null,
      onSetPriority: noop,
    }),
  )
}

/** An opening tag, whose quoted attributes may hold a `>` (`has-[&gt;svg]` is escaped, but be safe). */
const OPENING = String.raw`(?:"[^"]*"|[^">])*`

/** The classes of the first element whose opening tag matches, as written in the source. */
function classesOf(html: string, tag: RegExp): ReadonlyArray<string> {
  const opening = tag.exec(html)?.[0]
  const classes =
    opening === undefined ? undefined : /\bclass="([^"]*)"/u.exec(opening)?.[1]
  if (classes === undefined) throw new Error(`no ${String(tag)} in ${html}`)
  // Static markup escapes the `>` a class name carries (`has-[>svg]`).
  return classes.replaceAll('&gt;', '>').split(/\s+/u)
}

/** The Priority trigger: the one button named for the level, and everything inside it. */
function priorityTrigger(html: string): string {
  const trigger = new RegExp(
    String.raw`<button\b${OPENING}aria-label="Priority:[^"]*"${OPENING}>[\s\S]*?</button>`,
    'u',
  ).exec(html)?.[0]
  if (trigger === undefined) throw new Error(`no Priority trigger in ${html}`)
  return trigger
}

/** An opening tag, with one attribute (as a whole regex source, quotes included) if given. */
const tag = (name: string, attribute = '') =>
  new RegExp(String.raw`<${name}\b${OPENING}${attribute}${OPENING}>`, 'u')

const CHEVRON = String.raw`class="[^"]*lucide-chevron-down[^"]*"`

/** The span whose text is exactly `text`. */
const spanWith = (html: string, text: string) =>
  classesOf(html, new RegExp(String.raw`<span\b${OPENING}>(?=${text}</span>)`, 'u'))

const SQUARE = [
  '@max-lg:w-(--control-touch)',
  '@max-lg:px-0',
  '@max-lg:has-[>svg]:px-0',
] as const

describe('the case toolbar is the container its members size themselves by', () => {
  it('is an @container, so `@max-lg:` means the toolbar and never the window', () => {
    expect(classesOf(render(), tag('section', 'aria-label="Case status"'))).toContain(
      '@container',
    )
  })
})

describe('the Priority control by the toolbar’s width', () => {
  it('is the glyph square below 32rem when there is no word to keep', () => {
    const trigger = priorityTrigger(render())

    const classes = classesOf(trigger, tag('button'))
    for (const square of SQUARE) expect(classes).toContain(square)
    // The word stays in the DOM for a screen reader, and the chevron goes.
    expect(spanWith(trigger, 'Priority')).toContain('@max-lg:sr-only')
    expect(classesOf(trigger, tag('svg', CHEVRON))).toContain('@max-lg:hidden')
  })

  it.each([
    ['urgent', 'Urgent'],
    ['high', 'High'],
  ] as const)(
    'keeps the word of %s below 32rem, and drops its chevron',
    (level, word) => {
      const trigger = priorityTrigger(render({ item: withLevel(level) }))

      const classes = classesOf(trigger, tag('button'))
      for (const square of SQUARE) expect(classes).not.toContain(square)
      expect(spanWith(trigger, word)).not.toContain('@max-lg:sr-only')
      expect(classesOf(trigger, tag('svg', CHEVRON))).toContain('@max-lg:hidden')
    },
  )

  it('prints `Suggested` only from 32rem, and keeps it for a screen reader', () => {
    const trigger = priorityTrigger(render({ suggestion: 'high' }))

    expect(spanWith(trigger, 'Suggested')).toContain('@max-lg:sr-only')
  })

  it('answers to the toolbar alone, never to the window', () => {
    const triggers = [
      priorityTrigger(render()),
      priorityTrigger(render({ item: withLevel('urgent'), suggestion: 'low' })),
    ]

    for (const trigger of triggers) {
      // The size's own touch minimum (`max-md:min-h-`) is the Button's, not the width's.
      expect(trigger).not.toMatch(/max-(?:sm|md):(?:sr-only|hidden|w-|px-)/u)
    }
  })

  it('is a fact that never shrinks for a viewer without the command', () => {
    const html = render({ item: withLevel('urgent'), canCommand: false })

    // `Urgent` is the signal itself: a fact that gave would print `Urg…`.
    const fact = new RegExp(
      String.raw`<div class="([^"]*)" data-fact="">(?:(?!</div>)[\s\S])*Priority: </span>Urgent</div>`,
      'u',
    ).exec(html)?.[1]
    expect(fact?.split(/\s+/u)).toContain('shrink-0')
  })
})

describe('the owner is the member that gives when the group is too wide', () => {
  it('takes the room that is left from `md`, down to the glyph and the chevron', () => {
    const owner = classesOf(
      render(),
      tag('button', String.raw`aria-label="Assignment:[^"]*"`),
    )

    expect(owner).toContain('md:flex-1')
    expect(owner).toContain('md:min-w-18')
    // Below `md` it is still the fixed 36 px square.
    expect(owner).toContain('max-md:w-(--control-touch)')
  })
})
