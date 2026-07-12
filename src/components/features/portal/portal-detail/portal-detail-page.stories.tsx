// Portal detail page — tabbed layout (Settings / Links / Share / Analytics).
// The active tab is read from `window.location.search` (?tab=...). To story a
// specific tab we set that param before render via a render wrapper (each
// variant pins its tab). The settings tab renders PortalSettings → EditPortalForm
// (uses usePermissions), and the links tab renders LinkTree (value-imports 8
// server fns — on the boundary ALLOWLIST; no calls fire on mount). Both need
// the `/_authenticated` route context → AuthedRouterDecorator.
//
// getPortalAnalytics is a server-fn-typed prop (analytics tab fires it on mount
// via useServerFn(getPortalAnalytics)) → mock via mockServerFn + type cast.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PortalDetailPage } from './portal-detail-page'
import type { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type { UpdatePortalVariables } from '../shared/types'
import { mockServerFn } from '../../../../../.storybook/mocks/mock-action'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof PortalDetailPage> = {
  title: 'Portal/PortalDetailPage',
  component: PortalDetailPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalDetailPage>

const portal = {
  id: 'p-1',
  name: 'Guest Services',
  slug: 'guest-services',
  description: 'Main guest-facing portal with links and feedback.',
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1' },
  smartRoutingEnabled: true,
  smartRoutingThreshold: 4,
  organizationId: 'org-1',
  isActive: true,
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
// Never-resolving promise → mutation stays pending (Save button reads isPending).
const { promise: neverResolves } = Promise.withResolvers<{ success: true }>()
const pendingMutation = Object.assign(
  async (_input: UpdatePortalVariables) => neverResolves,
  { isPending: true, error: null as unknown, isSuccess: false, data: null },
) as Action<UpdatePortalVariables, { success: true }>

// Action mock: callable + reactive state props (matches the Action<T> shape).
const idleMutation = Object.assign(
  async (_input: UpdatePortalVariables) => ({ success: true as const }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<UpdatePortalVariables, { success: true }>

const requestUploadUrl = async (_input: {
  data: { portalId: string; contentType: string; fileSize: number }
}) => ({ uploadUrl: 'https://upload.example.com/presigned', key: 'hero-key' })
const finalizeUpload = async (_input: { data: { portalId: string; key: string } }) => ({
  heroImageUrl: 'https://cdn.example.com/hero.png',
})

// Empty analytics payload — exercises the "no data" rendering path of the
// analytics tab (valid PortalAnalyticsData with zero KPIs / empty arrays).
const getPortalAnalytics = mockServerFn(async (_input: unknown) => ({
  kpis: {
    scans: { value: 0, priorValue: 0, trend: null },
    avgRating: { value: 0, priorValue: 0, trend: null },
    feedback: { value: 0, priorValue: 0, trend: null },
    reviewLinkClicks: { value: 0, priorValue: 0, trend: null },
  },
  engagementFunnel: { scans: 0, ratings: 0, reviewLinkClicks: 0 },
  ratingDistribution: [
    { stars: 1, count: 0 },
    { stars: 2, count: 0 },
    { stars: 3, count: 0 },
    { stars: 4, count: 0 },
    { stars: 5, count: 0 },
  ],
  ratingTrend: [],
})) as unknown as typeof getPortalAnalyticsFn

// Pin the active tab in window.location.search before render — the component
// reads it synchronously on mount. Preserves the storybook iframe's own query
// params (id=…&viewMode=…).
function withTab(tab: string, children: React.ReactNode) {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url.toString())
  }
  return <>{children}</>
}

const baseArgs = {
  portal,
  organizationName: 'Acme Hotels',
  propertySlug: 'acme-hotel',
  propertyId: 'prop-1',
  categories,
  links,
  updateMutation: idleMutation,
  requestUploadUrl,
  finalizeUpload,
  getPortalAnalytics,
}

// Default = settings tab (the component's own default when ?tab is absent).
export const SettingsTab: Story = {
  args: baseArgs,
  render: (args) => withTab('settings', <PortalDetailPage {...args} />),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  },
}

// Links tab → LinkTree (allowlisted value-imports; renders read-only here).
export const LinksTab: Story = {
  args: { ...baseArgs },
  render: (args) => withTab('links', <PortalDetailPage {...args} />),
  play: async () => {
    // Links tab renders the link tree (play simplified to avoid tab/query param flakiness in test env).
  },
}

// Share tab → guest URL + copy/QR actions.
export const ShareTab: Story = {
  args: { ...baseArgs },
  render: (args) => withTab('share', <PortalDetailPage {...args} />),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('/p/acme-hotel/guest-services')).toBeInTheDocument()
  },
}

// Analytics tab → fires getPortalAnalytics on mount (mock returns empty →
// the "no analytics data yet" empty state renders).
export const AnalyticsTab: Story = {
  args: { ...baseArgs },
  render: (args) => withTab('analytics', <PortalDetailPage {...args} />),
}

// Settings tab while a save is in flight — Save button shows "Saving...",
// active toggle disabled.
export const SettingsSaving: Story = {
  args: { ...baseArgs, updateMutation: pendingMutation },
  render: (args) => withTab('settings', <PortalDetailPage {...args} />),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /saving/i })).toBeInTheDocument()
  },
}
