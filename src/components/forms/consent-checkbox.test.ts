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
  // these 2 properties:") keeps the list outside it, under it in the frame.
  it('draws what the sentence lists under it, as a list, before its line of help', () => {
    const html = render({
      children: 'I agree for these 2 properties:',
      listed: [
        { key: 'a', label: 'Hotel A' },
        { key: 'b', label: 'Cafe B' },
      ],
      description: 'Help.',
      error: 'Required.',
    })

    expect(html).toMatch(/I agree for these 2 properties:<\/label><ul /u)
    expect(html).toMatch(/<ul [^>]*><li[^>]*>Hotel A<\/li><li[^>]*>Cafe B<\/li><\/ul>/u)
    expect(html.indexOf('Cafe B')).toBeLessThan(html.indexOf('Help.'))
  })

  // A description flattens a list into its words with nothing between them:
  // "Hotel A Cafe B" could be one name. The box is described by the same names
  // as one sentence, commas between them, ahead of the help and the refusal.
  it('reads what the sentence lists as one comma-separated sentence, first in its description', () => {
    const html = render({
      children: 'I agree for these 2 properties:',
      listed: [
        { key: 'a', label: 'Hotel A' },
        { key: 'b', label: 'Cafe B' },
      ],
      description: 'Help.',
      error: 'Required.',
    })

    expect(html).toContain(
      'aria-describedby="consent-listed consent-description consent-error"',
    )
    expect(html).toContain('<span id="consent-listed" hidden="">Hotel A, Cafe B.</span>')
  })

  it('ends the read-out list with one full stop, never two', () => {
    const html = render({
      listed: [
        { key: 'a', label: 'Hotel A' },
        { key: 'b', label: 'Smith & Co.' },
      ],
    })

    expect(html).toContain('>Hotel A, Smith &amp; Co.</span>')
  })

  it('runs a list of seven or more in two columns from sm up', () => {
    const entries = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        key: String(index),
        label: `Place ${index + 1}`,
      }))

    expect(render({ listed: entries(6) })).not.toContain('sm:columns-2')
    expect(render({ listed: entries(7) })).toMatch(/<ul [^>]*class="[^"]*sm:columns-2/u)
  })

  it('draws no list and describes nothing extra when the sentence lists nothing', () => {
    const html = render({ listed: [], description: 'Help.' })

    expect(html).not.toContain('<ul')
    expect(html).toContain('aria-describedby="consent-description"')
  })

  it('passes a name through for a form that posts the box', () => {
    expect(render({ name: 'profileAcknowledged' })).toContain(
      'name="profileAcknowledged"',
    )
  })
})
