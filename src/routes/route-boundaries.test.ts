// One page state for every authenticated route (UI consistency scan: FRAME-02,
// FRAME-03, FRAME-04).
//
// A route that drew its own loading skeleton, error box or not-found page was the
// scan's third-largest family: the Portal fallbacks skipped the production error
// sanitising, the Sentry report, the 401 sign-in redirect and Try again that the
// router's default had, and drew themselves a different width. Now the router's
// defaults and every route's fallbacks are the route-bound halves of `PageState`
// (`RoutePending`, `RouteError`, `RouteNotFound`), so a failing page keeps its title,
// its breadcrumbs and its tier and every failure is guarded the same way.
//
// This walks the route tree TanStack Router generated (`routeTree.gen.ts` is the
// list of the files the router actually mounts, so a route cannot hide from it by
// being new) and reads each authenticated route's options. A route may set
// `pendingComponent` and `errorComponent` only to the shared components, and
// `notFoundComponent` only to `RouteNotFound` or to a component of its own that
// draws it (a missing entity names itself: "This portal is no longer available") or
// draws the shell's refusal boundary (`ShellNoticeBoundary`, the layout route's).
// Anything else, a skeleton or an `Alert` or an `EmptyState` written in the route
// file, fails here with the file named.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

type BoundaryOption = 'pendingComponent' | 'errorComponent' | 'notFoundComponent'

/** What each option may be set to by name: the route-bound halves of PageState. */
const SHARED_COMPONENT: Readonly<Record<BoundaryOption, string>> = {
  pendingComponent: 'RoutePending',
  errorComponent: 'RouteError',
  notFoundComponent: 'RouteNotFound',
}

/**
 * What a component of a route's own may draw to be a not-found boundary: the shared
 * not-found state (naming the missing entity), or the shell's boundary that replaces
 * the shell with a refusal.
 */
const NOT_FOUND_RENDERERS: readonly string[] = ['RouteNotFound', 'ShellNoticeBoundary']

const BOUNDARY_OPTIONS = Object.keys(SHARED_COMPONENT) as BoundaryOption[]

/** The route modules the generated tree imports, as paths under `src/routes`. */
function generatedRouteModules(): string[] {
  const generated = readFileSync(join(ROOT, 'src', 'routeTree.gen.ts'), 'utf8')
  const imports = generated.matchAll(
    /^import \{ Route as \w+ \} from '\.\/routes\/([^']+)'$/gmu,
  )
  return [...imports].map((match) => match[1] ?? '')
}

function isAuthenticated(module: string): boolean {
  return module === '_authenticated' || module.startsWith('_authenticated/')
}

function sourcePathOf(module: string): string {
  const base = join('src', 'routes', module)
  return [`${base}.tsx`, `${base}.ts`].find((path) => existsSync(join(ROOT, path))) ?? ''
}

function nameOf(node: ts.Node | undefined): string | null {
  return node && ts.isIdentifier(node) ? node.text : null
}

/** The object a route file passes to `createFileRoute(path)({ ... })`, if it has one. */
function routeOptionsOf(source: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null
  const visit = (node: ts.Node): void => {
    if (
      !found &&
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      nameOf(node.expression.expression) === 'createFileRoute'
    ) {
      const [options] = node.arguments
      if (options && ts.isObjectLiteralExpression(options)) found = options
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The JSX tags and called names beneath a node: what a component draws. */
function drawnBy(node: ts.Node): ReadonlySet<string> {
  const names = new Set<string>()
  const visit = (child: ts.Node): void => {
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      names.add(child.tagName.getText())
    }
    if (ts.isCallExpression(child)) {
      const called = nameOf(child.expression)
      if (called) names.add(called)
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return names
}

/** The components a file declares at its top level, by name. */
function localComponents(source: ts.SourceFile): ReadonlyMap<string, ts.Node> {
  const components = new Map<string, ts.Node>()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      components.set(statement.name.text, statement)
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = nameOf(declaration.name)
        if (name && declaration.initializer) components.set(name, declaration.initializer)
      }
    }
  }
  return components
}

function problemWith(
  option: BoundaryOption,
  value: ts.Expression,
  components: ReadonlyMap<string, ts.Node>,
): string | null {
  const name = nameOf(value)
  const shared = SHARED_COMPONENT[option]
  if (name === shared) return null
  const own = name ? components.get(name) : undefined
  if (option === 'notFoundComponent' && own) {
    const drawn = drawnBy(own)
    if (NOT_FOUND_RENDERERS.some((renderer) => drawn.has(renderer))) return null
  }
  const found = name ?? 'an inline component'
  const allowed =
    option === 'notFoundComponent'
      ? `${shared}, or a component that draws ${NOT_FOUND_RENDERERS.join(' or ')}`
      : shared
  return `${option} is ${found}; it may only be ${allowed}`
}

type OwnBoundary = Readonly<{ option: BoundaryOption; value: string }>

/** What a route file sets of the three options, and what is wrong with it. */
function inspectRoute(text: string): Readonly<{
  hasRoute: boolean
  boundaries: readonly OwnBoundary[]
  problems: readonly string[]
}> {
  const source = ts.createSourceFile('route.tsx', text, ts.ScriptTarget.Latest, true)
  const options = routeOptionsOf(source)
  if (!options) return { hasRoute: false, boundaries: [], problems: [] }
  const components = localComponents(source)
  const boundaries: OwnBoundary[] = []
  const problems: string[] = []
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const option = BOUNDARY_OPTIONS.find((name) => nameOf(property.name) === name)
    if (!option) continue
    boundaries.push({ option, value: property.initializer.getText() })
    const problem = problemWith(option, property.initializer, components)
    if (problem) problems.push(problem)
  }
  return { hasRoute: true, boundaries, problems }
}

const authenticatedRoutes = generatedRouteModules()
  .filter(isAuthenticated)
  .map((module) => {
    const path = sourcePathOf(module)
    const text = path ? readFileSync(join(ROOT, path), 'utf8') : ''
    return { module, path, ...inspectRoute(text) }
  })

describe('every authenticated route draws the shared page states', () => {
  it('walks the routes the generated tree mounts, so a gap here is a broken walk', () => {
    const modules = authenticatedRoutes.map(({ module }) => module)

    expect(modules).toContain('_authenticated')
    expect(modules).toContain('_authenticated/inbox/index')
    expect(modules).toContain('_authenticated/properties/$propertyId/portals/$portalId')
    expect(modules).toContain('_authenticated/settings/profile')
    expect(authenticatedRoutes.length).toBeGreaterThan(40)
  })

  it('finds a route file and a route definition in each module the tree names', () => {
    const unread = authenticatedRoutes
      .filter(({ path, hasRoute }) => !path || !hasRoute)
      .map(({ module }) => module)

    expect(unread).toEqual([])
  })

  it('has no route that sets a pending, error or not-found component of its own', () => {
    const offenders = authenticatedRoutes.flatMap(({ path, problems }) =>
      problems.map((problem) => `${path}: ${problem}`),
    )

    expect(offenders).toEqual([])
  })

  it('still sees the boundaries routes do draw: the shell, a missing portal and a missing group', () => {
    const drawn = authenticatedRoutes
      .filter(({ boundaries }) => boundaries.length > 0)
      .map(({ module, boundaries }) => [
        module,
        boundaries.map(({ option }) => option).join(),
      ])

    expect(drawn).toContainEqual(['_authenticated', 'notFoundComponent'])
    expect(drawn).toContainEqual([
      '_authenticated/properties/$propertyId/portals/$portalId',
      'notFoundComponent',
    ])
    expect(drawn).toContainEqual([
      '_authenticated/properties/$propertyId/portals/groups/$groupId',
      'notFoundComponent',
    ])
  })
})

describe('the router defaults are the shared page states', () => {
  const router = readFileSync(join(ROOT, 'src', 'router.tsx'), 'utf8')

  it.each([
    ['defaultPendingComponent', 'RoutePending'],
    ['defaultErrorComponent', 'RouteError'],
    ['defaultNotFoundComponent', 'RouteNotFound'],
  ])('sets %s to %s', (option, component) => {
    expect(router).toMatch(new RegExp(`\\b${option}: ${component}\\b`, 'u'))
  })
})

describe('what the check refuses', () => {
  const route = (options: string, locals = '') =>
    `import { createFileRoute } from '@tanstack/react-router'
${locals}
export const Route = createFileRoute('/_authenticated/x')({ ${options} })`

  it('refuses a route that draws its own error box', () => {
    const { problems } = inspectRoute(
      route(
        'errorComponent: PortalError',
        'function PortalError({ error }) { return <Alert>{error.message}</Alert> }',
      ),
    )

    expect(problems).toEqual(['errorComponent is PortalError; it may only be RouteError'])
  })

  it('refuses an inline pending skeleton', () => {
    const { problems } = inspectRoute(route('pendingComponent: () => <Skeleton />'))

    expect(problems).toEqual([
      'pendingComponent is an inline component; it may only be RoutePending',
    ])
  })

  it('refuses a not-found page that is its own empty state', () => {
    const { problems } = inspectRoute(
      route(
        'notFoundComponent: Gone',
        'function Gone() { return <EmptyState title="Gone" /> }',
      ),
    )

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('notFoundComponent is Gone')
  })

  it('accepts the shared components, by name', () => {
    const { problems } = inspectRoute(
      route(
        'pendingComponent: RoutePending, errorComponent: RouteError, notFoundComponent: RouteNotFound',
      ),
    )

    expect(problems).toEqual([])
  })

  it('accepts a not-found component that names the missing entity through RouteNotFound', () => {
    const { problems, boundaries } = inspectRoute(
      route(
        'notFoundComponent: Gone',
        'function Gone() { return <RouteNotFound entity={{ heading: "Gone", back: { to: "/", label: "Back" } }} /> }',
      ),
    )

    expect(problems).toEqual([])
    expect(boundaries).toEqual([{ option: 'notFoundComponent', value: 'Gone' }])
  })

  it('reads a file with no route definition as having none, not as clean', () => {
    expect(inspectRoute('export const x = 1').hasRoute).toBe(false)
  })
})
