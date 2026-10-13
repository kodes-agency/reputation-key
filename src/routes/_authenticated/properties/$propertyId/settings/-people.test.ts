// The Property people tab: a refused responsible-managers save re-reads the
// managers it was about.
//
// The server refuses a save whose revision is behind, the card keeps the
// refused edit, and Reset is the way out. Reset can only show what another
// admin changed once the page has read it, and before this nothing read it: the
// read stays fresh for 30 seconds, so Reset put back the same older managers
// and the next save was refused the same way.
//
// The route component is rendered for real over a real QueryClient with the
// managers read on screen, and its save runs through the real
// `useActionMutation`. The unit project has no DOM, so the component is
// rendered once on the server renderer and the Action it handed its card is
// called (as `components/inbox/inbox-cache-test-harness.ts` does). The router,
// the card and the server stand outside: the server is the revision fence of
// `property-responsible-manager.repository.ts`.

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  environmentManager,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { propertyKeys } from '#/shared/queries/query-keys'

type SaveInput = Readonly<{
  data: Readonly<{
    propertyId: string
    managerUserIds: string[]
    expectedRevision: number
  }>
}>
type Managers = Readonly<{ managerUserIds: readonly string[]; revision: number }>

const page = vi.hoisted(() => ({
  /** The Property in the address bar. */
  propertyId: 'property-a',
  save: vi.fn<(input: SaveInput) => Promise<void>>(),
  readManagers: vi.fn<(propertyId: string) => Promise<Managers>>(),
  /** What the route handed its card. */
  updateAction: null as ((input: SaveInput) => Promise<unknown>) | null,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ propertyId: page.propertyId }),
    useRouteContext: () => ({ role: 'AccountAdmin' }),
  }),
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load; only the
  // class is used here.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))
vi.mock('#/contexts/property/server/property-responsible-managers', () => ({
  updatePropertyResponsibleManagers: page.save,
}))
// The section's two reads, under their real keys, over this test's server
// (the real module imports every settings section's server functions).
vi.mock('../-settings-queries', async () => {
  const { queryOptions } = await import('@tanstack/react-query')
  const keys = await import('#/shared/queries/query-keys')
  return {
    membersQuery: queryOptions({
      queryKey: ['test', 'members'],
      queryFn: () => ({ members: [] }),
    }),
    responsibleManagersQuery: (propertyId: string) =>
      queryOptions({
        queryKey: keys.propertyKeys.responsibleManagers(propertyId),
        queryFn: () => page.readManagers(propertyId),
        staleTime: 30_000,
      }),
  }
})
vi.mock('#/components/features/property/property-responsible-managers-card', () => ({
  PropertyResponsibleManagersCard: (props: {
    updateAction: (input: SaveInput) => Promise<unknown>
  }) => {
    page.updateAction = props.updateAction
    return null
  },
}))

import { membersQuery, responsibleManagersQuery } from '../-settings-queries'
import { Route } from './people'

let client: QueryClient
const mounted: Array<() => void> = []

beforeEach(() => {
  vi.useFakeTimers()
  // Observers fetch only in a browser; the unit project runs in Node.
  environmentManager.setIsServer(() => false)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.mount()
})

afterEach(() => {
  mounted.splice(0).forEach((unsubscribe) => unsubscribe())
  client.unmount()
  client.clear()
  environmentManager.setIsServer(() => typeof window === 'undefined')
  vi.clearAllMocks()
  vi.useRealTimers()
})

const settle = () => vi.advanceTimersByTimeAsync(0)

/** Each Property's managers on the server, behind the revision fence. */
function installManagersServer(propertyIds: readonly string[]) {
  const held = new Map<string, Managers>(
    propertyIds.map((id) => [id, { managerUserIds: ['user-1'], revision: 5 }]),
  )
  const stateOf = (propertyId: string): Managers => {
    const state = held.get(propertyId)
    if (!state) throw new Error(`no such Property: ${propertyId}`)
    return state
  }
  page.readManagers.mockImplementation((propertyId) =>
    Promise.resolve(stateOf(propertyId)),
  )
  page.save.mockImplementation(async ({ data }) => {
    const state = stateOf(data.propertyId)
    if (data.expectedRevision !== state.revision) {
      // `PropertyError` `revision_conflict`, as `propertyErrorStatus` sends it.
      throw new ServerFunctionError(
        'PropertyError',
        'responsible managers changed; reload them',
        'revision_conflict',
        409,
      )
    }
    held.set(data.propertyId, {
      managerUserIds: data.managerUserIds,
      revision: state.revision + 1,
    })
  })
  return {
    /** Another admin's save, from another browser: this page is not told. */
    saveFromElsewhere: (propertyId: string, managerUserIds: string[]) => {
      held.set(propertyId, {
        managerUserIds,
        revision: stateOf(propertyId).revision + 1,
      })
    },
  }
}

/** Keep a Property's managers on screen, as its people tab does. */
function showManagers(propertyId: string) {
  const observer = new QueryObserver(client, responsibleManagersQuery(propertyId))
  mounted.push(observer.subscribe(() => {}))
}

/** Render the people tab of `propertyId` and hand back the save it gave its card. */
async function openPeopleTab(propertyId: string) {
  page.propertyId = propertyId
  await client.fetchQuery(membersQuery)
  await settle()
  const component = Route.options.component
  if (!component) throw new Error('the people route has no component')
  renderToString(createElement(QueryClientProvider, { client }, createElement(component)))
  if (!page.updateAction) throw new Error('the people tab did not render its card')
  return page.updateAction
}

const readsOf = (propertyId: string) =>
  page.readManagers.mock.calls.filter(([id]) => id === propertyId).length

describe('a responsible-managers save the server refused, on the people tab', () => {
  it('re-reads the managers, so Reset shows what the other admin saved', async () => {
    const server = installManagersServer(['property-a'])
    showManagers('property-a')
    const save = await openPeopleTab('property-a')
    server.saveFromElsewhere('property-a', ['user-1', 'user-3'])

    const refused: unknown = await save({
      data: {
        propertyId: 'property-a',
        managerUserIds: ['user-1', 'user-2'],
        expectedRevision: 5,
      },
    }).catch((error: unknown) => error)
    await settle()

    expect(refused).toMatchObject({ code: 'revision_conflict', status: 409 })
    expect(readsOf('property-a')).toBe(2)
    expect(client.getQueryData(propertyKeys.responsibleManagers('property-a'))).toEqual({
      managerUserIds: ['user-1', 'user-3'],
      revision: 6,
    })
  })

  it('re-reads the Property the command named, not the one the page has moved to', async () => {
    // The route is not remounted when its params change: a save issued on
    // Property A can settle through the options Property B's render built.
    const server = installManagersServer(['property-a', 'property-b'])
    showManagers('property-a')
    showManagers('property-b')
    const save = await openPeopleTab('property-b')
    server.saveFromElsewhere('property-a', ['user-1', 'user-3'])

    await save({
      data: { propertyId: 'property-a', managerUserIds: ['user-2'], expectedRevision: 5 },
    }).catch(() => undefined)
    await settle()

    expect({ a: readsOf('property-a'), b: readsOf('property-b') }).toEqual({
      a: 2,
      b: 1,
    })
  })
})
