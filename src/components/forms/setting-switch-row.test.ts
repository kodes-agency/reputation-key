// SettingSwitchRow (UI consistency scan: FORM-08).
//
// A boolean setting was drawn five ways (the switch before its text, the label left
// and the switch pushed right, the label then the switch with a gap, a switch and an
// On/Off word in a table cell, and a Checkbox standing in for a switch), and none of
// them said whether it saves at once or waits for the group's Save. One row now: the
// label (and its help) at the start, the switch at the end, and, for a row that saves
// as it is flipped, a visible "Saving…" while the request runs. These checks pin the
// markup (server-rendered, no DOM); the click runs in the Storybook project.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingSwitchRow } from './setting-switch-row'

type Props = Parameters<typeof SettingSwitchRow>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(SettingSwitchRow, {
      id: 'emoji',
      label: 'Allow emoji in rendered templates',
      checked: false,
      commit: 'immediate',
      onCheckedChange: () => undefined,
      ...props,
    } as Props),
  )
}

describe('SettingSwitchRow', () => {
  it('is a switch named by its visible label, the label first and the switch last', () => {
    const html = render()

    expect(html).toContain('data-slot="setting-switch-row"')
    expect(html).toContain('role="switch"')
    expect(html).toMatch(
      /<label[^>]*for="emoji"[^>]*>Allow emoji in rendered templates<\/label>/u,
    )
    expect(html.indexOf('<label')).toBeLessThan(html.indexOf('role="switch"'))
    expect(html).toContain('justify-between')
  })

  it('reflects the checked state', () => {
    expect(render({ checked: true })).toContain('aria-checked="true"')
    expect(render({ checked: false })).toContain('aria-checked="false"')
  })

  it('says whether it saves at once or with the group', () => {
    expect(render({ commit: 'immediate' })).toContain('data-commit="immediate"')
    expect(render({ commit: 'deferred' })).toContain('data-commit="deferred"')
  })

  it('names its help and its note as the switch description', () => {
    const html = render({
      description: 'Adds an emoji to the sign-off.',
      note: 'Always on',
    })

    expect(html).toContain('id="emoji-description"')
    expect(html).toContain('id="emoji-note"')
    expect(html).toContain('aria-describedby="emoji-description emoji-note"')
  })

  it('describes nothing when there is no help and no note', () => {
    expect(render()).not.toContain('aria-describedby')
  })

  it('keeps the visible label inside an accessible name that names more', () => {
    // The notification rows repeat "In-app" and "Email" per category, so the name
    // carries the category and the visible word stays inside it (WCAG 2.5.3).
    const html = render({ label: 'In-app', accessibleName: 'Action needed: In-app' })

    expect(html).toContain('aria-label="Action needed: In-app"')
    expect(html).toContain('>In-app</label>')
  })

  it('is a tap target below the medium breakpoint', () => {
    expect(render()).toContain('max-md:min-h-(--control-touch)')
  })
})

describe('a row that saves as it is flipped', () => {
  it('shows a visible Saving while the request runs, and the switch waits', () => {
    const html = render({ commit: 'immediate', pending: true })

    expect(html).toContain('role="status"')
    expect(html).toContain('Saving…')
    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/u)
  })

  it('shows nothing when no request is running', () => {
    const html = render({ commit: 'immediate', pending: false })

    expect(html).not.toContain('Saving…')
    expect(html).not.toContain('aria-busy="true"')
  })

  it('has no status of its own for a row the group saves', () => {
    // The group's Save carries the pending state; the row only waits for it.
    const html = render({ commit: 'deferred', pending: true })

    expect(html).not.toContain('Saving…')
    expect(html).not.toContain('role="status"')
  })
})

describe('a disabled row', () => {
  it('disables the switch and dims the label with it', () => {
    const html = render({ disabled: true })

    expect(html).toContain('data-disabled="true"')
    expect(html).toMatch(/role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/u)
  })
})

describe('the cell layout', () => {
  const cell = (props: Partial<Props> = {}) =>
    render({
      layout: 'cell',
      label: 'Welcome back template',
      stateWords: ['On', 'Off'],
      checked: true,
      ...props,
    })

  it('keeps the label for the switch but does not draw it', () => {
    const html = cell()

    expect(html).toMatch(
      /<label[^>]*class="[^"]*sr-only[^"]*"[^>]*>Welcome back template/u,
    )
    expect(html).toContain('role="switch"')
  })

  it('says Saving in the place of the state words while a request runs', () => {
    const html = cell({ commit: 'immediate', pending: true })

    expect(html).toContain('Saving…')
    expect(html).not.toContain('>On<')
  })

  it('prints the state in words beside the switch, hidden from a screen reader', () => {
    const on = cell({ checked: true })
    const off = cell({ checked: false })

    expect(on).toMatch(/<span[^>]*aria-hidden="true"[^>]*>On<\/span>/u)
    expect(off).toMatch(/<span[^>]*aria-hidden="true"[^>]*>Off<\/span>/u)
  })
})
