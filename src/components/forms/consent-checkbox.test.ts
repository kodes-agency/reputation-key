// ConsentCheckbox (UI consistency scan: FORM-11).
//
// "I have read this notice and agree..." was rebuilt four times: unframed beside a help
// paragraph (AI settings), in a bordered section with no help and no error (the setup
// review), in a bordered Field with an alert of its own (the import review), and as a
// text-xs label beside a button (the Portal content review). One control now: a framed
// Field, the checkbox beside its sentence, a line of help under it and the refusal
// under that. These checks pin the markup (server-rendered, no DOM); the click and the
// refusal that follows a missed box run in the Storybook project.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConsentCheckbox } from './consent-checkbox'

type Props = Parameters<typeof ConsentCheckbox>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(ConsentCheckbox, {
      id: 'consent',
      checked: false,
      onCheckedChange: () => undefined,
      children: 'I have read this notice.',
      ...props,
    }),
  )
}

describe('ConsentCheckbox', () => {
  it('is a checkbox named by its sentence, in one frame', () => {
    const html = render()

    expect(html).toContain('data-slot="consent-checkbox"')
    expect(html).toContain('role="checkbox"')
    expect(html).toMatch(
      /<label[^>]*for="consent"[^>]*>I have read this notice\.<\/label>/u,
    )
    expect(html).toContain('rounded-lg border p-4')
  })

  it('aligns the box with the first line of a sentence that wraps', () => {
    expect(render()).toContain('items-start')
  })

  it('reflects the checked state', () => {
    expect(render({ checked: true })).toContain('aria-checked="true"')
    expect(render({ checked: false })).toContain('aria-checked="false"')
  })

  it('names its line of help as the checkbox description', () => {
    const html = render({ description: 'RepKey records who agreed.' })

    expect(html).toContain('id="consent-description"')
    expect(html).toContain('aria-describedby="consent-description"')
    expect(html).toContain('>RepKey records who agreed.</p>')
  })

  it('draws no help and describes nothing when there is none', () => {
    const html = render()

    expect(html).not.toContain('field-description')
    expect(html).not.toContain('aria-describedby')
  })

  it('reads as invalid and says why, as an alert, once there is a refusal', () => {
    const html = render({ error: 'Confirm that you have checked these details.' })

    expect(html).toContain('data-invalid="true"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Confirm that you have checked these details.')
  })

  it('names the refusal as part of the checkbox description, after the help', () => {
    const html = render({ description: 'Help.', error: 'Required.' })

    expect(html).toMatch(/aria-describedby="consent-description consent-error"/u)
    expect(html.indexOf('Help.')).toBeLessThan(html.indexOf('Required.'))
  })

  it('is not invalid, and shows no alert, without a refusal', () => {
    const html = render()

    expect(html).toContain('data-invalid="false"')
    expect(html).not.toContain('role="alert"')
  })

  it('dims the sentence and disables the box together', () => {
    const html = render({ disabled: true })

    expect(html).toContain('data-disabled="true"')
    expect(html).toMatch(
      /role="checkbox"[^>]*disabled=""|disabled=""[^>]*role="checkbox"/u,
    )
  })

  it('wraps a long unbroken word in its sentence instead of widening the frame', () => {
    expect(render()).toMatch(
      /<label[^>]*class="[^"]*wrap-anywhere[^"]*"[^>]*for="consent"/u,
    )
  })

  // A label holds phrasing content, so a sentence that ends in a list ("for
  // these 3 properties:") keeps the list outside it, under it in the frame.
  it('draws what the sentence lists under it, read first in the checkbox description', () => {
    const html = render({
      children: 'I agree for these 2 properties:',
      details: createElement(
        'ul',
        null,
        createElement('li', { key: 'a' }, 'Hotel A'),
        createElement('li', { key: 'b' }, 'Cafe B'),
      ),
      description: 'Help.',
      error: 'Required.',
    })

    expect(html).toMatch(
      /I agree for these 2 properties:<\/label><div id="consent-details"/u,
    )
    expect(html).toMatch(
      /<div id="consent-details"[^>]*><ul><li>Hotel A<\/li><li>Cafe B<\/li><\/ul><\/div>/u,
    )
    expect(html).toContain(
      'aria-describedby="consent-details consent-description consent-error"',
    )
    expect(html.indexOf('Cafe B')).toBeLessThan(html.indexOf('Help.'))
  })

  it('passes a name through for a form that posts the box', () => {
    expect(render({ name: 'profileAcknowledged' })).toContain(
      'name="profileAcknowledged"',
    )
  })
})
