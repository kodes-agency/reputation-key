// The core visit metric is recorded independently of whether the guest has
// acknowledged this disclosure. The portal-scoped session guard prevents a refresh
// from inflating the metric.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { GuestAnalyticsNotice } from './guest-analytics-notice'

const ACKNOWLEDGED_KEY = 'guest-analytics-notice-acknowledged'
const SCOPE_KEY = 'portal-public-token'
const FAILURE_SCOPE_KEY = 'portal-failed-visit-token'
const FAILURE_SCAN_RECORDED_KEY = `guest-scan-recorded:${FAILURE_SCOPE_KEY}`
const failingOnPortalVisit = fn(async () => {
  throw new Error('temporarily unavailable')
})

const meta: Meta<typeof GuestAnalyticsNotice> = {
  title: 'Guest/GuestAnalyticsNotice',
  component: GuestAnalyticsNotice,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { scopeKey: SCOPE_KEY },
}
export default meta
type Story = StoryObj<typeof GuestAnalyticsNotice>

function renderWithState(
  acknowledged: boolean,
  recorded: boolean,
  onPortalVisit: () => void,
  scopeKey = SCOPE_KEY,
) {
  const recordedKey = `guest-scan-recorded:${scopeKey}`
  try {
    if (recorded) sessionStorage.setItem(recordedKey, 'recorded')
    else sessionStorage.removeItem(recordedKey)
    if (acknowledged) localStorage.setItem(ACKNOWLEDGED_KEY, 'true')
    else localStorage.removeItem(ACKNOWLEDGED_KEY)
  } catch {
    // Ignore storage errors in restricted Storybook sandboxes.
  }
  return <GuestAnalyticsNotice scopeKey={scopeKey} onPortalVisit={onPortalVisit} />
}

export const FirstVisit: Story = {
  args: { onPortalVisit: fn() },
  render: (args) => renderWithState(false, false, args.onPortalVisit),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByText(/short-lived, privacy-protected network marker/i),
    ).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: /reject|decline/i })).toBeNull()
    expect(
      canvas.getByRole('region', { name: 'Portal analytics information' }),
    ).toHaveClass('border-border', 'bg-background')
    await waitFor(() => expect(args.onPortalVisit).toHaveBeenCalledTimes(1))
  },
}

export const AcknowledgeDismissesNotice: Story = {
  args: { onPortalVisit: fn() },
  render: (args) => renderWithState(false, false, args.onPortalVisit),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Got it' }))
    expect(localStorage.getItem(ACKNOWLEDGED_KEY)).toBe('true')
    await waitFor(() => expect(args.onPortalVisit).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Got it' })).toBeNull()
    })
  },
}

export const AlreadyAcknowledgedStillRecordsVisit: Story = {
  args: { onPortalVisit: fn() },
  render: (args) => renderWithState(true, false, args.onPortalVisit),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Got it' })).toBeNull()
    await waitFor(() => expect(args.onPortalVisit).toHaveBeenCalledTimes(1))
  },
}

export const SameBrowserSessionDoesNotRecordTwice: Story = {
  args: { onPortalVisit: fn() },
  render: (args) => renderWithState(true, true, args.onPortalVisit),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Got it' })).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(args.onPortalVisit).not.toHaveBeenCalled()
  },
}

export const FailedVisitCanRetryOnTheNextMount: Story = {
  args: { onPortalVisit: failingOnPortalVisit },
  render: () => renderWithState(true, false, failingOnPortalVisit, FAILURE_SCOPE_KEY),
  play: async () => {
    await waitFor(() => expect(failingOnPortalVisit).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(sessionStorage.getItem(FAILURE_SCAN_RECORDED_KEY)).toBeNull(),
    )
  },
}
