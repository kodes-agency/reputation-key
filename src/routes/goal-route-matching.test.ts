// The Monthly portal goal's page and the Google rating goal's page are static
// children of the Goals route, beside the dynamic `$goalId` (PLAN PG-13, the
// Google proof): `/goals/portals` and `/goals/google-rating` are never read as a
// goal's id, and a goal's id still reaches `$goalId`, which sends a Property
// count goal on to `/goals/portals`. Where each route sits is read from the tree
// TanStack Router generated (`routeTree.gen.ts`, the routes the router actually
// mounts); the matching is the router's own, on a tree of those same paths.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

const GENERATED = readFileSync(join(process.cwd(), 'src', 'routeTree.gen.ts'), 'utf8')
const GOALS_ROUTE = 'AuthenticatedPropertiesPropertyIdGoalsRoute'
const CHILDREN = ['portals', 'google-rating', '$goalId'] as const
const GOAL_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'

/** The path and the parent the generated tree gives a child of the Goals route. */
function placingOf(child: string): Readonly<{ path?: string; parent?: string }> {
  const start = GENERATED.indexOf(
    `'/_authenticated/properties/$propertyId/goals/${child}': {`,
  )
  if (start < 0) return {}
  const block = GENERATED.slice(start, GENERATED.indexOf('}', start))
  return {
    path: block.match(/\bpath: '([^']+)'/u)?.[1],
    parent: block.match(/parentRoute: typeof (\w+)/u)?.[1],
  }
}

/** A router of the Goals route and its three children, at their generated paths. */
function goalsRouter() {
  const root = createRootRoute()
  const goals = createRoute({
    getParentRoute: () => root,
    path: '/properties/$propertyId/goals',
  })
  const children = CHILDREN.map((child) =>
    createRoute({ getParentRoute: () => goals, path: placingOf(child).path ?? '' }),
  )
  return createRouter({
    routeTree: root.addChildren([goals.addChildren(children)]),
    history: createMemoryHistory(),
  })
}

describe('the goal routes', () => {
  it('the portal goal, Google goal and goal pages are siblings under Goals', () => {
    expect(CHILDREN.map(placingOf)).toEqual([
      { path: '/portals', parent: GOALS_ROUTE },
      { path: '/google-rating', parent: GOALS_ROUTE },
      { path: '/$goalId', parent: GOALS_ROUTE },
    ])
  })

  it('a static page wins over a goal id, and a goal id reaches $goalId', () => {
    const router = goalsRouter()
    const found = (pathname: string) => {
      const [, params, route] = router.getMatchedRoutes(pathname)
      return { route: route?.id, params }
    }

    expect(found('/properties/p1/goals/portals')).toEqual({
      route: '/properties/$propertyId/goals/portals',
      params: { propertyId: 'p1' },
    })
    expect(found('/properties/p1/goals/google-rating')).toEqual({
      route: '/properties/$propertyId/goals/google-rating',
      params: { propertyId: 'p1' },
    })
    expect(found(`/properties/p1/goals/${GOAL_ID}`)).toEqual({
      route: '/properties/$propertyId/goals/$goalId',
      params: { propertyId: 'p1', goalId: GOAL_ID },
    })
  })
})
