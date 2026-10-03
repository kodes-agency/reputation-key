import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Inbox } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './empty-state'

type Props = Parameters<typeof EmptyState>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(EmptyState, { icon: Inbox, title: 'Nothing here', ...props }),
  )
}

describe('EmptyState', () => {
  it('is a dashed panel with an icon disc and the title, at the roomy default size', () => {
    // Arrange / Act
    const html = render()

    // Assert
    expect(html).toContain('border-dashed')
    expect(html).toContain('py-12')
    expect(html).toContain('size-10')
    expect(html).toContain('lucide-inbox')
    expect(html).toContain('>Nothing here</p>')
  })

  it('is not an alert unless it reports a failure', () => {
    expect(render()).not.toContain('role=')
  })

  it('draws no empty description or action wrapper when it has neither', () => {
    const html = render()

    // The icon disc and the title are the only children of the panel.
    expect(html.match(/<p /g)).toHaveLength(1)
    expect(html).not.toContain('max-w-md')
    expect(html).not.toContain('flex flex-col items-center gap-2')
  })

  it('puts the description under the title, in muted ink', () => {
    const html = render({ description: 'Add a template to get started.' })

    expect(html).toMatch(
      /Nothing here<\/p><p class="[^"]*text-muted-foreground[^"]*">Add a template to get started\./,
    )
  })

  it('takes a node as the description, so a sentence can carry a link', () => {
    const html = render({
      description: createElement(
        'span',
        null,
        'Set it in ',
        createElement('a', null, 'Settings'),
      ),
    })

    expect(html).toContain('<a>Settings</a>')
  })

  it('puts the action last, after the description', () => {
    const html = render({
      description: 'Describe it.',
      action: createElement('button', null, 'Create one'),
    })

    expect(html.indexOf('Describe it.')).toBeLessThan(html.indexOf('Create one'))
  })

  it('shrinks to a compact panel for a slot inside a list, a rail or a dialog', () => {
    const html = render({ size: 'compact' })

    expect(html).toContain('gap-2 py-6')
    expect(html).toContain('py-6')
    expect(html).not.toContain('py-12')
    expect(html).toContain('size-8')
    expect(html).not.toContain('size-10')
    expect(html).toContain('border-dashed')
  })

  it('reports a failure as an alert in the destructive ink', () => {
    const html = render({ tone: 'error' })

    expect(html).toContain('role="alert"')
    expect(html).toContain('text-destructive')
    expect(html).toContain('bg-destructive/10')
    expect(html).not.toContain('bg-muted')
  })
})
