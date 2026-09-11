import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import { consentToAi } from '#/components/features/settings/merchant-ai-consent.stories.play'
import { aiEnabled, createAiFnsFixture } from './google-import-ai.stories.fixtures'
import { GoogleImportProgressView } from './google-import-progress-view'

const aiFns = createAiFnsFixture()

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
    propertyId: '10000000-0000-4000-8000-000000000011',
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
    propertyId: null,
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

function ProgressHarness({
  snapshot = processing,
  ai = aiFns,
}: {
  snapshot?: ImportProgressDto
  ai?: ReturnType<typeof createAiFnsFixture>
}) {
  const [retried, setRetried] = useState(false)
  return (
    <>
      <GoogleImportProgressView
        progress={snapshot}
        aiFns={ai}
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
  decorators: [AuthedRouterDecorator],
  args: { aiFns },
}
export default meta
type Story = StoryObj<typeof GoogleImportProgressView>

/** A freshly committed import: nothing processed, but visibly alive. */
export const Queued: Story = {
  render: () => (
    <ProgressHarness
      snapshot={{
        ...processing,
        status: 'queued',
        processedCount: 0,
        counts: { ...processing.counts, pending: 4, imported: 0, failed: 0 },
        items: processing.items.map((item) => ({
          ...item,
          status: 'pending' as const,
          outcomeCode: null,
          messageKey: 'property_import.pending' as const,
          retryable: false,
          userAction: 'none' as const,
          propertyId: null,
        })),
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bar = canvas.getByRole('progressbar')
    await expect(bar).not.toHaveAttribute('aria-valuenow')
    await expect(bar).toHaveAttribute('aria-valuetext', expect.stringMatching(/queued/i))
    await expect(canvas.getByText(/import worker picks this up/i)).toBeVisible()
    await expect(canvas.queryByText(/0% complete/)).not.toBeInTheDocument()
  },
}

/**
 * The AI-analysis step: the imported property gets the same consent card as
 * Settings, enabling it records the decision and hands over to insights.
 */
export const ImportedWithAiOnboarding: Story = {
  render: () => {
    const ai = createAiFnsFixture()
    return (
      <ProgressHarness
        ai={ai}
        snapshot={{
          ...processing,
          status: 'completed_with_issues',
          processedCount: 4,
          pollAfterMs: null,
          counts: { ...processing.counts, pending: 0, imported: 3 },
        }}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = within(canvas.getByRole('navigation', { name: /import steps/i }))
    await expect(steps.getByText('AI analysis')).toHaveAttribute('aria-current', 'page')
    const propertyLinks = canvas.getAllByRole('link', {
      name: /view property the meridian grand resort/i,
    })
    await expect(propertyLinks.some((link) => link.checkVisibility())).toBe(true)

    await consentToAi(canvasElement)

    await expect(
      canvas.findByText(/ai analysis is on for the meridian grand resort/i),
    ).resolves.toBeVisible()
    await expect(canvas.getByRole('link', { name: /view insights/i })).toBeVisible()
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

/** Declining keeps the property exactly as an import without this step would. */
export const AiOnboardingSkipped: Story = {
  render: () => (
    <ProgressHarness
      ai={createAiFnsFixture()}
      snapshot={{
        ...processing,
        status: 'completed',
        processedCount: 4,
        pollAfterMs: null,
        counts: { ...processing.counts, pending: 0, imported: 4, failed: 0 },
        items: [processing.items[0]!],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', {
        name: /not now for the meridian grand resort/i,
      }),
    )
    await expect(canvas.getByText(/ai analysis stays off/i)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /reconsider/i }))
    await expect(
      canvas.findByLabelText(/confirm with your password/i),
    ).resolves.toBeVisible()
  },
}

/** A property that already consented shows the hand-off, not a second card. */
export const AiAlreadyEnabled: Story = {
  render: () => (
    <ProgressHarness
      ai={createAiFnsFixture(aiEnabled)}
      snapshot={{
        ...processing,
        status: 'completed',
        processedCount: 1,
        totalCount: 1,
        pollAfterMs: null,
        counts: { ...processing.counts, pending: 0, imported: 0, relinked: 1, failed: 0 },
        items: [
          {
            ...processing.items[0]!,
            action: 'relink',
            status: 'relinked',
            outcomeCode: 'relinked',
            messageKey: 'property_import.relinked',
          },
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText(/ai analysis is on for/i)).resolves.toBeVisible()
    await expect(
      canvas.queryByLabelText(/confirm with your password/i),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(aiFns.enableMerchantAi).not.toHaveBeenCalled())
  },
}

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
      canvas.getByText(label).nextElementSibling?.textContent

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
