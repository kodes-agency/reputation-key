import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import type { GuestVoiceV2Read } from '#/contexts/ai/application/public-api'
import { GuestVoiceV2Body } from './guest-voice-v2-body'
import {
  HAMPTON_READ,
  CHECK_IN_SMALL_CONCERN,
  CHECK_IN_PROVISIONAL,
  QUIET_READ,
} from './guest-voice-fixtures-check-in'
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))
vi.mock('#/shared/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))
function render(element: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, { router, children: element }),
  )
}
const body = (read: GuestVoiceV2Read, busy = false) =>
  render(
    createElement(GuestVoiceV2Body, {
      propertyId: 'property',
      range: 'auto',
      busy,
      view: {
        read,
        drawer: {
          target: null,
          onTargetChange: () => undefined,
          read: { status: 'pending' },
        },
      },
    }),
  )
describe('H check-in', () => {
  it('answers the four questions in order, with no page quotes or old standalone bands', () => {
    const markup = body(HAMPTON_READ)
    const questions = [
      'Anything urgent?',
      'Are guests happier lately?',
      'What should we fix first?',
      'What are we doing well?',
    ]
    const positions = questions.map((q) => markup.indexOf(q))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(markup).toContain('Yes — two serious concerns')
    expect(markup).not.toContain('data-slot="guest-voice-quote"')
    expect(markup).not.toContain('In short')
    expect(markup).not.toContain('What changed')
    expect(markup).toContain('Copy team summary')
    expect(markup).toContain('Every part of your property')
  })
  it('retains quiet coverage and incomplete uncertainty', () => {
    expect(body(QUIET_READ)).toContain(
      'No serious concerns reported in the last 12 months',
    )
    expect(body(CHECK_IN_PROVISIONAL)).toContain(
      'Changes appear once your reviews are analysed.',
    )
    expect(body(CHECK_IN_PROVISIONAL)).toContain('Not enough reviews to compare yet')
  })
  it('keeps small-state concerns above exactly three previews and the invite', () => {
    const markup = body(CHECK_IN_SMALL_CONCERN)
    expect(markup.indexOf('Anything urgent?')).toBeLessThan(
      markup.indexOf('Not enough reviews to spot patterns yet'),
    )
    expect(markup).toContain('Your latest reviews')
    expect(markup.match(/Open in the inbox<\/a>/gu)).toHaveLength(3)
    expect(markup).toContain('Invite guests to review')
    expect(markup).not.toContain('What should we fix first?')
    expect(markup).not.toContain('See all')
  })
  it('blocks row and clipboard interaction while showing a previous range', () => {
    const markup = body(HAMPTON_READ, true)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('inert=""')
  })
})
