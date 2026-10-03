// The route-bound page states, in a real router: what a page that is pending,
// failed, missing or refused shows, read from the route's own name
// (`staticData.page`) rather than from anything the fallback was told. The shell
// here is a stand-in for `_authenticated` (a sidebar landmark and the padded
// `<main>`); the boundary rule, and what the shell keeps when a refusal replaces
// it, are the app's own.
import { useMemo, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  notFound,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { EMPTY_CLIENT_AUTHZ, type ClientAuthz } from '#/shared/domain/auth-context'
import type { Role } from '#/shared/domain/roles'
import { propertyKeys } from '#/shared/queries/query-keys'
import type { PageIdentity } from './page-identity'
import { PAGE_GUTTER } from './page-shell'
import {
  RouteError,
  RouteNotFound,
  RoutePending,
  ShellPresence,
} from './route-page-state'
import { sidebarStore, useKeepSidebarFocus, useSidebarOpen } from './shell-continuity'
import { ShellNoticeBoundary } from './shell-notice-boundary'

const PEOPLE: PageIdentity = { title: 'People', tier: 'dashboard', under: 'property' }
const GOALS: PageIdentity = { title: 'Goals', tier: 'dashboard', under: 'property' }
const GROUP: PageIdentity = { title: 'Portal group', tier: 'dashboard', under: 'portals' }
const NEVER = () => new Promise<void>(() => {})

/** The page's name, once the router has settled on a state for it. */
const pageHeading = (canvasElement: HTMLElement, name: string) =>
  within(canvasElement).findByRole('heading', { level: 1, name })

/** The sidebar as the shell has it: a collapse control and links to two pages. */
function Sidebar() {
  const [open, setOpen] = useSidebarOpen()
  return (
    <nav aria-label="Sidebar">
      <button type="button" onClick={() => setOpen(!open)}>
        {open ? 'Collapse sidebar' : 'Expand sidebar'}
      </button>
      {/* `sidebar-menu-button` is the slot the shell restores focus to. */}
      <Link
        data-slot="sidebar-menu-button"
        to="/properties/$propertyId/people"
        params={{ propertyId: 'p1' }}
      >
        People page
      </Link>
      <Link
        data-slot="sidebar-menu-button"
        to="/properties/$propertyId/goals"
        params={{ propertyId: 'p1' }}
      >
        Goals page
      </Link>
    </nav>
  )
}

function Shell({ children }: Readonly<{ children: ReactNode }>) {
  useKeepSidebarFocus()
  return (
    <div data-testid="shell">
      <Sidebar />
      <main className={PAGE_GUTTER}>
        <ShellPresence value>{children}</ShellPresence>
      </main>
    </div>
  )
}

/** What `_authenticated` does with a not-found: the app's own boundary, around this shell. */
function ShellNotFound({ data }: Readonly<{ data?: unknown }>) {
  return <ShellNoticeBoundary data={data} shell={Shell} />
}

/** What the real shell's `beforeLoad` hands every page below it, which a refusal's way back reads. */
type ShellContext = Readonly<{ role: Role; authz: ClientAuthz }>

type Scenario = Readonly<{
  url: string
  /** The Property layout's loader: it draws no header of its own. */
  layoutLoader?: () => Promise<void>
  people?: Readonly<{ beforeLoad?: () => void; loader?: () => Promise<void> }>
  /** Render this in place of the page, to show an error without throwing. */
  failure?: unknown
}>

function buildRouter(scenario: Scenario) {
  const root = createRootRouteWithContext<ShellContext>()({ component: Outlet })
  const shell = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: () => (
      <Shell>
        <Outlet />
      </Shell>
    ),
    // A thrown not-found replaces this component, so it brings the shell; an
    // unknown address renders in this component's Outlet, where the shell is.
    notFoundComponent: ShellNotFound,
  })
  const property = createRoute({
    getParentRoute: () => shell,
    path: '/properties/$propertyId',
    loader: scenario.layoutLoader,
    component: Outlet,
  })
  const people = createRoute({
    getParentRoute: () => property,
    path: '/people',
    staticData: { page: PEOPLE },
    beforeLoad: scenario.people?.beforeLoad,
    loader: scenario.people?.loader,
    component: () =>
      scenario.failure === undefined ? (
        <p>The People page</p>
      ) : (
        <RouteError error={scenario.failure} reset={() => {}} />
      ),
  })
  const goals = createRoute({
    getParentRoute: () => property,
    path: '/goals',
    staticData: { page: GOALS },
    beforeLoad: () => {
      throw roleUnavailable('Goals', 'properties')
    },
    component: () => <p>The Goals page</p>,
  })
  const group = createRoute({
    getParentRoute: () => property,
    path: '/portals/groups/$groupId',
    staticData: { page: GROUP },
    beforeLoad: () => {
      throw notFound()
    },
    // The route's own, nearer than the shell's: a group that is gone.
    notFoundComponent: () => (
      <RouteNotFound
        entity={{
          heading: 'This group is no longer available',
          reason: 'It may have been archived, or it may belong to a different property.',
          back: { to: '/properties/p1/portals', label: 'Back to Portals' },
        }}
      />
    ),
    component: () => <p>A group</p>,
  })
  return createRouter({
    routeTree: root.addChildren([
      shell.addChildren([property.addChildren([people, goals, group])]),
    ]),
    history: createMemoryHistory({ initialEntries: [scenario.url] }),
    context: { role: 'AccountAdmin', authz: EMPTY_CLIENT_AUTHZ },
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
  })
}

function Harness({ scenario }: Readonly<{ scenario: Scenario }>) {
  const queryClient = useQueryClient()
  const router = useMemo(() => {
    queryClient.setQueryData(propertyKeys.detail('p1'), {
      property: { name: 'Hotel Elegance' },
    })
    return buildRouter(scenario)
  }, [queryClient, scenario])
  return <RouterProvider router={router} />
}

const meta: Meta<typeof Harness> = {
  title: 'Patterns/Route states',
  component: Harness,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  // The sidebar's state outlives a story (it is kept outside the shell): start each from the default.
  beforeEach: () => sidebarStore.set(true),
}
export default meta
type Story = StoryObj<typeof Harness>

/** The page that is loading keeps its name, trail and width. */
export const PendingPage: Story = {
  args: { scenario: { url: '/properties/p1/people', people: { loader: NEVER } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await pageHeading(canvasElement, 'People')).toBeVisible()
    // The Property is named from the cache, as a link, in the trail.
    expect(canvas.getByRole('link', { name: 'Hotel Elegance' })).toHaveAttribute(
      'href',
      '/properties/p1',
    )
    expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(canvasElement.querySelector('.max-w-\\[1200px\\]')).not.toBeNull()
    // Inside the shell, whose `<main>` pads it: the state adds no gutter of its own.
    expect(canvas.getByTestId('shell')).toBeVisible()
    expect(canvasElement.querySelector('.page-wrap')).toBeNull()
  },
}

/** A layout that draws no header borrows the page below it, rather than an anonymous skeleton. */
export const PendingLayout: Story = {
  args: { scenario: { url: '/properties/p1/people', layoutLoader: NEVER } },
  play: async ({ canvasElement }) => {
    expect(await pageHeading(canvasElement, 'People')).toBeVisible()
  },
}

const loader = fn(async () => {})

/** A failure keeps the page's name and offers Try again, which runs the loaders again. */
export const Failed: Story = {
  args: {
    scenario: {
      url: '/properties/p1/people',
      people: { loader },
      failure: new Error('The people query failed.'),
    },
  },
  play: async ({ canvasElement }) => {
    loader.mockClear()
    const canvas = within(canvasElement)
    expect(await pageHeading(canvasElement, 'People')).toBeVisible()
    expect(await canvas.findByText('The people query failed.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(loader).toHaveBeenCalled()
  },
}

/** An entity that is gone keeps the page's name and trail, says so, and gives a way out. */
export const EntityGone: Story = {
  args: { scenario: { url: '/properties/p1/portals/groups/g1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await pageHeading(canvasElement, 'Portal group')).toBeVisible()
    expect(canvas.getByText('This group is no longer available')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Portals' })).toHaveAttribute(
      'href',
      '/properties/p1/portals',
    )
    expect(canvas.getByRole('link', { name: 'Back to Portals' })).toBeVisible()
  },
}

/** A role or feature that cannot open the page: the shell stays, the notice names the page, its trail, and the way back. */
export const Unavailable: Story = {
  args: {
    scenario: {
      url: '/properties/p1/people',
      people: {
        beforeLoad: () => {
          throw roleUnavailable('People', 'properties')
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await pageHeading(canvasElement, 'People')).toBeVisible()
    expect(canvas.getByTestId('shell')).toBeVisible()
    expect(canvas.getByText('You do not have access to People')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Back to Properties' })).toHaveAttribute(
      'href',
      '/properties',
    )
    // It stands where the page stood: People's width and People's trail.
    expect(canvasElement.querySelector('.max-w-\\[1200px\\]')).not.toBeNull()
    expect(canvas.getByRole('link', { name: 'Hotel Elegance' })).toHaveAttribute(
      'href',
      '/properties/p1',
    )
  },
}

/**
 * Drawing a refusal replaces the shell with a new one. What a person set, and
 * where their keyboard was, go with it unless the shell keeps them outside: a
 * collapsed sidebar stays collapsed, and the link that was focused is focused
 * again, on the way into a refusal and on the way back out.
 */
export const RefusalKeepsTheSidebarAndFocus: Story = {
  args: { scenario: { url: '/properties/p1/people' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('The People page')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse sidebar' }))
    expect(canvas.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()

    // Into a page the role cannot open.
    await userEvent.click(canvas.getByRole('link', { name: 'Goals page' }))
    expect(await canvas.findByText('You do not have access to Goals')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await waitFor(() =>
      expect(canvas.getByRole('link', { name: 'Goals page' })).toHaveFocus(),
    )

    // And back out of it.
    await userEvent.click(canvas.getByRole('link', { name: 'People page' }))
    expect(await canvas.findByText('The People page')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await waitFor(() =>
      expect(canvas.getByRole('link', { name: 'People page' })).toHaveFocus(),
    )
  },
}

export const UnavailableLight: Story = {
  ...Unavailable,
  parameters: { theme: 'light' },
}

/** An address inside the app that no page answers is a not-found in the shell, not on the public chrome. */
export const UnknownAddressInShell: Story = {
  args: { scenario: { url: '/properties/p1/nowhere' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await pageHeading(canvasElement, 'Page not found')).toBeVisible()
    expect(canvas.getByTestId('shell')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Back to Properties' })).toBeVisible()
  },
}

/** An address outside the app is the public page's, with the public container. */
export const UnknownAddress: Story = {
  args: { scenario: { url: '/nowhere' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await pageHeading(canvasElement, 'Page not found')).toBeVisible()
    expect(canvas.queryByTestId('shell')).toBeNull()
    expect(canvasElement.querySelector('.page-wrap')).not.toBeNull()
  },
}
