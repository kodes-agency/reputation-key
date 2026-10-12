// InheritedSetting (UI consistency scan: FORM-09).
//
// "Follow the parent, or set my own" was asked with a Checkbox that waits for Save (the
// Property's private-feedback target), a pair of buttons that swap places and save at
// once (a Property's quiet hours), and a "Use my default here" button with a bulk reset
// behind a dialog (the notification rows), each with its own wording and none pointing at
// the setting it follows. One row now: it says what it follows (a link to the owner where
// there is a page for it) and what that is worth, whether this place has its own value,
// and one button to put the inherited value back (or to start a value of its own). These
// checks pin the markup (server-rendered, no DOM); the clicks run in the Storybook project.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InheritedSetting } from './inherited-setting'

type Props = Parameters<typeof InheritedSetting>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(InheritedSetting, {
      source: 'the Organization target',
      value: '24 hours',
      overridden: false,
      commit: 'deferred',
      onInherit: () => undefined,
      onOverride: () => undefined,
      ...props,
    } as Props),
  )
}

describe('InheritedSetting', () => {
  it('says what it follows, and what that is worth, while the value is inherited', () => {
    const html = render()

    expect(html).toContain('data-slot="inherited-setting"')
    expect(html).toContain('data-state="inherited"')
    expect(html).toContain('Follows the Organization target')
    expect(html).toContain('currently 24 hours')
  })

  it('says the value is its own, and what it replaced, once it is overridden', () => {
    const html = render({ overridden: true })

    expect(html).toContain('data-state="overridden"')
    expect(html).toContain('Set here instead of the Organization target')
    expect(html).toContain('(24 hours)')
  })

  it('leaves the worth out when the owner has none to name', () => {
    const html = render({ value: undefined })

    expect(html).toContain('Follows the Organization target.')
    expect(html).not.toContain('currently')
  })

  it('offers Override while the value is inherited', () => {
    const html = render()

    expect(html).toMatch(/<button[^>]*>Override<\/button>/u)
    expect(html).not.toContain('Use inherited value')
  })

  it('offers Use inherited value while it is overridden', () => {
    const html = render({ overridden: true })

    expect(html).toMatch(/<button[^>]*>Use inherited value<\/button>/u)
    expect(html).not.toMatch(/<button[^>]*>Override<\/button>/u)
  })

  it('takes its buttons’ words and names from the place it is used', () => {
    const html = render({
      overridden: true,
      inheritLabel: 'Use my default here',
      inheritAccessibleName: 'Workflow: Use my default here',
    })

    expect(html).toContain('>Use my default here</button>')
    expect(html).toContain('aria-label="Workflow: Use my default here"')
  })

  it('has no Override where editing the value is what overrides it', () => {
    const html = render({ onOverride: undefined })

    expect(html).not.toContain('<button')
  })

  it('names the source as a link where the owner has a page', () => {
    const html = render({
      source: createElement(
        'a',
        { href: '/settings/organization' },
        'Organization settings',
      ),
    })

    expect(html).toContain(
      'Follows <a href="/settings/organization">Organization settings</a>',
    )
  })

  it('gives an extra note the id the place names it by', () => {
    const html = render({ note: 'A new property gets email off.', noteId: 'wf-note' })

    expect(html).toContain('id="wf-note"')
    expect(html).toContain('A new property gets email off.')
  })

  it('puts the extra commands of the row before the one that undoes the override', () => {
    const html = render({
      overridden: true,
      children: createElement('button', { type: 'button' }, 'Make this my default'),
    })

    expect(html.indexOf('Make this my default')).toBeLessThan(
      html.indexOf('Use inherited value'),
    )
  })
})

describe('the commit mode', () => {
  it('is on the row, so a story or a test can tell the two apart', () => {
    expect(render({ commit: 'immediate' })).toContain('data-commit="immediate"')
    expect(render({ commit: 'deferred' })).toContain('data-commit="deferred"')
  })

  it('shows a busy button while an immediate row saves', () => {
    const html = render({ commit: 'immediate', overridden: true, pending: true })

    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/<button[^>]*disabled=""/u)
  })

  it('has no busy button for a row the group saves', () => {
    const html = render({ commit: 'deferred', overridden: true, pending: true })

    expect(html).not.toContain('aria-busy="true"')
  })

  it('disables its buttons when the place cannot be edited', () => {
    const html = render({ disabled: true })

    expect(html).toMatch(/<button[^>]*disabled=""/u)
  })
})
