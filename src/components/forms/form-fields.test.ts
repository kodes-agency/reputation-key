// The shared text, textarea and number fields (UI consistency scan: FORM-05).
//
// Eleven files rebuilt "label, control, error" by hand because the shared field had no
// help line and no optional marker. The three shared fields now take the same two
// props, wire the help to the control by id, and share one anatomy (Field, FieldLabel,
// control, help, then the error). Error timing stays what each documents: the text
// and textarea fields report after the field has been touched, the number field as
// soon as the schema names a fault (a refused target must show its reason).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FormNumberField, type NumberFieldApi } from './form-number-field'
import { blankAsNull, FormTextField, type BaseFieldApi } from './form-text-field'
import { FormTextarea, type BaseFieldApiTextarea } from './form-textarea'

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

const FIELDS = [
  { kind: 'text', render: textField, id: 'name', label: 'Name' },
  { kind: 'textarea', render: textareaField, id: 'note', label: 'Note' },
  { kind: 'number', render: numberField, id: 'hours', label: 'Hours' },
] as const

describe.each(FIELDS)('the $kind field', ({ render, id, label }) => {
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
    expect(html.search(/<(?:input|textarea)/u)).toBeLessThan(
      html.indexOf('Shown to guests.'),
    )
  })

  it('marks a field the person may leave empty, inside its label', () => {
    const html = render({ optional: true })

    expect(html).toMatch(new RegExp(`${label} <span[^>]*data-slot="field-optional"`, 'u'))
    expect(html).toContain('>Optional</span></label>')
  })
})

describe('error and help together', () => {
  it('puts the help directly under the control and the error after it', () => {
    const html = textField(
      { description: 'Shown to guests.' },
      text({ meta: invalidMeta }),
    )

    expect(html.indexOf('Shown to guests.')).toBeLessThan(html.indexOf('Enter a name'))
    expect(html).toContain('aria-invalid="true"')
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
