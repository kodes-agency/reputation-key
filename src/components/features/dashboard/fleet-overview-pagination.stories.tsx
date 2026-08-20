// Fleet pagination — the Load-more control.
//
// Split out of fleet-overview.stories.tsx for the 200-line cap. These three are
// one concern: the projection pages at FLEET_PAGE_SIZE = 50, and before this
// control existed the fifty-first property was unreachable AND unsignalled.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { FleetOverview } from './fleet-overview'
import { populatedData } from './fleet-overview-stories-data'

// Shape-valid opaque cursor: base64url of {"n":"harborline","i":"prop-0002"}.
// The client never decodes it; only the server does.
const SAMPLE_CURSOR = 'eyJuIjoiaGFyYm9ybGluZSIsImkiOiJwcm9wLTAwMDIifQ'

const meta: Meta<typeof FleetOverview> = {
  title: 'Dashboard/FleetOverviewPagination',
  component: FleetOverview,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  args: { onLoadMore: () => {} },
}
export default meta
type Story = StoryObj<typeof FleetOverview>

export const HasMorePages: Story = {
  args: {
    data: { ...populatedData, nextCursor: SAMPLE_CURSOR },
    isFetchingNextPage: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /Load more properties/ })
    expect(button).toBeVisible()
    expect(button).toBeEnabled()
  },
}

// Mid-fetch: the control stays visible and goes disabled, so a double click
// cannot queue two pages.
export const LoadingNextPage: Story = {
  args: {
    data: { ...populatedData, nextCursor: SAMPLE_CURSOR },
    isFetchingNextPage: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /Load more properties/ })).toBeDisabled()
  },
}

// The last page must NOT offer to load more — that absence is the signal.
export const LastPageHidesTheControl: Story = {
  args: {
    data: { ...populatedData, nextCursor: null },
    isFetchingNextPage: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /Load more properties/ })).toBeNull()
  },
}
