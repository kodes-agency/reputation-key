// The "Your response" section of the Immersive Hub (board G07), rendered to
// markup and read back. The unit project has no DOM, so what a click or a key
// does (opening, the confirmation step, focus) is held by the stories' play
// functions; what is pinned here is what a guest is shown and in what order.
//
// ADR 0044, anti-gating: the section sits after the Google card and says the
// same at every rating, so it can never become a way to treat ratings apart.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GuestPagePreviewState } from '../guest-page-preview-state'
import { directChildren, text } from '../__fixtures__/markup-walk'
import { PACKS, RATINGS, DISPLAY_NAME } from './__fixtures__/immersive-response-fixtures'
import { immersiveResponseProps } from './immersive-response-preview'
import { IMMERSIVE_RESPONSE_CSS } from './immersive-response-styles'
import {
  ImmersiveResponseView,
  type ImmersiveResponseViewProps,
} from './immersive-response-view'

const body = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')
const responseChildren = (html: string) => directChildren(html, 'data-ih-response')

type PackOf = (typeof PACKS)[number]

function render(
  pack: PackOf,
  state: GuestPagePreviewState,
  options: Readonly<{
    open?: boolean
    overrides?: Partial<ImmersiveResponseViewProps>
  }> = {},
): string {
  const base = immersiveResponseProps(state, { pack, displayName: DISPLAY_NAME })
  const yourResponse = base.yourResponse && {
    ...base.yourResponse,
    initialOpen: options.open ?? false,
  }
  return body(
    renderToStaticMarkup(
      createElement(ImmersiveResponseView, {
        ...base,
        yourResponse,
        ...options.overrides,
      }),
    ),
  )
}

/** The section: the last card of the response area. */
const sectionOf = (html: string) => responseChildren(html).at(-1) ?? ''
const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gu)].map((match) => match[0])

describe.each(PACKS)('the section, collapsed [$locale] (boards G04, G05)', (pack) => {
  const html = render(pack, { kind: 'rated', rating: 2 })
  const section = sectionOf(html)

  it('comes after the Google card and the note card, as the last card', () => {
    const children = responseChildren(html)
    const at = (title: string) => children.findIndex((child) => child.includes(title))
    expect(at(pack.copy.googleTitle)).toBe(1)
    expect(at(pack.copy.noteOfferTitle)).toBe(2)
    expect(at(pack.copy.responseTitle)).toBe(3)
    expect(children).toHaveLength(4)
  })

  it('is one button naming the section and what it holds, closed', () => {
    expect(section).toMatch(/<h2[^>]*><button[^>]*aria-expanded="false"/u)
    expect(text(section)).toBe(`${pack.copy.responseTitle} ${pack.copy.responseSummary}`)
  })

  it('shows no row, no deadline and no confirmation until it is opened', () => {
    expect(buttons(section)).toHaveLength(1)
    expect(section).not.toContain(pack.copy.responseChangeTitle)
    expect(section).not.toContain(pack.copy.responseRemoveAllConfirmTitle)
    expect(section).not.toMatch(/aria-controls/u)
  })

  it('is identical at every rating, with or without the note offered', () => {
    const sections = RATINGS.flatMap((rating) => [
      sectionOf(render(pack, { kind: 'rated', rating, noteEligible: true })),
      sectionOf(render(pack, { kind: 'rated', rating, noteEligible: false })),
    ])
    expect(new Set(sections).size).toBe(1)
  })

  it('drops Change from the receipt once the time to change the rating has ended', () => {
    const base = immersiveResponseProps(
      { kind: 'rated', rating: 2 },
      { pack, displayName: DISPLAY_NAME },
    )
    const ended = body(
      renderToStaticMarkup(
        createElement(ImmersiveResponseView, {
          ...base,
          response: base.response && { ...base.response, correctionAvailable: false },
        }),
      ),
    )
    expect(responseChildren(ended)[0]).not.toContain(`>${pack.copy.ratingChange}<`)
    expect(responseChildren(html)[0]).toContain(`>${pack.copy.ratingChange}<`)
  })

  it('is left out when the page gives it no actions, with Change in the receipt', () => {
    const bare = render(
      pack,
      { kind: 'rated', rating: 5 },
      {
        overrides: { yourResponse: undefined },
      },
    )
    expect(bare).not.toContain(pack.copy.responseTitle)
    expect(responseChildren(bare)[0]).not.toContain(`>${pack.copy.ratingChange}<`)
  })
})

describe.each(PACKS)('the section, open [$locale] (board G07)', (pack) => {
  const html = render(pack, { kind: 'done', rating: 2 }, { open: true })
  const section = sectionOf(html)

  it('opens on its own region, which the button controls', () => {
    const controls = /<button[^>]*aria-expanded="true"[^>]*aria-controls="([^"]+)"/u.exec(
      section,
    )?.[1]
    expect(controls).toBeTruthy()
    expect(section).toContain(`id="${controls}"`)
  })

  it('lists change, remove note and remove all, then the shared-device start over', () => {
    const t = text(section)
    const order = [
      pack.copy.responseChangeTitle,
      pack.copy.responseRemoveNoteTitle,
      pack.copy.responseRemoveAllTitle,
      pack.copy.sharedDeviceTitle,
    ].map((title) => t.indexOf(title))
    expect(order.every((index) => index > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(t).toContain(pack.copy.sharedDeviceBody)
  })

  it('words the deadlines in the portal zone', () => {
    expect(text(section)).toContain(
      pack.locale === 'bg'
        ? 'До 15:00 днес, местно време в София'
        : 'Until 15:00 today, Sofia time',
    )
    expect(text(section)).toContain(
      pack.locale === 'bg'
        ? 'До 14:00 утре, местно време в София'
        : 'Until 14:00 tomorrow, Sofia time',
    )
    expect(text(section)).toContain(pack.copy.responseRemoveAllNote)
  })

  it('gives every button a name that says what it does', () => {
    const names = buttons(section).map(
      (button) => /aria-label="([^"]*)"/u.exec(button)?.[1] ?? text(button),
    )
    // The first button is the section's own toggle; its name is its text.
    expect(names.slice(1)).toEqual([
      pack.copy.responseChangeTitle,
      pack.copy.responseRemoveNoteTitle,
      pack.copy.responseRemoveAllTitle,
      pack.copy.startOverAction,
    ])
  })

  it('shows each action as a native button of its own, never a link', () => {
    for (const button of buttons(section)) expect(button).toContain('type="button"')
    expect(section).not.toContain('<a ')
  })

  it('does not show the confirmation until Remove… is pressed', () => {
    expect(section).not.toContain(pack.copy.responseRemoveAllConfirmTitle)
    expect(section).not.toContain(pack.copy.responseRemoveAllConfirm)
  })

  it('leaves out the note row when no note was sent', () => {
    const noNote = sectionOf(render(pack, { kind: 'rated', rating: 5 }, { open: true }))
    expect(noNote).not.toContain(pack.copy.responseRemoveNoteTitle)
    expect(noNote).toContain(pack.copy.responseChangeTitle)
    expect(noNote).toContain(pack.copy.responseRemoveAllTitle)
  })

  it('says when time has ended, without a button for that row', () => {
    const base = immersiveResponseProps(
      { kind: 'done', rating: 2 },
      { pack, displayName: DISPLAY_NAME },
    )
    const ended = sectionOf(
      body(
        renderToStaticMarkup(
          createElement(ImmersiveResponseView, {
            ...base,
            yourResponse: base.yourResponse && {
              ...base.yourResponse,
              initialOpen: true,
            },
            response: base.response && {
              ...base.response,
              correctionAvailable: false,
              feedbackWithdrawalAvailable: false,
              responseWithdrawalAvailable: false,
            },
          }),
        ),
      ),
    )
    expect(text(ended)).toContain(pack.copy.windowEndedChange)
    expect(text(ended)).toContain(pack.copy.windowEndedNote)
    expect(text(ended)).toContain(pack.copy.windowEndedAll)
    // Only the section's own button and Start over remain.
    expect(buttons(ended)).toHaveLength(2)
  })

  it('disables every action while a call is on its way', () => {
    const pending = sectionOf(
      render(
        pack,
        { kind: 'done', rating: 2 },
        { open: true, overrides: { pending: true } },
      ),
    )
    const actions = buttons(pending).slice(1)
    expect(actions).toHaveLength(4)
    for (const button of actions) expect(button).toMatch(/\sdisabled(?=[\s=>])/u)
  })

  it('reads the same in every process time zone (React #418)', () => {
    const original = process.env.TZ
    try {
      const printed = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'].map((zone) => {
        process.env.TZ = zone
        return render(pack, { kind: 'done', rating: 2 }, { open: true })
      })
      expect(new Set(printed).size).toBe(1)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})

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
