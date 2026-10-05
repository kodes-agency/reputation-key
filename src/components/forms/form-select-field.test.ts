// FormSelectField (UI consistency scan: FORM-03).
//
// The Goal's metric (on the new-goal page and in the revision dialog) and the Portal's
// private-feedback threshold were a browser <select> dressed by hand, which draws its
// own popup, height, focus ring and dark surface, unlike every other dropdown. The field
// is the shared Select in the shared field frame. A closed Select draws no options in
// the server markup; the options and the choice run in the Storybook project.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FormSelectField } from './form-select-field'

type Props = Parameters<typeof FormSelectField>[0]

const OPTIONS = [
  { value: 'qualified_scans', label: 'Qualified scans' },
  { value: 'portal_rating_count', label: 'Private rating count' },
]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(FormSelectField, {
      id: 'goal-metric',
      label: 'Metric',
      value: 'qualified_scans',
      onValueChange: () => undefined,
      options: OPTIONS,
      ...props,
    }),
  )
}

describe('FormSelectField', () => {
  it('is a select named by its label', () => {
    const html = render()

    expect(html).toContain('role="combobox"')
    expect(html).toContain('id="goal-metric"')
    expect(html).toMatch(/<label[^>]*for="goal-metric"[^>]*>Metric<\/label>/u)
    expect(html).toContain('data-slot="select-trigger"')
  })

  it('names its help as the select description', () => {
    const html = render({ description: 'Counts eligible portal scans.' })

    expect(html).toContain('aria-describedby="goal-metric-description"')
    expect(html).toContain('Counts eligible portal scans.')
  })

  it('names the reason as well while it is refused', () => {
    expect(
      render({
        description: 'Counts eligible portal scans.',
        invalid: true,
        errors: [{ message: 'Choose a metric' }],
      }),
    ).toContain('aria-describedby="goal-metric-description goal-metric-error"')
  })

  it('reads as invalid, with its reason, when the schema refuses it', () => {
    const html = render({ invalid: true, errors: [{ message: 'Choose a metric' }] })

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('Choose a metric')
  })

  it('disables the select', () => {
    expect(render({ disabled: true })).toMatch(
      /role="combobox"[^>]*disabled=""|disabled=""[^>]*role="combobox"/u,
    )
  })
})
