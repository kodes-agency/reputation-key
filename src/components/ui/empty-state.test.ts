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
    expect(html).toContain('data-size="default"')
    expect(html).toContain('data-tone="neutral"')
  })

  it('is not an alert unless it reports a failure', () => {
    expect(render()).not.toContain('role=')
  })

  it('draws no empty description or action wrapper when it has neither', () => {
    const html = render()

    expect(html).not.toContain('data-slot="empty-state-description"')
    expect(html).not.toContain('data-slot="empty-state-action"')
  })

  it('puts the description under the title, in muted ink', () => {
    const html = render({ description: 'Add a template to get started.' })

    expect(html).toMatch(
      /Nothing here<\/p><p data-slot="empty-state-description"[^>]*text-muted-foreground[^>]*>Add a template to get started\./,
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
    expect(html).toContain('data-slot="empty-state-action"')
  })

  it('keeps free-form children working for callers that have not moved to the slots', () => {
    const html = render({ children: createElement('span', null, 'Legacy child') })

    expect(html).toContain('Legacy child')
  })

  it('shrinks to a compact panel for a slot inside a list, a rail or a dialog', () => {
    const html = render({ size: 'compact' })

    expect(html).toContain('data-size="compact"')
    expect(html).toContain('py-6')
    expect(html).not.toContain('py-12')
    expect(html).toContain('size-8')
    expect(html).not.toContain('size-10')
    expect(html).toContain('border-dashed')
  })

  it('reports a failure as an alert in the destructive ink', () => {
    const html = render({ tone: 'error' })

    expect(html).toContain('role="alert"')
    expect(html).toContain('data-tone="error"')
    expect(html).toContain('text-destructive')
    expect(html).toContain('bg-destructive/10')
    expect(html).not.toContain('bg-muted')
  })

  it('lets a caller add a class of its own, such as a width cap', () => {
    expect(render({ className: 'max-w-md' })).toContain('max-w-md')
  })
})
