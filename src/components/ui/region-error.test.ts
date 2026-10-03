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
      retrying: false,
      ...props,
    }),
  )
}

describe('RegionError', () => {
  it('says what failed, as an alert in the error tone', () => {
    const html = render()

    expect(html).toContain('role="alert"')
    expect(html).toContain('bg-negative-muted')
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

  it('takes its phone height from the Button, so a dense workspace sets it once on a container', () => {
    const html = render()

    expect(html).toContain('max-md:min-h-(--control-touch)')
    expect(html).not.toContain('min-h-11')
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
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('motion-reduce:animate-none')
  })

  it('keeps the name a screen reader hears when the retry starts, so the alert is not read out again', () => {
    const idle = render()
    const busy = render({ retrying: true })

    // The visible words change; the one that is announced does not.
    expect(idle).toContain('<span>Try again</span>')
    expect(busy).toContain('<span class="sr-only">Try again</span>')
    expect(busy).toContain('<span aria-hidden="true">Trying again…</span>')
  })

  it('does not mark the button disabled or busy when it is idle', () => {
    const html = render()

    expect(html).not.toContain('aria-disabled=')
    expect(html).not.toContain('aria-busy')
  })

  it('has a compact size for a rail, a card or a dialog', () => {
    expect(render({ size: 'compact' })).toContain('py-6')
    expect(render()).toContain('py-12')
  })

  it('puts Cancel after Try again, in the same density, when the region can be left', () => {
    const html = render({ onCancel: () => undefined })

    expect(html.indexOf('Try again')).toBeLessThan(html.indexOf('Cancel'))
    expect(html.match(/max-md:min-h-\(--control-touch\)/g)).toHaveLength(2)
  })

  it('offers no Cancel unless the region can be left', () => {
    expect(render()).not.toContain('Cancel')
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

  it('has no phone height of its own at the extra-small size', () => {
    const html = renderToStaticMarkup(
      createElement(RetryButton, { onRetry: () => undefined, size: 'xs' }),
    )

    expect(html).not.toContain('max-md:')
  })
})
