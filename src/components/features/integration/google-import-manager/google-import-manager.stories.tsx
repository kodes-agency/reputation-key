import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type {
  GoogleConnectionDto,
  ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import {
  createAiFnsFixture,
  IMPORTED_PROPERTY_ID,
} from './google-import-ai.stories.fixtures'
import { GoogleImportManager } from './google-import-manager'
import type { GoogleImportFns } from './google-import-manager-contract'

const ORGANIZATION_ID = 'org-story'
const IMPORT_JOB_ID = '10000000-0000-4000-8000-000000000001'

const connection: GoogleConnectionDto = {
  id: '10000000-0000-4000-8000-000000000003',
  organizationId: ORGANIZATION_ID,
  scopes: ['https://www.googleapis.com/auth/business.manage'],
  connectedBy: 'user-story',
  visibility: 'organization',
  status: 'active',
  createdAt: new Date('2026-08-12T10:00:00.000Z'),
  updatedAt: new Date('2026-08-12T10:00:00.000Z'),
}

const completed: ImportProgressDto = {
  contractVersion: 3,
  importJobId: IMPORT_JOB_ID,
  requestId: '10000000-0000-4000-8000-000000000002',
  status: 'completed',
  totalCount: 1,
  processedCount: 1,
  counts: {
    pending: 0,
    processing: 0,
    imported: 1,
    relinked: 0,
    already_exists: 0,
    failed: 0,
    cancelled: 0,
  },
  items: [
    {
      itemId: '10000000-0000-4000-8000-000000000010',
      propertyName: 'Studio Priority',
      action: 'create',
      status: 'imported',
      outcomeCode: 'imported',
      messageKey: 'property_import.imported',
      retryable: false,
      retryRevision: 0,
      userAction: 'none',
      propertyId: IMPORTED_PROPERTY_ID,
    },
  ],
  canRetry: false,
  pollAfterMs: null,
  purgeAt: '2026-09-11T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
}

// Discovery must stay idle on the progress route: every discovery fn throws so
// a stray call fails the story instead of silently rendering an empty panel.
const neverCalled = (name: string) =>
  fn(async () => {
    throw new Error(`${name} must not be called on the progress route`)
  })
const importFns = {
  getGoogleAuthUrl: neverCalled('getGoogleAuthUrl'),
  listGoogleConnections: neverCalled('listGoogleConnections'),
  listImportAccounts: neverCalled('listImportAccounts'),
  listImportCandidates: neverCalled('listImportCandidates'),
  renewImportAuthorizationLease: neverCalled('renewImportAuthorizationLease'),
  startPropertyImportV2: neverCalled('startPropertyImportV2'),
  recoverPropertyImportV2: neverCalled('recoverPropertyImportV2'),
  getPropertyImportV2Status: fn(async () => completed),
  retryPropertyImportItem: neverCalled('retryPropertyImportItem'),
  cancelPropertyImportV2: neverCalled('cancelPropertyImportV2'),
} as unknown as GoogleImportFns

const meta = {
  title: 'Integration/GoogleImport/Manager',
  component: GoogleImportManager,
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
  args: {
    organizationId: ORGANIZATION_ID,
    connections: [connection],
    importFns,
    aiFns: createAiFnsFixture(),
  },
} satisfies Meta<typeof GoogleImportManager>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The `$importId` route mounts the manager with the import already loaded.
 * Under StrictMode the discovery hook's cleanup used to clear the step back to
 * discovery, so the page the user had just been sent to showed "Google location
 * details were cleared" instead of their import.
 */
export const ProgressRoute: Story = {
  args: { initialProgress: completed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.findByRole('heading', { name: /import complete/i }),
    ).resolves.toBeVisible()
    await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    await expect(
      canvas.queryByText(/google location details were cleared/i),
    ).not.toBeInTheDocument()
    // Desktop table and mobile cards both render the row; one is visible.
    const propertyLinks = canvas.getAllByRole('link', {
      name: /view property studio priority/i,
    })
    await expect(propertyLinks.some((link) => link.checkVisibility())).toBe(true)
    await expect(
      canvas.findByLabelText(/confirm with your password/i),
    ).resolves.toBeVisible()
  },
}
