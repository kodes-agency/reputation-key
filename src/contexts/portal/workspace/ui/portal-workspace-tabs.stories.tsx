// fallow-ignore-file code-duplication
// The workspace's tab bodies as the route mounts them: the Page tab's editor
// (on the section the route's search names), History and Share. Components
// receive the tab as props, so stories and SSR use the same deterministic state
// without reading or mutating window.location. The workspace layout provides
// the autosave coordinator; the decorator below stands in for it.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { previewReader } from '#/components/features/portal/portal-preview/__fixtures__/portal-preview-fixtures'
import { PortalEditor } from '#/contexts/portal/editor/ui/portal-editor'
import type { PortalEditorSection } from '#/contexts/portal/editor/ui/portal-editor-sections'
import { usePortalLinkIssuance } from '#/components/features/portal/portal-workspace/portal-link-issuance'
import type { PortalHistoryReads } from './portal-history-context'
import { PortalHistorySection } from './portal-history-section'
import { PortalShareSection } from './portal-share-section'
import type { SectionRead } from './portal-read-state'
import { PortalDraftAutosaveProvider } from '#/contexts/portal/editor/ui/portal-draft-autosave-context'
import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeLink } from '#/contexts/portal/editor/ui/link-tree/link-tree-types'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  UpdatePortalVariables,
} from '#/components/features/portal/shared/types'
import type { PortalTokenStatus } from '#/contexts/portal/application/portal-management-contracts'
import type {
  getPortalHistory,
  getPortalPublicationHistory,
} from '#/contexts/portal/server/portals'
import type {
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from '#/contexts/portal/server/portal-versions'
import { storyVersionPreview } from '#/contexts/portal/workspace/ui/__fixtures__/portal-version-preview-stories-data'
import {
  STORY_TIME_ZONE,
  STORY_VERSIONS,
  STORY_VERSION_DETAILS,
  storyHistoryFor,
} from '#/contexts/portal/workspace/ui/__fixtures__/portal-history-stories-data'
import { mockServerFn } from '../../../../../.storybook/mocks/mock-action'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'

/** How far a section's reads have got: the section says so itself until they answer. */
type ReadState = 'ready' | 'loading' | 'failed'

type TabProps = Readonly<{
  tab: 'page' | 'history' | 'share'
  section?: PortalEditorSection
  /** The History and Share sections' reads; the Page tab's editor loads its own. */
  reads?: ReadState
  resources: Parameters<typeof PortalEditor>[0]['resources']
}>

/** A read as a section sees it; a failed one has not answered and offers to try again. */
function readOf<T>(data: T, state: ReadState): SectionRead<T> {
  return {
    data: state === 'ready' ? data : undefined,
    isError: state === 'failed',
    isFetching: state === 'loading',
    errorUpdateCount: state === 'failed' ? 1 : 0,
    refetch: () => Promise.reject(new Error('not read in a story')),
  }
}

function WorkspaceTab({ tab, section, reads = 'ready', resources }: TabProps) {
  const issuance = usePortalLinkIssuance()
  if (tab === 'page') {
    return <PortalEditor resources={resources} requestedSection={section} />
  }
  if (tab === 'history') {
    return (
      <PortalHistorySection
        portal={portal}
        timeZone={STORY_TIME_ZONE}
        reads={historyReadsIn(reads)}
        makeLive={makeVersionLiveMutation}
      />
    )
  }
  return (
    <PortalShareSection
      portal={portal}
      tokenStatus={tokenStatus}
      property={{ timeZone: STORY_TIME_ZONE, countryCode: 'US' }}
      reads={{
        managers: readOf(responsibleManagers, reads),
        members: readOf({ members: [] }, reads),
      }}
      commands={{
        issueToken: issueTokenMutation,
        rotateToken: rotateTokenMutation,
        revokeToken: revokeTokenMutation,
        revealAddress: revealAddressMutation,
      }}
      issuance={issuance}
    />
  )
}

const meta: Meta<typeof WorkspaceTab> = {
  title: 'Portal/WorkspaceTabs',
  component: WorkspaceTab,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <Story />
      </PortalDraftAutosaveProvider>
    ),
    AuthedRouterDecorator,
  ],
}
export default meta
type Story = StoryObj<typeof WorkspaceTab>

const portal = {
  id: 'p-1',
  name: 'Guest Services',
  slug: 'guest-services',
  description: 'Main guest-facing portal with links and feedback.',
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  privateFeedbackThreshold: 3,
  skipPrivateRating: false,
  propertyId: 'prop-1',
  organizationId: 'org-1',
  publicationState: 'published' as const,
}

const links: readonly LinkTreeLink[] = [
  {
    id: 'l-1',
    label: 'Google Reviews',
    url: 'https://google.com',
    sortKey: 'a',
    categoryId: 'cat-1',
  },
  {
    id: 'l-2',
    label: 'Tell us how we did',
    url: '#feedback',
    sortKey: 'a',
    categoryId: 'cat-2',
  },
]
// Action mock: callable + reactive state props (matches the Action<T> shape).
const idleMutation = Object.assign(
  async (_input: UpdatePortalVariables) => ({ success: true as const }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<UpdatePortalVariables, { success: true }>

const publicUrl = 'https://portal.example/p/opaque-token-shown-once'
const issueTokenMutation = Object.assign(
  async (_input: { data: { portalId: string } }) => ({
    publicUrl,
  }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<{ data: { portalId: string } }, { publicUrl: string }>
const rotateTokenMutation = Object.assign(
  async (_input: {
    data: {
      portalId: string
      replacementKind?: 'planned' | 'security'
      gracePeriodDays?: number
    }
  }) => ({ publicUrl }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<
  {
    data: {
      portalId: string
      replacementKind?: 'planned' | 'security'
      gracePeriodDays?: number
    }
  },
  { publicUrl: string }
>
const revokeTokenMutation = Object.assign(
  async (_input: { data: { portalId: string; reason: string } }) => ({
    revoked: true,
  }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<{ data: { portalId: string; reason: string } }, { revoked: boolean }>
const revealAddressMutation = Object.assign(
  async (_input: {
    data: { portalId: string; purpose: 'download' | 'copy' | 'show' }
  }) => ({
    publicUrl,
  }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<
  { data: { portalId: string; purpose: 'download' | 'copy' | 'show' } },
  { publicUrl: string }
>
const completeReviewMutation = Object.assign(
  async (_input: CompleteReviewVariables) => ({ status: 'recorded' as const }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<CompleteReviewVariables, CompleteReviewResult>

// No token issued yet — the Share tab offers the issue form (C2).
const tokenStatus: PortalTokenStatus = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
  addressRecoverable: false,
  madeBy: null,
}

// The History tab reads on mount, like the Results tab: the reads are handed in
// as server-fn-typed props and answered here from the board 08 ledger.
const historyReads: PortalHistoryReads = {
  getHistory: mockServerFn(async (input: { data: { filter?: string } }) => ({
    entries: storyHistoryFor(input.data.filter ?? 'all'),
    nextCursor: null,
  })) as unknown as typeof getPortalHistory,
  getVersions: mockServerFn(
    async (_input: unknown) => STORY_VERSIONS,
  ) as unknown as typeof getPortalVersions,
  getPublicationHistory: mockServerFn(
    async (_input: unknown) => publicationHistory,
  ) as unknown as typeof getPortalPublicationHistory,
  getVersion: mockServerFn(
    async (input: { data: { version: number } }) =>
      STORY_VERSION_DETAILS[input.data.version],
  ) as unknown as typeof getPortalVersion,
  getVersionPreview: mockServerFn(async (input: { data: { version: number } }) =>
    storyVersionPreview(input.data.version),
  ) as unknown as typeof getPortalVersionPreview,
}
/** The tab's reads in the state a story asks for: none has answered, or the publication history is refused. */
function historyReadsIn(state: ReadState): PortalHistoryReads {
  if (state === 'ready') return historyReads
  const unanswered = () => new Promise<never>(() => {})
  const refused = async () => {
    throw new Error('not read in a story')
  }
  const pending = {
    getHistory: unanswered,
    getVersions: unanswered,
    getVersion: unanswered,
    getPublicationHistory: unanswered,
  }
  return {
    ...historyReads,
    ...(state === 'loading'
      ? (pending as unknown as Partial<PortalHistoryReads>)
      : {
          getPublicationHistory:
            refused as unknown as PortalHistoryReads['getPublicationHistory'],
        }),
  }
}
const makeVersionLiveMutation = Object.assign(async (_input: unknown) => ({}), {
  isPending: false,
  error: null as unknown,
  isSuccess: false,
  data: null,
}) as Action<{ data: { portalId: string; version: number } }, unknown>

const publicationHistory = {
  current: {
    activationSequence: 1,
    version: 1,
    kind: 'publish' as const,
    activatedBy: { userId: 'user-1', displayName: 'Georgi Ivanov' },
    activatedAt: '2026-08-20T10:00:00.000Z',
    deactivatedAt: null,
    deactivationReason: null,
  },
  priorActivations: [],
  hasPendingChanges: false,
  nextCursor: null,
}

const responsibleManagers = {
  assignments: [],
  eligibleManagers: [],
  revision: 1,
  responsibilityNeeded: false,
  responsibilityNeededSince: null,
}

const baseArgs = {
  tab: 'page' as const,
  resources: {
    portal,
    propertyId: 'prop-1',
    publicationHistory,
    googleReviewDestination: {
      state: 'verified' as const,
      retrievedAt: new Date('2026-08-20T10:00:00.000Z'),
    },
    links,
    linktree: {
      portalId: 'p-1',
      enabled: true,
      maxLinks: 4,
      primaryLocale: 'en' as const,
      locales: ['en' as const],
      titles: {},
      links: links.map((link) => ({
        id: link.id,
        categoryId: link.categoryId,
        url: link.url,
        iconKey: null,
        imageAssetId: null,
        sortKey: link.sortKey,
        texts: [
          { locale: 'en' as const, label: link.label, line: null, provenance: null },
        ],
        destination: {
          state: 'approved' as const,
          sourceType: 'recognized' as const,
          approvedByUserId: null,
        },
      })),
    },
    autosaveUpdateMutation: idleMutation,
    changeLanguagesMutation: idleMutation,
    completeReviewMutation,
    getPortalPreview: previewReader(),
  },
}

// The Page tab opens on Welcome: the section list beside the portal's name,
// address and description.
export const PageTab: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument()
    await expect(canvas.getByLabelText('Name')).toHaveValue('Guest Services')
    const nav = within(canvas.getByRole('navigation', { name: 'Editor sections' }))
    await expect(nav.getByRole('link', { name: /welcome/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // The publication toggle moved to Review & publish, and history to its tab.
    await expect(
      canvas.queryByRole('button', { name: /publish portal|disable public page/i }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole('heading', { name: 'Publication history' }),
    ).not.toBeInTheDocument()
  },
}

// The old Settings' Google card is the Rating & Google section now.
export const RatingSection: Story = {
  args: { ...baseArgs, section: 'rating' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Google review destination' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Ready')).toBeInTheDocument()
    await expect(
      canvas.queryByRole('textbox', { name: /google review/i }),
    ).not.toBeInTheDocument()
  },
}

// The old Links tab is the Linktree section: the links are still there.
export const LinktreeSection: Story = {
  args: { ...baseArgs, section: 'linktree' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Linktree' })).toBeInTheDocument()
    await expect(canvas.getByText('Google Reviews')).toBeInTheDocument()
  },
}

// History tab: the ledger and the Versions rail, read on mount (board 08).
export const HistoryTab: Story = {
  args: { ...baseArgs, tab: 'history' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('list', { name: /history, newest first/i }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { name: 'Versions' })).toBeInTheDocument()
    await expect(
      await canvas.findByRole('button', { name: /^Version 5, live now/ }),
    ).toBeInTheDocument()
  },
}

// Share tab generates and displays the opaque URL through the route-owned action.
export const ShareTab: Story = {
  args: { ...baseArgs, tab: 'share' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /make code/i }))
    await expect(await canvas.findByText(publicUrl)).toBeInTheDocument()
    await expect(canvas.getByText(/save this address now/i)).toBeInTheDocument()
  },
}

// A part that is still reading says so itself, in its own place.
export const HistoryLoading: Story = {
  args: { ...baseArgs, tab: 'history', reads: 'loading' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Versions' })).toBeInTheDocument()
    await expect(
      canvas.queryByRole('list', { name: /history, newest first/i }),
    ).toBeNull()
    await expect(canvas.queryByRole('alert')).toBeNull()
  },
}

// A publication history that cannot be read says so in the Versions rail and
// offers to try again; the ledger and the rest of the workspace are untouched.
export const HistoryReadFailed: Story = {
  args: { ...baseArgs, tab: 'history', reads: 'failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('The publication history couldn’t be loaded.'),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /try again/i })).toBeEnabled()
    await expect(
      await canvas.findByRole('list', { name: /history, newest first/i }),
    ).toBeInTheDocument()
  },
}

export const ShareLoading: Story = {
  args: { ...baseArgs, tab: 'share', reads: 'loading' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('status', { name: 'Loading sharing details' }),
    ).toBeInTheDocument()
  },
}

export const ShareReadFailed: Story = {
  args: { ...baseArgs, tab: 'share', reads: 'failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('The sharing details couldn’t be loaded.'),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /try again/i })).toBeEnabled()
  },
}
