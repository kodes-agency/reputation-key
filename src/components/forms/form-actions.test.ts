// FormActions (UI consistency scan: FORM-01, FORM-19, ACT-04).
//
// An explicit-save group had its Save placed, aligned and ordered eight ways, and a
// "Cancel" that was a link to another page and reset nothing. One row now: the actions
// at the end of the group, right-aligned, the primary last; a Reset that appears only
// while the group holds edits and puts back the SAVED values; the refusal of a save
// directly above the buttons. Reset is not a Cancel that navigates, and a settings
// page has no such Cancel.
//
// What is pinned here is the markup (server-rendered, no DOM) and the one TanStack
// Form behaviour Reset leans on: `reset()` returns to the form's latest default
// values, so the values the page last saved. The click, the focus that follows it and
// a save-then-reset round trip run in the Storybook project (form-actions.stories).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormApi, type AnyFormApi } from '@tanstack/react-form'
import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { FormActions, type FormActionsProps } from './form-actions'

const SAVE = createElement('button', { type: 'submit' }, 'Save changes')

function render(props: Omit<FormActionsProps, 'children'>): string {
  return renderToStaticMarkup(
    createElement(FormActions, { ...props, children: SAVE } as FormActionsProps),
  )
}

const manual = (props: Omit<FormActionsProps, 'children' | 'form'> = {}) => render(props)

function dirtyForm() {
  const form = new FormApi({ defaultValues: { name: 'Ada' } })
  form.mount()
  form.setFieldValue('name', 'Grace')
  return form
}

function cleanForm() {
  const form = new FormApi({ defaultValues: { name: 'Ada' } })
  form.mount()
  return form
}

// A bare FormApi has no submit meta; `useForm`'s form, which a group passes, does.
const bound = (form: unknown) => render({ form: form as AnyFormApi })

describe('FormActions row', () => {
  it('sits at the end of the group: right-aligned, wrapping, the primary last', () => {
    const html = manual({ dirty: true, onReset: () => undefined })

    expect(html).toContain('justify-end')
    expect(html).toContain('flex-wrap')
    expect(html.indexOf('>Reset<')).toBeLessThan(html.indexOf('>Save changes<'))
    expect(html.endsWith('Save changes</button></div></div>')).toBe(true)
  })

  it('fills the width it is given, so a CardFooter or the end of a form can hold it', () => {
    const html = manual()

    expect(html).toContain('data-slot="form-actions"')
    expect(html).toContain('w-full')
  })

  it('draws no Reset for a group with nothing to put back', () => {
    expect(manual()).not.toContain('Reset')
    expect(manual({ dirty: true })).not.toContain('Reset')
  })
})

describe('a command of the group', () => {
  it('leads the row while Reset and the primary stay at its end', () => {
    const html = renderToStaticMarkup(
      createElement(FormActions, {
        dirty: true,
        onReset: () => undefined,
        leading: createElement('button', { type: 'button' }, 'Turn off'),
        children: SAVE,
      }),
    )

    expect(html).toContain('mr-auto')
    // On a phone it takes a line of its own, so it never splits Reset from the primary.
    expect(html).toContain('max-sm:basis-full')
    expect(html.indexOf('>Turn off<')).toBeLessThan(html.indexOf('>Reset<'))
    expect(html.indexOf('>Reset<')).toBeLessThan(html.indexOf('>Save changes<'))
  })

  it('adds nothing to a row without one', () => {
    expect(manual()).not.toContain('mr-auto')
  })
})

describe('Reset', () => {
  it('shows only while the group holds edits', () => {
    expect(manual({ dirty: false, onReset: () => undefined })).not.toContain('Reset')
    expect(manual({ dirty: true, onReset: () => undefined })).toContain('>Reset<')
  })

  it('is a button that never submits, in the outline Cancel used to wear', () => {
    const html = manual({ dirty: true, onReset: () => undefined })

    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Reset<\/button>/u)
    expect(html).toContain('data-variant="outline"')
  })

  it('waits while a save is in flight', () => {
    const html = manual({ dirty: true, onReset: () => undefined, pending: true })

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reset<\/button>/u)
  })

  it('is read from the form: absent when clean, present once a field changed', () => {
    expect(bound(cleanForm())).not.toContain('Reset')
    expect(bound(dirtyForm())).toContain('>Reset<')
  })

  it('leaves a group that is not a form to say what it holds', () => {
    expect(manual({ dirty: true, onReset: () => undefined })).toContain('>Reset<')
  })
})

describe('a refused save', () => {
  const refusal = new ServerFunctionError(
    'ValidationError',
    'That name is taken',
    'name_taken',
    409,
  )

  it('is the banner, directly above the buttons and inside the same slot', () => {
    const html = manual({ error: refusal, dirty: true, onReset: () => undefined })

    expect(html).toContain('That name is taken')
    expect(html.indexOf('That name is taken')).toBeLessThan(html.indexOf('>Reset<'))
    expect(html.indexOf('data-slot="form-actions"')).toBeLessThan(
      html.indexOf('That name is taken'),
    )
  })

  it('is nothing when the save has not failed', () => {
    expect(manual({ error: null })).not.toContain('role="alert"')
  })
})

describe('what Reset restores (TanStack Form)', () => {
  it('is the values the form started with', () => {
    const form = dirtyForm()

    form.reset()

    expect(form.state.values.name).toBe('Ada')
    expect(form.state.isDefaultValue).toBe(true)
  })

  it('is the values the page last saved, once the form has been handed them', () => {
    const form = dirtyForm()
    // The field was blurred, as a field is by the time Save is pressed.
    form.setFieldMeta('name', (meta) => ({ ...meta, isTouched: true }))
    // The save went through and the page now holds what was saved: the form is
    // given it as its defaults (a group's component is keyed on the saved values,
    // so it is mounted again with them), and the person edits once more.
    form.update({ defaultValues: { name: 'Grace' } })
    form.setFieldValue('name', 'Hedy')

    form.reset()

    expect(form.state.values.name).toBe('Grace')
    expect(form.state.isDefaultValue).toBe(true)
  })
})
