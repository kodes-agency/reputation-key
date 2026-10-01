// What the "Your response" section says went wrong and what went right, and its
// stylesheet (board G07). Rendered to markup, like the section's own tests.

import { describe, expect, it } from 'vitest'
import { PACKS } from './__fixtures__/immersive-response-fixtures'
import {
  render,
  responseChildren,
  sectionOf,
} from './__fixtures__/immersive-response-section-render'
import { IMMERSIVE_RESPONSE_CSS } from './immersive-response-styles'
import type { ImmersiveResponseViewProps } from './immersive-response-view'

describe.each(PACKS)('what went wrong, and what went right [$locale]', (pack) => {
  const open = (overrides: Partial<ImmersiveResponseViewProps>) =>
    render(pack, { kind: 'done', rating: 2 }, { open: true, overrides })

  it.each([
    ['remove-note', 'responseRemoveNoteFailed'],
    ['remove-all', 'responseRemoveAllFailed'],
    ['start-over', 'startOverFailed'],
  ] as const)('shows a failed %s as an alert inside the section only', (failure, key) => {
    const html = open({ failure })
    const children = responseChildren(html)
    expect(sectionOf(html)).toMatch(
      new RegExp(
        `role="alert"[^>]*>(?:<svg[\\s\\S]*?</svg>)?<span>${pack.copy[key]}</span>`,
      ),
    )
    expect(children.slice(0, -1).join('')).not.toContain('role="alert"')
  })

  it('announces a removed note and an updated rating as a status', () => {
    for (const [notice, key] of [
      ['note-removed', 'responseRemoveNoteDone'],
      ['rating-updated', 'ratingUpdated'],
    ] as const) {
      const section = sectionOf(open({ notice }))
      expect(section).toMatch(
        new RegExp(`role="status"[^>]*tabindex="-1"[^>]*>${pack.copy[key]}</p>`, 'u'),
      )
    }
  })

  it('says the page is ready for the next guest above the rating card after Start over', () => {
    const html = render(
      pack,
      { kind: 'arrival' },
      { overrides: { notice: 'started-over' } },
    )
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${pack.copy.startOverDone}</p>`))
    expect(html.indexOf(pack.copy.startOverDone)).toBeLessThan(
      html.indexOf(pack.copy.ratingTitle),
    )
  })

  it('says nothing about notices when there are none', () => {
    const html = open({})
    expect(html).not.toContain(pack.copy.responseRemoveNoteDone)
    expect(html).not.toContain(pack.copy.startOverDone)
  })
})

describe('the section stylesheet', () => {
  it('rides in the response area stylesheet, so the page still hoists one element', () => {
    expect(IMMERSIVE_RESPONSE_CSS).toContain('.ih-yr__toggle')
  })

  it('keeps every control at the 44 px touch target the boards use', () => {
    expect(IMMERSIVE_RESPONSE_CSS).toMatch(/\.ih-yr__toggle\s*\{[^}]*min-height:\s*58px/u)
    expect(IMMERSIVE_RESPONSE_CSS).toMatch(
      /\.ih-yr \.ih-yr__button\s*\{[^}]*min-height:\s*44px/u,
    )
    expect(IMMERSIVE_RESPONSE_CSS).toMatch(
      /\.ih-yr \.ih-yr__start-over\s*\{[^}]*min-height:\s*44px/u,
    )
  })

  it('stops turning the chevron for a guest who asks for reduced motion', () => {
    expect(IMMERSIVE_RESPONSE_CSS).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.ih-yr__chevron\s*\{\s*transition:\s*none/u,
    )
  })
})
