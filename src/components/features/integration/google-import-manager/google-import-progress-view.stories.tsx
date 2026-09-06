import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import { GoogleImportProgressView } from './google-import-progress-view'

const items: readonly ImportProgressItemDto[] = [
  {
    itemId: '10000000-0000-4000-8000-000000000010',
    propertyName: 'The Meridian Grand Resort',
    action: 'create',
    status: 'imported',
    outcomeCode: 'imported',
    messageKey: 'property_import.imported',
    retryable: false,
    retryRevision: 0,
    userAction: 'none',
  },
  {
    itemId: '10000000-0000-4000-8000-000000000020',
    propertyName: 'Juniper Street Café',
    action: 'create',
    status: 'failed',
    outcomeCode: 'temporarily_unavailable',
    messageKey: 'property_import.temporarily_unavailable',
    retryable: true,
    retryRevision: 2,
    userAction: 'retry',
  },
]

const processing: ImportProgressDto = {
  contractVersion: 3,
  importJobId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  status: 'processing',
  totalCount: 4,
  processedCount: 2,
  counts: {
    pending: 2,
    processing: 0,
    imported: 1,
    relinked: 0,
    already_exists: 0,
    failed: 1,
    cancelled: 0,
  },
  items,
  canRetry: true,
  pollAfterMs: 2_000,
  purgeAt: null,
  updatedAt: '2026-08-12T10:00:00.000Z',
}

function ProgressHarness({ snapshot = processing }: { snapshot?: ImportProgressDto }) {
  const [retried, setRetried] = useState(false)
  return (
    <>
      <GoogleImportProgressView
        progress={snapshot}
        isPollingError={false}
        isRefreshing={false}
        isCancelling={false}
        retryingItemId={null}
        onRefresh={() => {}}
        onRetry={() => setRetried(true)}
        onCancel={() => {}}
      />
      {retried ? <p role="status">Retry requested</p> : null}
    </>
  )
}

const meta: Meta<typeof GoogleImportProgressView> = {
  title: 'Integration/GoogleImport/ProgressView',
  component: GoogleImportProgressView,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof GoogleImportProgressView>

export const Processing: Story = {
  render: () => <ProgressHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    const retries = canvas.getAllByRole('button', { name: /retry/i })
    await userEvent.click(retries[0]!)
    await expect(canvas.getByRole('status')).toHaveTextContent(/retry requested/i)
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

export const CompletedWithIssues: Story = {
  render: () => (
    <ProgressHarness
      snapshot={{
        ...processing,
        status: 'completed_with_issues',
        processedCount: 4,
        pollAfterMs: null,
        counts: { ...processing.counts, pending: 0, imported: 3 },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: /view properties/i })).toBeVisible()
  },
}

/**
 * Every selected location was already bound. Before `already_exists` was surfaced
 * this rendered 0 / 0 / 0 under "Import complete with issues".
 */
export const AllAlreadyLinked: Story = {
  render: () => (
    <ProgressHarness
      snapshot={{
        ...processing,
        status: 'completed_with_issues',
        totalCount: 3,
        processedCount: 3,
        pollAfterMs: null,
        canRetry: false,
        items: [],
        counts: {
          pending: 0,
          processing: 0,
          imported: 0,
          relinked: 0,
          already_exists: 3,
          failed: 0,
          cancelled: 0,
        },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const figure = (label: RegExp) =>
      canvas.getByText(label).parentElement?.querySelector('p')?.textContent

    await expect(figure(/^Already linked$/)).toBe('3')
    await expect(figure(/^Imported or linked$/)).toBe('0')
    await expect(figure(/^Need attention$/)).toBe('0')
    await expect(figure(/^Remaining$/)).toBe('0')
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

export const LiveUpdatesPaused: Story = {
  args: {
    progress: processing,
    isPollingError: true,
    isRefreshing: false,
    isCancelling: false,
    retryingItemId: null,
    onRefresh: () => {},
    onRetry: () => {},
    onCancel: () => {},
  },
}

export const RetryInFlight: Story = {
  args: {
    progress: processing,
    isPollingError: false,
    isRefreshing: false,
    isCancelling: false,
    retryingItemId: items[1]!.itemId,
    onRefresh: () => {},
    onRetry: () => {},
    onCancel: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const retryButtons = canvas.getAllByRole('button', { name: /retrying/i })
    await Promise.all(retryButtons.map((button) => expect(button).toBeDisabled()))
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

export const RefreshInFlight: Story = {
  args: {
    progress: processing,
    isPollingError: false,
    isRefreshing: true,
    isCancelling: false,
    retryingItemId: null,
    onRefresh: () => {},
    onRetry: () => {},
    onCancel: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /refreshing/i })).toBeDisabled()
  },
}
