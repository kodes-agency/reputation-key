// SubmitButton (UI consistency scan: ACT-05, FORM-18).
//
// It is the Button with a mutation wired to `pending`: the spinner, `aria-busy`,
// the disabled state and the reduced-motion rule live in the Button, not here.
// What this file owns is the wiring: the mutation and the form decide whether
// the button is pending or blocked, and the Button's own props (variant, size,
// pendingLabel) pass straight through.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SubmitButton } from './submit-button'

type Props = Parameters<typeof SubmitButton>[0]

const IDLE = { isPending: false, error: null }
const PENDING = { isPending: true, error: null }

function render(props: Partial<Props> = {}, label = 'Save changes'): string {
  return renderToStaticMarkup(
    createElement(SubmitButton, { mutation: IDLE, children: label, ...props }),
  )
}

describe('SubmitButton', () => {
  it('is a submit button, enabled when idle', () => {
    const html = render()

    expect(html).toContain('type="submit"')
    expect(html).not.toContain('disabled=')
    expect(html).not.toContain('aria-busy=')
  })

  it('is the Button, so a pending mutation draws the Button spinner', () => {
    const html = render({ mutation: PENDING })

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('motion-reduce:animate-none')
    expect(html).toContain('aria-hidden="true"')
  })

  it('keeps its label while pending, and swaps it only when asked to', () => {
    expect(render({ mutation: PENDING })).toContain('>Save changes<')
    expect(render({ mutation: PENDING, pendingLabel: 'Saving…' })).toContain('Saving…')
    expect(render({ pendingLabel: 'Saving…' })).not.toContain('Saving…')
  })

  it('is blocked while the form cannot be submitted, without a spinner', () => {
    const html = render({ form: { state: { canSubmit: false, isSubmitting: false } } })

    expect(html).toContain('disabled=""')
    expect(html).not.toContain('<svg')
  })

  it('is blocked while the form is submitting', () => {
    expect(
      render({ form: { state: { canSubmit: true, isSubmitting: true } } }),
    ).toContain('disabled=""')
  })

  it('stays disabled when the caller disabled it', () => {
    expect(render({ disabled: true })).toContain('disabled=""')
  })

  it.each(['default', 'destructive', 'secondary', 'outline', 'ghost', 'link'] as const)(
    'forwards the %s variant to the Button',
    (variant) => {
      expect(render({ variant })).toContain(`data-variant="${variant}"`)
    },
  )

  it('forwards the size, so a call site never restyles the height', () => {
    expect(render({ size: 'sm' })).toContain('data-size="sm"')
    expect(render()).toContain('data-size="default"')
  })
})
