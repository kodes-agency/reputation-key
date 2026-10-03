// A link set in a sentence (UI consistency scan: ACT-13, FORM-18): accent ink,
// medium weight, underlined on hover, or always underlined where the link has to
// read as one without a pointer. Dark is the default theme; the light variant
// renders the same sentences on the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { InlineLink } from './inline-link'

const meta: Meta<typeof InlineLink> = {
  title: 'Patterns/Inline link',
  component: InlineLink,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof InlineLink>

/** Stands in for the utilities layer, which this runner does not compile. */
const UTILITY_LAYER = `@layer utilities {
  .underline { text-decoration-line: underline; }
}`

function Sentences() {
  return (
    <div className="flex max-w-md flex-col gap-3 text-sm text-muted-foreground">
      <style>{UTILITY_LAYER}</style>
      {/* On its own line, beside a field: underlined on hover is enough. */}
      <p>
        <InlineLink to="/">Forgot password?</InlineLink>
      </p>
      {/* In a sentence the ink alone does not set it apart from the words around it
          (axe link-in-text-block), so it stays underlined. */}
      <p>
        By joining you accept the{' '}
        <InlineLink to="/" underline="always">
          Beta Agreement
        </InlineLink>
        .
      </p>
    </div>
  )
}

/** Underlined on hover by default; `underline="always"` for a link inside a sentence. */
export const InSentences: Story = {
  render: () => <Sentences />,
  play: async ({ canvasElement }) => {
    const links = within(canvasElement).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Forgot password?',
      'Beta Agreement',
    ])
    expect(links[0]?.className).toContain('hover:underline')
    expect(links[1]?.className).toContain('underline')
    expect(links[1]?.className).not.toContain('hover:underline')
  },
}

/** The same lines on the light surface. */
export const InSentencesLight: Story = {
  parameters: { theme: 'light' },
  render: () => <Sentences />,
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole('link')).toHaveLength(2)
  },
}
