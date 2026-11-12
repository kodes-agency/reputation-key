// What saving does around the Google rating goal wizard: a save in flight holds
// the wizard open and is sent once, the reads a saved or refused goal moves are
// read again (and nothing else), and "See your portal goal" lands the focus on
// the Portal goals title of the real Goals page. The Storybook Vitest project
// compiles no Tailwind, so the plays assert roles, calls and the focus.
import { useQuery } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PortalGoalSection } from '#/contexts/reporting/monthly-goals/ui/portal-goal-section'
import { SEAVIEW } from '#/contexts/reporting/monthly-goals/ui/portal-goal.stories.fixtures'
import type { Role } from '#/shared/domain/roles'
import { dashboardKeys, goalKeys, propertyKeys } from '#/shared/queries/query-keys'
import {
  clearMocks,
  Harness,
  openWizard,
  refusal,
  setMock,
} from './rating-goal-wizard.stories.harness'
import { setGoalAndLand } from './rating-goal-wizard.stories.play'
import { FIXTURE_GOAL_ID, FIXTURE_PROPERTY_ID } from './rating-goal.stories.fixtures'

const meta: Meta<typeof Harness> = {
  title: 'Goals/RatingGoalWizard/Save',
  component: Harness,
  args: { intent: { kind: 'climb' } },
  beforeEach: clearMocks,
}

export default meta
type Story = StoryObj<typeof meta>

/** A save the play settles when it chooses. */
function held() {
  let settle: (value: { goalId: string; version: number }) => void = () => undefined
  const promise = new Promise<{ goalId: string; version: number }>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/**
 * Nothing the wizard does ends the save early: Escape and Enter leave the
 * wizard open and the goal is sent once; the receipt waits for the answer.
 */
export const SavePending: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const saving = held()
    setMock.mockImplementationOnce(() => saving.promise)
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: /^Aim for / }))
    await waitFor(() => expect(setMock).toHaveBeenCalledOnce())
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Enter}')
    await expect(within(document.body).getByRole('dialog')).toBeVisible()
    await expect(dialog.queryByRole('heading', { name: 'Your goal is set' })).toBeNull()
    await expect(setMock).toHaveBeenCalledOnce()
    saving.settle({ goalId: FIXTURE_GOAL_ID, version: 1 })
    await expect(
      await dialog.findByRole('heading', { name: 'Your goal is set' }),
    ).toBeVisible()
    await expect(setMock).toHaveBeenCalledOnce()
  },
}

const OTHER_PROPERTY = 'd0000000-0000-4000-8000-0000000000ff'

const READS: ReadonlyArray<Readonly<{ name: string; key: readonly unknown[] }>> = [
  { name: 'goal', key: goalKeys.ratingGoal(FIXTURE_PROPERTY_ID) },
  { name: 'setup', key: propertyKeys.setup(FIXTURE_PROPERTY_ID) },
  { name: 'summaries', key: propertyKeys.setupSummaries() },
  { name: 'fleet', key: dashboardKeys.fleets() },
  { name: 'other property', key: goalKeys.ratingGoal(OTHER_PROPERTY) },
]

const fetched = new Map<string, number>()
const fetchesOf = (name: string) => fetched.get(name) ?? 0

function Observed({ name, queryKey }: Readonly<{ name: string; queryKey: unknown[] }>) {
  useQuery({
    queryKey: [...queryKey, name],
    staleTime: Infinity,
    queryFn: () => {
      fetched.set(name, fetchesOf(name) + 1)
      return Promise.resolve(name)
    },
  })
  return null
}

/** The reads a goal moves, held by the page as active queries. */
function WizardOverReads(props: Parameters<typeof Harness>[0]) {
  return (
    <>
      {READS.map(({ name, key }) => (
        <Observed key={name} name={name} queryKey={[...key]} />
      ))}
      <Harness {...props} />
    </>
  )
}

async function readsSettled() {
  await waitFor(() => {
    for (const { name } of READS) expect(fetchesOf(name)).toBe(1)
  })
}

/** A saved goal reads again the goal, the Property's setup, its summaries and the fleet. */
export const SaveReadsAgain: Story = {
  render: (args) => <WizardOverReads {...args} />,
  beforeEach: () => {
    clearMocks()
    fetched.clear()
  },
  play: async ({ canvasElement }) => {
    await readsSettled()
    const dialog = await openWizard(canvasElement)
    await setGoalAndLand(dialog)
    await waitFor(() => {
      for (const name of ['goal', 'setup', 'summaries', 'fleet'])
        expect(fetchesOf(name)).toBe(2)
    })
    await expect(fetchesOf('other property')).toBe(1)
  },
}

/** A refused save reads again the goal only. */
export const RefusalReadsTheGoalAgain: Story = {
  render: (args) => <WizardOverReads {...args} />,
  beforeEach: () => {
    clearMocks()
    fetched.clear()
  },
  play: async ({ canvasElement }) => {
    await readsSettled()
    setMock.mockRejectedValueOnce(refusal('revision_conflict'))
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: /^Aim for / }))
    await waitFor(() => expect(setMock).toHaveBeenCalledOnce())
    await waitFor(() => expect(fetchesOf('goal')).toBe(2))
    for (const name of ['setup', 'summaries', 'fleet', 'other property'])
      await expect(fetchesOf(name)).toBe(1)
  },
}

const GOALS_PAGE_DELAY_MS = 400

type RouterContext = {
  role: Role
  user: { id: string }
  activeOrganization: { id: string }
}

/**
 * A page with the wizard, and the real Goals page it leads to: the link is
 * followed, so the focus the title takes comes from the address's state.
 */
function createJourneyRouter(wizard: () => React.ReactNode) {
  const root = createRootRouteWithContext<RouterContext>()({ component: Outlet })
  const auth = createRoute({ getParentRoute: () => root, path: '_authenticated' })
  const page = createRoute({
    getParentRoute: () => auth,
    path: '/',
    component: wizard,
  })
  const goals = createRoute({
    getParentRoute: () => root,
    path: '/properties/$propertyId/goals',
    // The page the link leaves is gone before this one is drawn.
    loader: () =>
      new Promise<void>((resolve) => setTimeout(resolve, GOALS_PAGE_DELAY_MS)),
    pendingMs: 0,
    pendingComponent: () => null,
    component: () => (
      <PortalGoalSection
        propertyId={SEAVIEW.propertyId}
        card={null}
        canCreatePortal
        commands={{ setMonthlyPortalGoalFn: fn(), onSet: fn() }}
      />
    ),
  })
  return createRouter({
    routeTree: root.addChildren([auth.addChildren([page]), goals]),
    context: {
      role: 'AccountAdmin',
      user: { id: 'user-1' },
      activeOrganization: { id: 'org-1' },
    },
    history: createMemoryHistory({ initialEntries: ['/_authenticated/'] }),
  })
}

function Journey(props: Parameters<typeof Harness>[0]) {
  const [router] = useState(() => createJourneyRouter(() => <Harness {...props} />))
  return <RouterProvider router={router} />
}

/** "See your portal goal" arrives at the real Goals page with the title focused. */
export const SeePortalGoalFocusesTheTitle: Story = {
  args: { portalNextStep: 'see' },
  render: (args) => <Journey {...args} />,
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await setGoalAndLand(dialog)
    await userEvent.click(dialog.getByRole('link', { name: 'See your portal goal' }))
    const title = await within(canvasElement).findByRole('heading', {
      level: 2,
      name: 'Portal goals',
    })
    await waitFor(() => expect(title).toHaveFocus())
    await expect(within(document.body).queryByRole('dialog')).toBeNull()
  },
}
