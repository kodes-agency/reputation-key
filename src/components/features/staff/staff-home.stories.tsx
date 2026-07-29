// Staff home — the staff landing page (/home). The route component
// (src/routes/_authenticated/home.tsx) is composition-only: every data/state
// decision lives in the useStaffHomeData hook (five suspense queries via the
// fns prop channel + decideStaffHomeEmptyState), and the route itself is not
// storyable (it reads Route.useSearch() from the real route tree). These
// stories therefore drive the REAL hook with in-memory fns and render the
// same section composition the page renders (mirrored in StaffHomeHarness).
//
// States: Populated (KPIs + badges + goals + recent activity), Loading
// (suspense pending), Empty (property selected but no portal assignments →
// StaffEmptyState), Error (a query rejects → error boundary).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { Component, Suspense, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useStaffHomeData, type StaffHomeFns } from './use-staff-home-data'
import { StaffHomeKpis } from './staff-home-kpis'
import { StaffGoalSummary } from './staff-goal-summary'
import { StaffPortalFilter } from './staff-portal-filter'
import { StaffRecentActivity } from './staff-recent-activity'
import { StaffEmptyState } from './staff-empty-state'
import { StaffBadgeSummary } from '#/components/features/badges/staff-badge-summary'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Skeleton } from '#/components/ui/skeleton'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { AlertCircle } from 'lucide-react'
import { mockServerFn } from '../../../../.storybook/mocks/mock-action'
import type { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import type { getStaffDashboardDataFn } from '#/contexts/dashboard/server/staff-dashboard'
import type { listStaffPortals } from '#/contexts/staff/server/staff-portals'
import type { getStaffRecentActivity } from '#/contexts/review/server/staff-recent-activity'
import type { getStaffVisibleBadges } from '#/contexts/badge/server/badges'
import type { KPIs } from '#/contexts/dashboard/application/public-api'
import type { Goal, GoalProgress } from '#/contexts/goal/application/public-api'
import type { StaffPortalEntry } from '#/contexts/staff/application/public-api'
import type { BadgeAwardWithTarget } from '#/contexts/badge/application/public-api'
import type { StaffRecentReview } from '#/contexts/review/application/public-api'
import {
  badgeId,
  goalId,
  goalProgressId,
  organizationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

// ── Fixtures ────────────────────────────────────────────────────────

const PROPERTY_ID = propertyId('prop-00000000-0000-0000-0000-000000000051')
const ORG_ID = organizationId('org-00000000-0000-0000-0000-000000000051')
const PORTAL_ID = portalId('portal-00000000-0000-0000-0000-000000000051')

const populatedKpis: KPIs = {
  reviews: { value: 42, priorValue: 35, trend: 20 },
  avgRating: { value: 4.3, priorValue: 4.1, trend: 4.9 },
  scans: { value: 128, priorValue: 140, trend: -8.6 },
  feedback: { value: 7, priorValue: 5, trend: 40 },
}

const portals: ReadonlyArray<StaffPortalEntry> = [
  { id: PORTAL_ID, name: 'Front Desk' },
  { id: portalId('portal-00000000-0000-0000-0000-000000000052'), name: 'Housekeeping' },
]

let goalSeq = 0
function makeGoal(overrides: Partial<Goal> & Pick<Goal, 'name'>): Goal {
  goalSeq += 1
  return {
    id: goalId(`goal-${String(goalSeq).padStart(3, '0')}`),
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    portalId: PORTAL_ID,
    portalGroupId: null,
    description: null,
    createdBy: userId('user-00000000-0000-0000-0000-000000000051'),
    goalType: 'one_shot',
    aggregationFunction: 'sum',
    metricKey: 'portal.scan',
    targetValue: 50,
    status: 'active',
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-31T23:59:59Z'),
    recurrenceRule: null,
    rollingWindowDays: null,
    parentGoalId: null,
    completedAt: null,
    createdAt: new Date('2026-06-15T09:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  }
}

function withProgress(goal: Goal, currentValue: number) {
  const progress: GoalProgress = {
    id: goalProgressId(`gp-${goal.id}`),
    goalId: goal.id,
    organizationId: ORG_ID,
    currentValue,
    currentSum: currentValue,
    currentCount: currentValue,
    lastComputedAt: new Date('2026-07-12T12:00:00Z'),
    computedSource: 'event_increment',
  }
  return { goal, progress }
}

const goals = [
  withProgress(makeGoal({ name: 'July scan drive', targetValue: 80 }), 46),
  withProgress(
    makeGoal({ name: 'Review link clicks', metricKey: 'portal.review_link_click' }),
    31,
  ),
]

function makeBadge(key: string, name: string, icon: string): BadgeAwardWithTarget {
  const definitionId = badgeId(`badge-def-${key}`)
  return {
    award: {
      id: badgeId(`badge-award-${key}`),
      badgeDefinitionId: definitionId,
      criteriaVersion: 1,
      targetType: 'portal',
      targetId: PORTAL_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      portalId: PORTAL_ID,
      portalGroupId: null,
      awardedAt: new Date('2026-07-10T00:00:00Z'),
      uniqueKey: `${key}-2026-07`,
      createdAt: new Date('2026-07-10T00:00:00Z'),
    },
    definition: {
      id: definitionId,
      key,
      name,
      description: `${name} badge`,
      icon,
      targetScope: 'portal',
      criteriaVersion: 1,
      criteria: {
        type: 'threshold',
        metricKey: 'portal.scan',
        operator: '>=',
        threshold: 50,
      },
      enabled: true,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    },
    targetType: 'portal',
    targetId: PORTAL_ID,
    label: 'Front Desk',
  }
}

const badges: ReadonlyArray<BadgeAwardWithTarget> = [
  makeBadge('scan-starter', 'Scan Starter', '🏅'),
]

const recentReviews: ReadonlyArray<StaffRecentReview> = [
  {
    id: 'rev-0001',
    rating: 5,
    snippet: 'Check-in was fast and the front desk team was wonderful.',
    date: '2026-07-20T14:30:00Z',
  },
  {
    id: 'rev-0002',
    rating: 4,
    snippet: 'Clean rooms, would stay again.',
    date: '2026-07-18T09:15:00Z',
  },
]

// server-fn types carry createServerFn metadata the hook never reads; the
// double cast bridges that unexpressible brand (same justification as
// .storybook/in-memory/inbox-fns.ts).
const populatedFns: StaffHomeFns = {
  listStaffGoals: mockServerFn(async () => ({
    goals,
  })) as unknown as typeof listStaffGoals,
  getStaffDashboardData: mockServerFn(async () => ({
    kpis: populatedKpis,
    hasAssignments: true,
  })) as unknown as typeof getStaffDashboardDataFn,
  listStaffPortals: mockServerFn(async () => ({
    portals,
  })) as unknown as typeof listStaffPortals,
  getStaffRecentActivity: mockServerFn(async () => ({
    reviews: recentReviews,
  })) as unknown as typeof getStaffRecentActivity,
  getStaffVisibleBadges: mockServerFn(
    async () => badges,
  ) as unknown as typeof getStaffVisibleBadges,
}

// ── Harness ─────────────────────────────────────────────────────────
//
// Mirrors the section composition of src/routes/_authenticated/home.tsx; the
// empty-state decision itself lives in the hook (decideStaffHomeEmptyState).
function StaffHomeHarness({
  fns,
  searchPropertyId,
  searchPortalId,
}: {
  fns: StaffHomeFns
  searchPropertyId: string
  searchPortalId?: string
}) {
  const { kpis, portals, goals, badges, recentReviews, emptyState } = useStaffHomeData(
    searchPropertyId,
    searchPortalId,
    fns,
  )

  if (emptyState) {
    return (
      <PageShell>
        <PageHeader title="Home" description="Your performance at a glance." />
        <StaffEmptyState />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="Home"
        description="Your performance at a glance."
        actions={
          <StaffPortalFilter
            portals={portals}
            activePortalId={searchPortalId}
            searchPropertyId={searchPropertyId}
          />
        }
      />

      {kpis && <StaffHomeKpis kpis={kpis} />}

      <StaffBadgeSummary badges={badges} />

      <StaffGoalSummary goals={goals} />

      <StaffRecentActivity reviews={recentReviews} />
    </PageShell>
  )
}

// Loading fallback mirroring DefaultPendingComponent in src/router.tsx (not
// exported) — role="status" added so the state is assertable/accessibly named.
function HomePendingFallback() {
  return (
    <div className="page-wrap px-4 pb-8 pt-14" role="status" aria-label="Loading">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  )
}

// Error fallback mirroring DefaultErrorComponent in src/router.tsx (not
// exported). Retry resets the boundary so the query mounts again.
class HomeErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page-wrap px-4 pb-8 pt-14">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              {this.state.error.message || 'Something went wrong loading this page.'}
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

// Fresh QueryClient per story: the preview-level client has staleTime/gcTime
// Infinity, which would leak one story's cached queries into the next.
function FreshQueryClientDecorator(Story: () => ReactNode) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

const meta: Meta<typeof StaffHomeHarness> = {
  title: 'Staff/Home',
  component: StaffHomeHarness,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [FreshQueryClientDecorator],
  render: (args) => (
    <HomeErrorBoundary>
      <Suspense fallback={<HomePendingFallback />}>
        <StaffHomeHarness {...args} />
      </Suspense>
    </HomeErrorBoundary>
  ),
}
export default meta
type Story = StoryObj<typeof StaffHomeHarness>

const SEARCH_PROPERTY_ID = 'prop-00000000-0000-0000-0000-000000000051'

// Populated — assigned portals, KPIs, badges, goals and recent reviews all
// render through the real hook.
export const Populated: Story = {
  args: { fns: populatedFns, searchPropertyId: SEARCH_PROPERTY_ID },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Reviews')).toBeVisible()
    await expect(canvas.getByText('Avg Rating')).toBeVisible()
    await expect(canvas.getByText('Scans')).toBeVisible()
    await expect(canvas.getByText('Feedback')).toBeVisible()
    // Badge summary.
    await expect(canvas.getByText('Scan Starter')).toBeVisible()
    // Goals.
    await expect(canvas.getByText('July scan drive')).toBeVisible()
    // Recent activity.
    await expect(
      canvas.getByText(/check-in was fast and the front desk team was wonderful/i),
    ).toBeVisible()
    // Portal filter offers the assigned portals.
    await expect(canvas.getByRole('combobox')).toBeVisible()
  },
}

// BQC-6.8: light-theme variant of the populated surface — the a11y gate runs
// on it too, so light-mode contrast is proven (the dark primary was tuned for
// dark; light surfaces need their own axe pass).
export const PopulatedLight: Story = {
  args: { fns: populatedFns, searchPropertyId: SEARCH_PROPERTY_ID },
  parameters: { theme: 'light' },
}

// Loading — a pending suspense query keeps the page in the pending fallback.
export const Loading: Story = {
  args: {
    searchPropertyId: SEARCH_PROPERTY_ID,
    fns: {
      ...populatedFns,
      listStaffGoals: mockServerFn(
        async () => new Promise<{ goals: typeof goals }>(() => {}),
      ) as unknown as typeof listStaffGoals,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toBeVisible()
    // Settled state must not appear while the query is pending.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(canvas.queryByText('Reviews')).toBeNull()
  },
}

// Empty — property selected but no portal assignments → the hook reports
// 'no-assignments' and the page renders StaffEmptyState.
export const Empty: Story = {
  args: {
    searchPropertyId: SEARCH_PROPERTY_ID,
    fns: {
      ...populatedFns,
      getStaffDashboardData: mockServerFn(async () => ({
        kpis: {
          reviews: { value: 0, priorValue: 0, trend: null },
          avgRating: { value: 0, priorValue: 0, trend: null },
          scans: { value: 0, priorValue: 0, trend: null },
          feedback: { value: 0, priorValue: 0, trend: null },
        },
        hasAssignments: false,
      })) as unknown as typeof getStaffDashboardDataFn,
      listStaffPortals: mockServerFn(async () => ({
        portals: [],
      })) as unknown as typeof listStaffPortals,
      listStaffGoals: mockServerFn(async () => ({
        goals: [],
      })) as unknown as typeof listStaffGoals,
      getStaffRecentActivity: mockServerFn(async () => ({
        reviews: [],
      })) as unknown as typeof getStaffRecentActivity,
      getStaffVisibleBadges: mockServerFn(
        async () => [],
      ) as unknown as typeof getStaffVisibleBadges,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/your manager hasn't assigned you to any portals yet/i),
    ).toBeVisible()
    // The populated sections stay hidden behind the empty state.
    expect(canvas.queryByText('Recent Activity')).toBeNull()
  },
}

// Error — a rejected query propagates to the error boundary (retry CTA).
// (Named ErrorState: an `Error` story identifier would shadow the Error
// constructor this mock needs.)
export const ErrorState: Story = {
  args: {
    searchPropertyId: SEARCH_PROPERTY_ID,
    fns: {
      ...populatedFns,
      getStaffDashboardData: mockServerFn(async () => {
        throw new Error('Failed to load staff home data.')
      }) as unknown as typeof getStaffDashboardDataFn,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/failed to load staff home data/i)).toBeVisible()
    await expect(canvas.getByRole('button', { name: /try again/i })).toBeVisible()
  },
}
