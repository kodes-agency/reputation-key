// The Results tab's three ways of not showing figures: its first read still on
// the way, a read that failed, and a read the reader may not make. The figures
// themselves are Portal/Analytics/Results. The read is injected, so each story
// scripts what the server function answers.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor } from 'storybook/test'
import { PortalAnalyticsTab } from './portal-analytics-tab'
import { RESULTS_HEALTHY } from './portal-results-stories-data'

type Read = React.ComponentProps<typeof PortalAnalyticsTab>['getPortalAnalytics']

const asRead = (read: () => Promise<unknown>) => fn(read) as unknown as Read

const meta = {
  title: 'Portal/Analytics/Results tab',
  component: PortalAnalyticsTab,
  parameters: { layout: 'padded' },
  args: {
    portalId: '11111111-1111-4111-8111-111111111111',
    propertyId: '22222222-2222-4222-8222-222222222222',
    getPortalAnalytics: asRead(async () => RESULTS_HEALTHY),
  },
} satisfies Meta<typeof PortalAnalyticsTab>

export default meta
type Story = StoryObj<typeof meta>

/** The first read is on the way: the strip keeps its five names, not a line of text. */
export const Loading: Story = {
  args: { getPortalAnalytics: asRead(() => new Promise(() => undefined)) },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading results…')
    await expect(canvas.getByLabelText('Portal results')).toBeVisible()
    await expect(canvas.getByText('Qualified scans')).toBeVisible()
    await expect(canvas.queryByText(/couldn.t be loaded/i)).toBeNull()
  },
}

/** A failed read says so and offers Try again, which reads once more and shows the figures. */
export const FailedThenRecovers: Story = {
  args: {
    getPortalAnalytics: (() => {
      let calls = 0
      return asRead(async () => {
        calls += 1
        if (calls === 1) throw new Error('Reporting is down')
        return RESULTS_HEALTHY
      })
    })(),
  },
  play: async ({ canvas, args }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Results couldn’t be loaded.',
    )
    // The server's own words never reach the reader.
    await expect(canvas.queryByText(/Reporting is down/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(canvas.getByLabelText('Portal results')).toBeInTheDocument(),
    )
    await expect(args.getPortalAnalytics).toHaveBeenCalledTimes(2)
  },
}

/** A deliberately dark capability is not a failure: friendly copy, and nothing to retry. */
export const NotSwitchedOn: Story = {
  args: {
    getPortalAnalytics: asRead(async () => {
      throw Object.assign(new Error('org_not_allowlisted'), {
        code: 'org_not_allowlisted',
      })
    }),
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Results aren’t available yet')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
    await expect(canvas.queryByText(/org_not_allowlisted/)).toBeNull()
  },
}

export const FailedLight: Story = {
  args: {
    getPortalAnalytics: asRead(async () => {
      throw new Error('Reporting is down')
    }),
  },
  parameters: { theme: 'light' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Try again' })).toBeVisible()
  },
}
