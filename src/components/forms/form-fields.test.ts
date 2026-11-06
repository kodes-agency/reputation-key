// Shared fields keep their accessible label, help and error contract across
// control kinds. Text reports after touch; a refused number reports immediately.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FormNumberField, type NumberFieldApi } from './form-number-field'
import { blankAsNull, FormTextField, type BaseFieldApi } from './form-text-field'
import { FormTextarea, type BaseFieldApiTextarea } from './form-textarea'
import { FormSelectField } from './form-select-field'

const meta = { isTouched: false, isValid: true, errors: [] }
const invalidMeta = {
  isTouched: true,
  isValid: false,
  errors: [{ message: 'Enter a name' }],
}

const text = (over: Partial<BaseFieldApi['state']> = {}): BaseFieldApi => ({
  name: 'name',
  state: { value: '', meta, ...over },
  handleBlur: () => undefined,
  handleChange: () => undefined,
})

const textarea = (over: Partial<BaseFieldApiTextarea['state']> = {}) => ({
  name: 'note',
  state: { value: '', meta, ...over },
  handleBlur: () => undefined,
  handleChange: () => undefined,
})

const number = (
  errors: Array<{ message?: string } | undefined> = [],
  value = 24,
): NumberFieldApi => ({
  state: { value, meta: { errors } },
  handleBlur: () => undefined,
  handleChange: () => undefined,
})

const textField = (props: object = {}, field = text()) =>
  renderToStaticMarkup(
    createElement(FormTextField, { field, label: 'Name', id: 'name', ...props }),
  )

const textareaField = (props: object = {}, field = textarea()) =>
  renderToStaticMarkup(
    createElement(FormTextarea, { field, label: 'Note', id: 'note', ...props }),
  )

const numberField = (props: object = {}, field = number()) =>
  renderToStaticMarkup(
    createElement(FormNumberField, {
      field,
      label: 'Hours',
      id: 'hours',
      min: 1,
      max: 720,
      ...props,
    }),
  )

const selectField = (props: object = {}) =>
  renderToStaticMarkup(
    createElement(FormSelectField, {
      id: 'metric',
      label: 'Metric',
      value: 'scans',
      options: [{ value: 'scans', label: 'Scans' }],
      onValueChange: () => undefined,
      ...props,
    }),
  )

const FIELDS = [
  { kind: 'text', render: textField, id: 'name', label: 'Name' },
  { kind: 'textarea', render: textareaField, id: 'note', label: 'Note' },
  { kind: 'number', render: numberField, id: 'hours', label: 'Hours' },
  { kind: 'select', render: selectField, id: 'metric', label: 'Metric' },
] as const

describe.each(FIELDS)('the $kind field', ({ kind, render, id, label }) => {
  it('is a Field with a FieldLabel tied to its control', () => {
    const html = render()

    expect(html).toContain('data-slot="field"')
    expect(html).toMatch(
      new RegExp(`<label[^>]*data-slot="field-label"[^>]*for="${id}"`, 'u'),
    )
    expect(html).toContain(`>${label}</label>`)
  })

  it('says nothing about help or optional unless it is given them', () => {
    const html = render()

    expect(html).not.toContain('field-description')
    expect(html).not.toContain('aria-describedby')
    expect(html).not.toContain('Optional')
  })

  it('shows the help under the control and names it as the control description', () => {
    const html = render({ description: 'Shown to guests.' })

    expect(html).toContain(`id="${id}-description"`)
    expect(html).toContain(`aria-describedby="${id}-description"`)
    expect(html).toContain('Shown to guests.')
    const control = html.search(
      kind === 'select' ? /<button[^>]*role="combobox"/u : /<(?:input|textarea)/u,
    )
    expect(control).toBeGreaterThanOrEqual(0)
    expect(control).toBeLessThan(html.indexOf('Shown to guests.'))
  })

  it('marks a field the person may leave empty, inside its label', () => {
    const html = render({ optional: true })

    expect(html).toMatch(new RegExp(`${label} <span[^>]*data-slot="field-optional"`, 'u'))
    expect(html).toContain('>Optional</span></label>')
  })
})

describe('error and help together', () => {
  const props = { description: 'Shown to guests.' }
  it.each([
    ['text', () => textField(props, text({ meta: invalidMeta }))],
    ['textarea', () => textareaField(props, textarea({ meta: invalidMeta }))],
    ['number', () => numberField(props, number(invalidMeta.errors))],
    [
      'select',
      () => selectField({ ...props, invalid: true, errors: invalidMeta.errors }),
    ],
  ] as const)('puts help before the error in a refused %s field', (_kind, render) => {
    const html = render()

    expect(html.indexOf('Shown to guests.')).toBeLessThan(html.indexOf('Enter a name'))
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('data-invalid="true"')
    expect(html).toMatch(/data-slot="field-description"/u)
    expect(html).toMatch(/data-slot="field-error"/u)
  })
})

describe('the error is named by the control', () => {
  // The alert is read once, when it appears. A person who comes back to the field
  // hears why it is refused only if the control names the error as its description.
  it('names the error, after the help, while the field is invalid', () => {
    const html = textField(
      { description: 'Shown to guests.' },
      text({ meta: invalidMeta }),
    )

    expect(html).toMatch(
      /<div[^>]*id="name-error"[^>]*role="alert"|role="alert"[^>]*id="name-error"/u,
    )
    expect(html).toContain('aria-describedby="name-description name-error"')
  })

  it('names only the error when there is no help', () => {
    expect(textareaField({}, textarea({ meta: invalidMeta }))).toContain(
      'aria-describedby="note-error"',
    )
    expect(numberField({}, number([{ message: 'Use 1 to 720 hours' }]))).toContain(
      'aria-describedby="hours-error"',
    )
  })

  it('names no error while the field is valid', () => {
    expect(textField({ description: 'Shown to guests.' })).toContain(
      'aria-describedby="name-description"',
    )
    expect(textField()).not.toContain('name-error')
  })
})

describe('error timing', () => {
  it('waits for the text field to be touched', () => {
    const untouched = text({
      meta: { isTouched: false, isValid: false, errors: [{ message: 'Enter a name' }] },
    })

    expect(textField({}, untouched)).not.toContain('Enter a name')
    expect(textField({}, text({ meta: invalidMeta }))).toContain('Enter a name')
  })

  it('does not wait for the number field: a refused target shows its reason at once', () => {
    expect(numberField({}, number([{ message: 'Use 1 to 720 hours' }]))).toContain(
      'Use 1 to 720 hours',
    )
    expect(numberField()).not.toContain('role="alert"')
  })

  it('names an invalid number field as invalid', () => {
    expect(numberField({}, number([{ message: 'Use 1 to 720 hours' }]))).toContain(
      'aria-invalid="true"',
    )
  })
})

describe('the number field', () => {
  it('shows a cleared control as empty, never as NaN', () => {
    expect(numberField({}, number([], Number.NaN))).toContain('value=""')
  })

  it('takes the width a card gives it', () => {
    expect(numberField({ className: 'max-w-40' })).toContain('max-w-40')
  })

  it('is a whole number unless it is given a step', () => {
    expect(numberField()).not.toContain('step=')
    expect(numberField({ step: 0.1 })).toContain('step="0.1"')
  })

  it('has no upper bound unless it is given one', () => {
    expect(numberField()).toContain('max="720"')
    expect(numberField({ max: undefined })).not.toContain('max=')
  })

  it('keeps its label for a screen reader where a column header already shows it', () => {
    // A row of a table: the header names the column, the label still names the control.
    const html = numberField({ labelClassName: 'sr-only' })

    expect(html).toMatch(/<label[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*for="hours"/u)
    expect(html).toContain('>Hours</label>')
  })

  it('counts in whole numbers unless the field is given a step', () => {
    // A rating average is set to one decimal.
    expect(numberField()).not.toContain('step=')
    expect(numberField({ max: 5, step: 0.1 })).toContain('step="0.1"')
  })

  it('has no upper bound when its value has none', () => {
    // A monthly count: nothing says how many scans are too many.
    const unbounded = numberField({ max: undefined })

    expect(unbounded).toContain('min="1"')
    expect(unbounded).not.toContain('max=')
  })
})

describe('blankAsNull', () => {
  const nullable = (value: string | null) => {
    const changes: Array<string | null> = []
    return {
      changes,
      field: {
        name: 'escalationContact',
        state: { value, meta },
        handleBlur: () => undefined,
        handleChange: (next: string | null) => {
          changes.push(next)
        },
      },
    }
  }

  it('shows an absent value as an empty control', () => {
    expect(blankAsNull(nullable(null).field).state.value).toBe('')
    expect(blankAsNull(nullable('care@example.com').field).state.value).toBe(
      'care@example.com',
    )
  })

  it('makes a cleared control absent again, and keeps any text as it is typed', () => {
    const { field, changes } = nullable('care@example.com')
    const edited = blankAsNull(field)

    edited.handleChange('')
    edited.handleChange('care@')

    expect(changes).toEqual([null, 'care@'])
  })
})
