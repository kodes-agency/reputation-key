import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { GuestVoiceIssueDetails } from './guest-voice-issue-details'
import { GuestVoiceTopicDetails } from './guest-voice-topic-details'
import { GuestVoiceProvider } from './guest-voice-context'
import { CHECK_IN_INPUT, checkInDetail } from './guest-voice-fixtures-check-in'
import { fixtureId } from './guest-voice-fixtures-build'
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))
function detail(sense: 'complaint' | 'praise' = 'complaint', hidden = false) {
  const result = checkInDetail({
    kind: 'issue',
    issueId: fixtureId('a', sense === 'complaint' ? 1 : 5),
    sense,
  })
  if (result.status !== 'ready' || result.drawer.kind !== 'issue')
    throw new Error('Fixture issue missing')
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(GuestVoiceProvider, {
        value: {
          ...CHECK_IN_INPUT,
          onOpenDetail: () => undefined,
        },
        children: createElement(GuestVoiceIssueDetails, {
          drawer: { ...result.drawer, hidden },
        }),
      }),
    }),
  )
}
describe('live issue detail', () => {
  it('orders the summary, comment comparison, description, concern, words, actions, months and area', () => {
    const markup = detail()
    const order = [
      '9 guests brought it up',
      'These guests',
      'A musty smell in guest rooms.',
      'Linked serious concern',
      'In guests’ own words',
      'Open these reviews in the Inbox',
      'Guests who brought it up, each month',
      'Part of',
    ].map((s) => markup.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(markup).toContain('The underlined sentence is the part we counted.')
    expect(markup).toContain('<mark')
    expect(markup).not.toContain('See all')
  })
  it('links the exact days and polarity, and gives a truthful hidden explanation', () => {
    const markup = detail('praise')
    expect(markup).toContain('polarity=positive')
    expect(markup).toContain('since=2025-10-02')
    expect(markup).toContain('until=2026-10-01')
    expect(markup).toContain('Not right?')
    expect(detail('complaint', true)).toContain(
      'Hidden from ranked lists. Its reviews still count in topics and serious concerns.',
    )
  })
  it('does not put an Inbox link on a topic sheet', () => {
    const result = checkInDetail({ kind: 'topic', topic: 'cleanliness' })
    if (result.status !== 'ready' || result.drawer.kind !== 'topic')
      throw new Error('Missing topic')
    const markup = renderToStaticMarkup(
      createElement(GuestVoiceProvider, {
        value: { ...CHECK_IN_INPUT },
        children: createElement(GuestVoiceTopicDetails, { drawer: result.drawer }),
      }),
    )
    expect(markup).toContain('What guests disliked')
    expect(markup).toContain('their counts do not add up')
    expect(markup).not.toContain('/inbox')
  })
})
