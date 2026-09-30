// Portal detail page — the tab (and, on the Page tab, the editor section) is
// driven by the owning route's typed search state. Components receive it as
// props, so stories and SSR use the same deterministic state without reading or
// mutating window.location. The workspace layout provides the autosave
// coordinator; the decorator below stands in for it.
//
// getPortalAnalytics is a server-fn-typed prop (analytics tab fires it on mount
// via useServerFn(getPortalAnalytics)) → mock via mockServerFn + type cast.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PortalDetailPage } from './portal-detail-page'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import type {
  getPortalAnalyticsFn,
  PortalAnalyticsData,
} from '#/contexts/reporting/server/portal-analytics'
import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  UpdatePortalVariables,
} from '../shared/types'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import { mockServerFn } from '../../../../../.storybook/mocks/mock-action'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof PortalDetailPage> = {
  title: 'Portal/PortalDetailPage',
  component: PortalDetailPage,
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
type Story = StoryObj<typeof PortalDetailPage>

const portal = {
  id: 'p-1',
  name: 'Guest Services',
  slug: 'guest-services',
  description: 'Main guest-facing portal with links and feedback.',
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  privateFeedbackThreshold: 3,
  propertyId: 'prop-1',
  organizationId: 'org-1',
  publicationState: 'published' as const,
}

const categories: readonly LinkTreeCategory[] = [
  { id: 'cat-1', title: 'Reviews', sortKey: 'a' },
  { id: 'cat-2', title: 'Feedback', sortKey: 'b' },
]
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
}

// Empty analytics payload — exercises the "no data" rendering path of the
// analytics tab (valid PortalAnalyticsData with zero KPIs / empty arrays).
const analyticsComputedAt = new Date('2026-08-25T12:00:00.000Z')
const emptyEvidence = {
  definitionVersionId: 'portal-analytics-story-v1',
  state: 'insufficient_data',
  verifiedThrough: null,
  latestActivity: null,
  computedAt: analyticsComputedAt,
  completeness: 1,
  availabilityReason: 'no_eligible_sample',
  correctionHead: null,
  sampleCount: 0,
} as const
const emptyAnalytics: PortalAnalyticsData = {
  period: {
    startAt: new Date('2026-07-26T00:00:00.000Z'),
    endAt: analyticsComputedAt,
    timezone: 'Europe/Sofia',
  },
  qualifiedScansSince: new Date('2026-08-01T00:00:00.000Z'),
  lifetimeReconciliation: null,
  kpis: {
    scans: { value: 0, priorValue: null, trend: null, evidence: emptyEvidence },
    avgRating: {
      value: null,
      priorValue: null,
      comparison: null,
      sampleCount: 0,
      priorSampleCount: 0,
      evidence: emptyEvidence,
    },
    feedback: { value: 0, priorValue: null, trend: null, evidence: emptyEvidence },
    ratings: { value: 0, priorValue: null, trend: null, evidence: emptyEvidence },
    googleOpens: { value: 0, priorValue: null, trend: null, evidence: emptyEvidence },
  },
  engagementFunnel: null,
  ratingDistribution: [
    { stars: 1, count: 0 },
    { stars: 2, count: 0 },
    { stars: 3, count: 0 },
    { stars: 4, count: 0 },
    { stars: 5, count: 0 },
  ],
  ratingTrend: [],
  responseIntegrity: {
    accepted: 0,
    filteredAutomatically: 0,
    underReview: 0,
    total: 0,
  },
}
const getPortalAnalytics = mockServerFn(
  async (_input: unknown) => emptyAnalytics,
) as unknown as typeof getPortalAnalyticsFn

const baseArgs = {
  portal,
  organizationName: 'Acme Hotels',
  propertyId: 'prop-1',
  publicationHistory: {
    current: {
      activationSequence: 1,
      version: 1,
      kind: 'publish' as const,
      activatedAt: '2026-08-20T10:00:00.000Z',
      deactivatedAt: null,
      deactivationReason: null,
    },
    priorActivations: [],
    hasPendingChanges: false,
    nextCursor: null,
  },
  googleReviewDestination: {
    state: 'verified' as const,
    retrievedAt: new Date('2026-08-20T10:00:00.000Z'),
  },
  categories,
  links,
  updateMutation: idleMutation,
  autosaveUpdateMutation: idleMutation,
  completeReviewMutation,
  tokenStatus,
  issueTokenMutation,
  rotateTokenMutation,
  revokeTokenMutation,
  getPortalAnalytics,
  activeTab: 'page' as const,
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

// The palette is chosen from presets and saves itself: one click, one write,
// with no Save button. The page owns the draft, so the preview follows the click.
const paletteSpy = fn(async (_input: UpdatePortalVariables) => ({
  success: true as const,
}))
export const PaletteAutosaves: Story = {
  args: {
    ...baseArgs,
    activeSection: 'look',
    autosaveUpdateMutation: Object.assign(paletteSpy, {
      isPending: false,
      error: null as unknown,
      isSuccess: false,
      data: null,
    }) as unknown as Action<UpdatePortalVariables, { success: true }>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Dark/ }))
    await expect(canvas.getByRole('button', { name: /^Dark/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(
      () =>
        expect(paletteSpy).toHaveBeenCalledWith({
          data: {
            portalId: 'p-1',
            theme: {
              primaryColor: '#a5b4fc',
              backgroundColor: '#111827',
              textColor: '#f9fafb',
            },
          },
        }),
      { timeout: 3000 },
    )
    await expect(paletteSpy).toHaveBeenCalledTimes(1)
  },
}

// The old Settings' Google card is the Rating & Google section now.
export const RatingSection: Story = {
  args: { ...baseArgs, activeSection: 'rating' },
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
  args: { ...baseArgs, activeSection: 'linktree' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Linktree' })).toBeInTheDocument()
    await expect(canvas.getByText('Google Reviews')).toBeInTheDocument()
  },
}

// History tab: the publication history that used to sit inside Settings.
export const HistoryTab: Story = {
  args: { ...baseArgs, activeTab: 'history' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Publication history' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText(/version 1 is live/i)).toBeInTheDocument()
  },
}

// Share tab generates and displays the opaque URL through the route-owned action.
export const ShareTab: Story = {
  args: {
    ...baseArgs,
    activeTab: 'share',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /generate public link/i }))
    await expect(await canvas.findByText(publicUrl)).toBeInTheDocument()
    await expect(canvas.getByText(/save this link now/i)).toBeInTheDocument()
  },
}

// Results tab → fires getPortalAnalytics on mount (mock returns empty →
// the "no analytics data yet" empty state renders).
export const ResultsTab: Story = {
  args: { ...baseArgs, activeTab: 'results' },
}
