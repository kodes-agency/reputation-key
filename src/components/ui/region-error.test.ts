import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RegionError, RetryButton } from './region-error'

type Props = Parameters<typeof RegionError>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(RegionError, {
      message: 'The goal couldn’t be loaded.',
      onRetry: () => undefined,
      ...props,
    }),
  )
}

describe('RegionError', () => {
  it('says what failed, as an alert in the error tone', () => {
    const html = render()

    expect(html).toContain('role="alert"')
    expect(html).toContain('bg-destructive/10')
    expect(html).toContain('The goal couldn’t be loaded.')
  })

  it('always offers "Try again", never "Retry"', () => {
    const html = render()

    expect(html).toContain('>Try again<')
    expect(html).not.toContain('Retry')
  })

  it('draws the recovery as an outline button in the pane, not a link in a sentence', () => {
    const html = render()

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('type="button"')
  })

  it('gives the recovery a touch-sized target on a phone', () => {
    expect(render()).toContain('max-md:min-h-11')
  })

  it('says what is unaffected, or what to do meanwhile, under the sentence', () => {
    const html = render({ description: 'The portals below are unaffected.' })

    expect(html).toContain('The portals below are unaffected.')
    expect(html.indexOf('couldn’t be loaded')).toBeLessThan(
      html.indexOf('The portals below are unaffected.'),
    )
  })

  it('stays on screen, its button busy, while the retry is reading', () => {
    const html = render({ retrying: true })

    expect(html).toContain('Trying again…')
    expect(html).not.toContain('>Try again<')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('motion-reduce:animate-none')
  })

  it('does not mark the button disabled when it is idle', () => {
    expect(render()).not.toContain('aria-disabled')
  })

  it('has a compact size for a rail, a card or a dialog', () => {
    expect(render({ size: 'compact' })).toContain('py-6')
    expect(render()).toContain('py-12')
  })

  it('puts a second action, such as Cancel, after Try again', () => {
    const html = render({ secondary: createElement('button', null, 'Cancel') })

    expect(html.indexOf('Try again')).toBeLessThan(html.indexOf('Cancel'))
  })
})

describe('RetryButton', () => {
  it('is the same outline "Try again" control wherever a failure is shown inline', () => {
    const html = renderToStaticMarkup(
      createElement(RetryButton, { onRetry: () => undefined, size: 'xs' }),
    )

    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('data-size="xs"')
    expect(html).toContain('>Try again<')
  })
})
