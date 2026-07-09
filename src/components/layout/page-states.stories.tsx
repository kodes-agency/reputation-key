// Storybook stories for the shared page-state components (LoadingState +
// ErrorState). These are the standard full-page skeletons a PageShell renders
// while route data is pending (LoadingState) or a loader/query failed
// (ErrorState). Presentational — their only "state" is the prop-fed message and
// the optional onRetry callback.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { LoadingState, ErrorState } from './page-states'

const meta: Meta<typeof LoadingState> = {
  title: 'Layout/PageStates',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta

type LoadingStory = StoryObj<typeof LoadingState>
type ErrorStory = StoryObj<typeof ErrorState>

// Default skeleton: aria-busy region + sr-only "Loading…" announcement + a
// grid of placeholder blocks.
export const Loading: LoadingStory = {
  render: () => <LoadingState />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The sr-only label is announced to assistive tech.
    expect(canvas.getByText(/loading/i)).toBeInTheDocument()
    // The region carries aria-busy so screen readers announce the pending state.
    expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
  },
}

// Custom loading label.
export const LoadingCustomLabel: LoadingStory = {
  render: () => <LoadingState label="Fetching your properties…" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/fetching your properties/i)).toBeInTheDocument()
  },
}

// Default error: the generic message renders, no retry control.
export const ErrorDefault: ErrorStory = {
  render: () => <ErrorState />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByText(/something went wrong loading this page/i),
    ).toBeInTheDocument()
    // No retry button when onRetry is omitted.
    expect(canvas.queryByRole('button', { name: /try again/i })).toBeNull()
  },
}

// Error with a custom message.
export const ErrorMessage: ErrorStory = {
  render: () => <ErrorState message="We couldn't reach the reviews service." />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/we couldn't reach the reviews service/i)).toBeInTheDocument()
  },
}

// Error with retry: clicking "Try again" invokes onRetry.
const retrySpy = fn()
export const ErrorWithRetry: ErrorStory = {
  render: () => <ErrorState onRetry={retrySpy} />,
  play: async ({ canvasElement }) => {
    retrySpy.mockClear()
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /try again/i })
    await userEvent.click(button)
    expect(retrySpy).toHaveBeenCalledTimes(1)
  },
}
