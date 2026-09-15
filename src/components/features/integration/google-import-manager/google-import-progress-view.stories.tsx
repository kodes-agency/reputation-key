import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import { SetupPropertiesStep } from '#/components/features/property-setup'
import {
  createSetupFnsFixture,
  STORY_ADMIN,
  STORY_MANAGER,
  type StorySetupProperty,
} from '#/components/features/property-setup/setup.stories.fixtures'
import { GoogleImportProgressView } from './google-import-progress-view'
import { importedPropertiesForAi } from './google-import-progress-model'

const MERIDIAN: StorySetupProperty = {
  propertyId: '10000000-0000-4000-8000-000000000011',
  name: 'The Meridian Grand Resort',
  countryCode: 'GB',
}

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
    invalidProfileField: null,
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
    invalidProfileField: null,
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
  property = MERIDIAN,
}: {
  snapshot?: ImportProgressDto
  property?: StorySetupProperty
}) {
  const [retried, setRetried] = useState(false)
  const [fns] = useState(() => createSetupFnsFixture({ properties: [property] }))
  return (
    <>
      <GoogleImportProgressView
        progress={snapshot}
        setupStep={
          <SetupPropertiesStep
            properties={importedPropertiesForAi(snapshot)}
            fns={fns}
            viewerUserId={STORY_ADMIN.userId}
          />
        }
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
  args: { setupStep: null },
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
 * The import settled with a property: the wizard's last step opens under the
 * summary, and the import's rows stay open because one needs attention.
 */
export const ImportedThenSetUp: Story = {
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
    await expect(
      canvas.findByRole('heading', { name: 'Set up properties' }),
    ).resolves.toBeVisible()
    await expect(
      canvas.findByRole('textbox', { name: 'Public display name' }),
    ).resolves.toHaveValue('The Meridian Grand Resort')
    const propertyLinks = canvas.getAllByRole('link', {
      name: /view property the meridian grand resort/i,
    })
    await expect(propertyLinks.some((link) => link.checkVisibility())).toBe(true)
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

/** Without issues the finished rows fold away behind "Import details". */
export const ImportDetailsFolded: Story = {
  render: () => (
    <ProgressHarness
      snapshot={{
        ...processing,
        status: 'completed',
        processedCount: 1,
        totalCount: 1,
        pollAfterMs: null,
        counts: { ...processing.counts, pending: 0, imported: 1, failed: 0 },
        items: [processing.items[0]!],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole('link', { name: /view property the meridian grand resort/i }),
    ).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /import details/i }))
    const propertyLinks = await canvas.findAllByRole('link', {
      name: /view property the meridian grand resort/i,
    })
    await expect(propertyLinks.some((link) => link.checkVisibility())).toBe(true)
  },
}

/** A relinked property that is already configured is not asked again. */
export const RelinkedPropertyAlreadySetUp: Story = {
  render: () => (
    <ProgressHarness
      property={{
        ...MERIDIAN,
        publicDisplayNameConfirmed: true,
        defaultReplyLanguage: 'en-Latn',
        aiEnabled: true,
        managerIds: [STORY_MANAGER.userId],
      }}
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
    await expect(canvas.findByText('Nothing left to ask')).resolves.toBeVisible()
    await expect(canvas.queryByRole('radio')).toBeNull()
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

/**
 * The Property context rejected a confirmed detail. The row names the field and
 * sends the manager back to import the location again; a retry could not help.
 */
export const RejectedProfile: Story = {
  render: () => (
    <ProgressHarness
      snapshot={{
        ...processing,
        status: 'failed',
        totalCount: 1,
        processedCount: 1,
        pollAfterMs: null,
        canRetry: false,
        counts: { ...processing.counts, pending: 0, imported: 0, failed: 1 },
        items: [
          {
            ...items[1]!,
            outcomeCode: 'tenant_profile_invalid',
            messageKey: 'property_import.tenant_profile_invalid',
            retryable: false,
            userAction: 'none',
            invalidProfileField: 'timezone',
          },
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const messages = canvas.getAllByText(
      'The timezone was rejected. Choose a valid timezone and import this location again.',
    )
    await expect(messages.some((message) => message.checkVisibility())).toBe(true)
    const links = canvas.getAllByRole('link', {
      name: /import juniper street café again/i,
    })
    await expect(links[0]).toHaveAttribute('href', '/properties/import-google')
    await expect(canvas.queryByRole('button', { name: /retry/i })).toBeNull()
  },
}

/**
 * A location that was already bound links to the Property that holds it. It is
 * not this import's Property, so the import has nothing to set up.
 */
export const AlreadyLinkedProperty: Story = {
  render: () => (
    <ProgressHarness
      snapshot={{
        ...processing,
        status: 'completed_with_issues',
        totalCount: 1,
        processedCount: 1,
        pollAfterMs: null,
        canRetry: false,
        counts: {
          ...processing.counts,
          pending: 0,
          imported: 0,
          failed: 0,
          already_exists: 1,
        },
        items: [
          {
            ...items[0]!,
            status: 'already_exists',
            outcomeCode: 'already_exists',
            messageKey: 'property_import.already_exists',
            propertyId: '10000000-0000-4000-8000-000000000031',
          },
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const links = canvas.getAllByRole('link', {
      name: /view the existing property for the meridian grand resort/i,
    })
    await expect(links[0]).toHaveAttribute(
      'href',
      '/properties/10000000-0000-4000-8000-000000000031',
    )
    await expect(canvas.queryByRole('heading', { name: 'Set up properties' })).toBeNull()
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
