import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import {
  createSetupFnsFixture,
  STORY_ADMIN,
} from '#/components/features/property-setup/setup.stories.fixtures'
import type {
  GoogleConnectionDto,
  ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import { GoogleImportManager } from './google-import-manager'
import type { GoogleImportFns } from './google-import-manager-contract'

const ORGANIZATION_ID = 'org-story'
const IMPORTED_PROPERTY_ID = '10000000-0000-4000-8000-000000000011'
const IMPORT_JOB_ID = '10000000-0000-4000-8000-000000000001'

const connection: GoogleConnectionDto = {
  id: '10000000-0000-4000-8000-000000000003',
  organizationId: ORGANIZATION_ID,
  accountEmail: 'reviews@meridian-hotels.example',
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
      invalidProfileField: null,
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
    setupFns: createSetupFnsFixture({
      properties: [
        { propertyId: IMPORTED_PROPERTY_ID, name: 'Studio Priority', countryCode: 'FR' },
      ],
    }),
    viewerUserId: STORY_ADMIN.userId,
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
    await expect(
      canvas.getByRole('progressbar', { name: /google property import progress/i }),
    ).toHaveAttribute('aria-valuenow', '100')
    await expect(
      canvas.queryByText(/google location details were cleared/i),
    ).not.toBeInTheDocument()
    const current = canvas.getByRole('tab', { selected: true })
    await expect(current).toHaveAccessibleName(/set up properties/i)
    await expect(
      canvas.findByText(/use french/i, {}, { timeout: 5_000 }),
    ).resolves.toBeVisible()
    // The finished import folds away; its rows are one click from the setup.
    await userEvent.click(canvas.getByRole('button', { name: /import details/i }))
    // Desktop table and mobile cards both render the row; one is visible.
    const propertyLinks = await canvas.findAllByRole('link', {
      name: /view property studio priority/i,
    })
    await expect(propertyLinks.some((link) => link.checkVisibility())).toBe(true)
  },
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const lease = {
  leaseRef: 'lease.story',
  expiresAt: FUTURE,
  ttlSeconds: 30,
  renewAfterMs: 10_000,
} as const
const discoveryFns = {
  ...importFns,
  listImportAccounts: fn(async () => ({
    items: [
      { accountRef: 'account.north', displayName: 'North region', role: 'primary_owner' },
    ],
    nextCursor: null,
    contentExpiresAt: FUTURE,
    authorizationLease: lease,
    contentTtlSeconds: 86_400,
  })),
  listImportCandidates: fn(async () => ({
    items: [],
    nextCursor: null,
    contentExpiresAt: FUTURE,
    authorizationLease: lease,
    contentTtlSeconds: 86_400,
  })),
  renewImportAuthorizationLease: fn(async () => lease),
} as unknown as GoogleImportFns

/**
 * Opening the import page with a connected Google account lists its Business
 * Profile accounts on the first visit. Under StrictMode the discovery hook's
 * mount, cleanup and re-mount must not turn that first answer into "no accounts".
 */
export const DiscoveryListsAccounts: Story = {
  args: { importFns: discoveryFns, initialConnectionId: connection.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.findByRole('button', { name: /north region/i }, { timeout: 5_000 }),
    ).resolves.toBeVisible()
    await expect(
      canvas.queryByText(/no accessible business profile accounts were found/i),
    ).toBeNull()
    // The connection is named by its Google account, not "Organization Google account".
    await expect(
      canvas.getByRole('combobox', { name: /connected google account/i }),
    ).toHaveTextContent('reviews@meridian-hotels.example')
  },
}

const confirmFns = {
  ...discoveryFns,
  listImportCandidates: fn(async () => ({
    items: [
      {
        candidateId: 'candidate-juniper',
        candidateRef: 'candidate.juniper',
        accountRef: 'account.north',
        accountDisplayName: 'North region',
        businessName: 'Juniper Street Café',
        address: '14 Rue de Rivoli, Paris',
        primaryCategory: 'Cafe',
        countryCode: 'FR',
        eligibility: { kind: 'create' },
      },
    ],
    nextCursor: null,
    contentExpiresAt: FUTURE,
    authorizationLease: lease,
    contentTtlSeconds: 86_400,
  })),
} as unknown as GoogleImportFns

/**
 * The Google connection belongs to choosing the account and its locations. On
 * Confirm details it steps aside so the screen is only the chosen properties,
 * and going back to the locations brings it back.
 */
export const ConfirmDetailsHidesTheConnection: Story = {
  args: { importFns: confirmFns, initialConnectionId: connection.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: /north region/i }, { timeout: 5_000 }),
    )
    const [location] = await canvas.findAllByRole(
      'checkbox',
      { name: /select juniper street café/i },
      { timeout: 5_000 },
    )
    await userEvent.click(location!)
    await expect(canvas.getByText('Google Business Profile connection')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: /review 1 property/i }))
    await expect(
      canvas.findByRole('heading', { name: 'Confirm details' }),
    ).resolves.toBeVisible()
    await expect(canvas.getByRole('tab', { selected: true })).toHaveAccessibleName(
      /confirm details/i,
    )
    await expect(canvas.queryByText('Google Business Profile connection')).toBeNull()
    await expect(
      canvas.queryByRole('combobox', { name: /connected google account/i }),
    ).toBeNull()
    // One property: its own timezone field is the only one on the screen.
    await expect(
      canvas.queryByRole('combobox', { name: /timezone for all rows/i }),
    ).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: /back to locations/i }))
    await expect(
      canvas.getByRole('combobox', { name: /connected google account/i }),
    ).toBeVisible()
  },
}
