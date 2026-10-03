// The ExplainTrigger: text that explains itself on request (UI consistency scan:
// SURF-12). A Popover, so the explanation is reachable by keyboard and on a
// phone. Dark is the default theme; the light variant renders the same line on
// the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { Popover, PopoverContent } from './popover'
import { ExplainTrigger } from './explain-trigger'

function Demo() {
  return (
    <p className="max-w-sm text-sm">
      Your{' '}
      <Popover>
        <ExplainTrigger aria-label="What response rate means">
          response rate
        </ExplainTrigger>
        <PopoverContent aria-label="Response rate" className="max-w-xs text-sm">
          <p className="font-medium">Response rate</p>
          <p className="mt-1 text-muted-foreground">
            The share of reviews in the period that have a published reply.
          </p>
        </PopoverContent>
      </Popover>{' '}
      is measured over the last 30 days.
    </p>
  )
}

const meta: Meta<typeof Demo> = {
  title: 'Patterns/Explain trigger',
  component: Demo,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Demo>

/** A button with the dotted cue and the help cursor; pressing it opens the explanation. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', {
      name: 'What response rate means',
    })
    expect(trigger.className).toContain('decoration-dotted')
    expect(trigger.className).toContain('cursor-help')
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByText(/share of reviews in the period/)).toBeVisible(),
    )
  },
}

/** A keyboard user reaches it with Tab and opens it with Enter. */
export const KeyboardOpens: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab()
    const trigger = within(canvasElement).getByRole('button', {
      name: 'What response rate means',
    })
    expect(trigger).toHaveFocus()
    expect(trigger.className).toContain('focus-ring')
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(screen.getByText(/share of reviews in the period/)).toBeVisible(),
    )
  },
}

export const DefaultLight: Story = {
  ...Default,
  parameters: { theme: 'light' },
}
