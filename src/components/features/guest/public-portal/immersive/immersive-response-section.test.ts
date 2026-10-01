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
import { text } from '../__fixtures__/markup-walk'
import { PACKS, RATINGS, DISPLAY_NAME } from './__fixtures__/immersive-response-fixtures'
import {
  accessibleName,
  body,
  buttons,
  render,
  responseChildren,
  sectionOf,
} from './__fixtures__/immersive-response-section-render'
import { immersiveResponseProps } from './immersive-response-preview'
import { ImmersiveResponseView } from './immersive-response-view'

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

  it('is open the same way at every rating, with or without the note offered', () => {
    // The rows legitimately differ by whether a note was sent, so compare within
    // each variant: no rating may change anything the section shows.
    for (const state of [
      (rating: number) => ({ kind: 'rated', rating }) as const,
      (rating: number) => ({ kind: 'done', rating }) as const,
    ]) {
      const sections = RATINGS.map((rating) =>
        sectionOf(render(pack, state(rating), { open: true })),
      )
      expect(new Set(sections).size).toBe(1)
    }
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

  it('says what Google is not touched in a sentence of its own, not joined in code', () => {
    const detail = new RegExp(
      `<p[^>]*class="ih-yr__detail"[^>]*>${pack.copy.responseRemoveAllNote}</p>`,
      'u',
    )
    expect(section).toMatch(detail)
  })

  it('gives every button a name that says what it does and holds its visible text (WCAG 2.5.3)', () => {
    const names = buttons(section).map((button) => accessibleName(section, button))
    // The first button is the section's own toggle; its name is its text.
    const rows = [
      [pack.copy.ratingChange, pack.copy.responseChangeTitle],
      [pack.copy.responseRemoveNoteAction, pack.copy.responseRemoveNoteTitle],
      [pack.copy.responseRemoveAllAction, pack.copy.responseRemoveAllTitle],
    ] as const
    rows.forEach(([visible, title], index) => {
      const name = names[index + 1] ?? ''
      expect(name, `${pack.locale} ${visible}`).toContain(visible)
      expect(name, `${pack.locale} ${visible}`).toContain(title)
    })
    expect(names.at(-1)).toBe(pack.copy.startOverAction)
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
    expect(noNote).toContain(pack.copy.responseRemoveRatingTitle)
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
              correctionDeadline: '2026-01-01T12:01:00.000Z',
              feedbackWithdrawalAvailable: false,
              feedbackWithdrawalDeadline: '2026-01-01T12:01:00.000Z',
              responseWithdrawalAvailable: false,
              responseWithdrawalDeadline: '2026-01-01T12:01:00.000Z',
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

  it('does not say time ran out after a change, while the deadline is still ahead', () => {
    const base = immersiveResponseProps(
      { kind: 'done', rating: 2 },
      { pack, displayName: DISPLAY_NAME },
    )
    const changed = sectionOf(
      body(
        renderToStaticMarkup(
          createElement(ImmersiveResponseView, {
            ...base,
            yourResponse: base.yourResponse && {
              ...base.yourResponse,
              initialOpen: true,
            },
            notice: 'rating-updated',
            // What the server answers after a change.
            response: base.response && {
              ...base.response,
              status: 'corrected',
              correctedAt: '2026-01-01T12:04:00.000Z',
              correctionAvailable: false,
            },
          }),
        ),
      ),
    )
    expect(text(changed)).toContain(pack.copy.ratingUpdated)
    expect(text(changed)).not.toContain(pack.copy.windowEndedChange)
    expect(text(changed)).not.toContain(pack.copy.responseChangeTitle)
    expect(text(changed)).toContain(pack.copy.responseRemoveNoteTitle)
  })

  it('speaks of the rating alone when no note was sent', () => {
    const rated = sectionOf(render(pack, { kind: 'rated', rating: 5 }, { open: true }))
    expect(text(rated)).toContain(pack.copy.responseRemoveRatingTitle)
    expect(text(rated)).not.toContain(pack.copy.responseRemoveAllTitle)
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
