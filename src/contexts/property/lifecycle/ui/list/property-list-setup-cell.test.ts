import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    ...rest
  }: {
    children: ReactNode
    className?: string
    'aria-label'?: string
  }) =>
    createElement(
      'a',
      { className, 'aria-label': rest['aria-label'], href: '#' },
      children,
    ),
}))

const { SetupValue } = await import('./property-list-cells')

type Props = Parameters<typeof SetupValue>[0]

function render(props: Partial<Props>): string {
  return renderToStaticMarkup(
    createElement(SetupValue, {
      setup: undefined,
      state: 'ready',
      propertyId: 'prop-1',
      propertyName: 'Hotel Elegance',
      ...props,
    }),
  )
}

const STEP_IN_PROGRESS: NonNullable<Props['setup']> = {
  completedCount: 5,
  stepCount: 7,
  nextStep: { key: 'reply_voice', section: 'replies', status: 'pending', asked: false },
}

describe('setup cell', () => {
  it('draws nothing when setup is not read and not being read', () => {
    expect(render({ setup: undefined, state: 'unavailable' })).toBe('')
  })

  it('reserves the two lines the loaded cell has while setup is being read', () => {
    const html = render({ setup: undefined, state: 'loading' })

    // A 20px progress line and a 16px next-step line.
    expect(html).toContain('h-5')
    expect(html).toContain('h-4')
    expect(html).toContain('aria-hidden="true"')
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2)
  })

  it('draws the progress line and the next step once it has arrived', () => {
    const html = render({ setup: STEP_IN_PROGRESS })

    expect(html).toContain('5 of 7')
    expect(html).toContain('Next: Set the reply voice')
  })

  it('keeps the next step on one line and the whole step in the title and the label', () => {
    const html = render({ setup: STEP_IN_PROGRESS })

    expect(html).toContain('truncate')
    expect(html).toContain('title="Next: Set the reply voice"')
    expect(html).toContain('aria-label="Setup 5 of 7 at Hotel Elegance. Next:')
  })

  it('is one line when setup is done', () => {
    const html = render({ setup: { ...STEP_IN_PROGRESS, nextStep: null } })

    expect(html).toContain('Done')
    expect(html).not.toContain('Next:')
  })
})
