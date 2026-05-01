# Data Loading & UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate route loader fetches, optimize caching strategy with per-route staleTime and targeted invalidation, and apply light UI shell refinements for single-property users.

**Architecture:** Child routes read parent loader data via `getRouteApi()` instead of re-fetching. Per-route `staleTime` replaces the global default. `useMutationAction` gains an `invalidateRoutes` option for targeted cache invalidation. UI changes are conditional rendering based on `properties.length`.

**Tech Stack:** TypeScript, TanStack Start, TanStack Router, React 19

**Spec:** `docs/superpowers/specs/2026-05-01-data-loading-ui-refinement-design.md`

**No overlap with:** `docs/superpowers/plans/2026-05-01-code-review-fixes.md` (that plan touches `src/contexts/` and `src/shared/` only)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/router.tsx` | Remove defaultStaleTime, increase gcTime and preloadStaleTime |
| Modify | `src/routes/_authenticated.tsx` | Add `staleTime: Infinity` |
| Modify | `src/routes/_authenticated/dashboard.tsx` | Remove loader, read parent data, smart redirect/list |
| Modify | `src/routes/_authenticated/properties/index.tsx` | Remove loader, read parent data |
| Modify | `src/routes/_authenticated/properties/$propertyId/members.tsx` | Remove `listProperties()` from loader |
| Modify | `src/routes/_authenticated/staff/index.tsx` | Add `staleTime: 30_000` (keeps `listProperties()` — needed for aggregation) |
| Modify | `src/components/hooks/use-mutation-action.ts` | Add `invalidateRoutes` option |
| Modify | `src/components/layout/AppSidebar.tsx` | Remove unbuilt nav items |
| Modify | `src/components/layout/AppTopBar.tsx` | Conditional property switcher for single-property users |

---

## Task 1: Router caching config

**Files:**
- Modify: `src/router.tsx`

- [ ] **Step 1: Update router caching defaults**

In `src/router.tsx`, change the `getRouter()` function's caching config:

```typescript
export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // ── Caching ─────────────────────────────────────────────────────────
    // Remove defaultStaleTime — fall back to TanStack default (0).
    // Each route opts into its own staleTime based on data volatility.
    // After mutations we call router.invalidate() which forces a refresh
    // regardless of staleTime.
    defaultPreloadStaleTime: 30_000,
    // Garbage-collect unused loader data after 30 minutes (TanStack default).
    defaultGcTime: 30 * 60 * 1000,

    // ── Preload ─────────────────────────────────────────────────────────
    defaultPreload: 'intent',

    // ── Pending UI ──────────────────────────────────────────────────────
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPendingComponent: DefaultPendingComponent,
    defaultErrorComponent: DefaultErrorComponent,
  })

  return router
}
```

Changes: remove `defaultStaleTime: 30_000`, change `defaultPreloadStaleTime` from `10_000` to `30_000`, change `defaultGcTime` from `5 * 60 * 1000` to `30 * 60 * 1000`. Update comments.

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/router.tsx
git commit -m "perf: optimize router caching — per-route staleTime, 30min gcTime"
```

---

## Task 2: Authenticated layout — infinite staleTime

**Files:**
- Modify: `src/routes/_authenticated.tsx`

- [ ] **Step 1: Add staleTime to the authenticated route**

In `src/routes/_authenticated.tsx`, add `staleTime: Infinity` to the route options, between the `loader` and `component` options:

```typescript
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    // ... existing beforeLoad unchanged ...
  },
  loader: async () => {
    // ... existing loader unchanged ...
  },
  // Structural data (orgs, properties) rarely changes.
  // Refetch only on explicit router.invalidate() after mutations.
  staleTime: Infinity,
  component: AuthenticatedLayout,
})
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated.tsx
git commit -m "perf: infinite staleTime for authenticated layout shell data"
```

---

## Task 3: Dashboard — remove duplicate fetch, smart redirect

**Files:**
- Modify: `src/routes/_authenticated/dashboard.tsx`

- [ ] **Step 1: Rewrite dashboard to use parent data**

Replace the entire file content of `src/routes/_authenticated/dashboard.tsx` with:

```typescript
// Dashboard — smart redirect or property list
// Reads properties from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Plus, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import type { AuthRouteContext } from "#/routes/_authenticated";
import { hasRole } from "#/shared/domain/roles";

const authRoute = getRouteApi("/_authenticated");

export const Route = createFileRoute("/_authenticated/dashboard")({
	component: DashboardPage,
});

function DashboardPage() {
	const { properties } = authRoute.useLoaderData();
	const ctx = Route.useRouteContext() as AuthRouteContext;
	const navigate = useNavigate();

	useEffect(() => {
		if (properties.length === 1) {
			navigate({
				to: "/properties/$propertyId",
				params: { propertyId: properties[0].id },
				replace: true,
			});
		}
	}, [properties, navigate]);

	if (properties.length === 1) {
		return null;
	}

	if (properties.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-4 py-24">
				<h2 className="text-lg font-medium">No properties yet</h2>
				<p className="max-w-sm text-center text-sm text-muted-foreground">
					Create your first property to start managing reviews, staff performance,
					and reputation.
				</p>
				<Button asChild>
					<Link to="/properties/new">
						<Plus />
						Create Property
					</Link>
				</Button>
			</div>
		);
	}

	// Multiple properties — show list
	const canCreate = hasRole(ctx.role, "PropertyManager");

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Properties</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Manage your organization's properties and locations.
					</p>
				</div>
				{canCreate && (
					<Button asChild>
						<Link to="/properties/new">
							<Plus />
							Add Property
						</Link>
					</Button>
				)}
			</div>

			<div className="flex flex-col gap-2">
				{properties.map((p) => (
					<Link
						key={p.id}
						to="/properties/$propertyId"
						params={{ propertyId: p.id }}
						className="block rounded-lg border p-4 transition-colors hover:bg-accent"
					>
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-1">
								<p className="font-semibold">{p.name}</p>
								<div className="flex items-center gap-2">
									<Badge variant="secondary">{p.slug}</Badge>
									<span className="text-sm text-muted-foreground">
										{p.timezone}
									</span>
								</div>
							</div>
							<ChevronRight className="size-4 text-muted-foreground" />
						</div>
					</Link>
				))}
			</div>
		</div>
	);
}
```

Key changes:
- No loader — reads from `getRouteApi('/_authenticated').useLoaderData()`
- Single property: `useEffect` + `navigate` with `replace: true` (no history entry)
- Zero properties: empty state with CTA
- Multiple properties: property list (same markup as `properties/index.tsx`)

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/dashboard.tsx
git commit -m "perf: dashboard reads parent data, smart redirect for single property"
```

---

## Task 4: Properties list — remove duplicate fetch

**Files:**
- Modify: `src/routes/_authenticated/properties/index.tsx`

- [ ] **Step 1: Remove loader, use parent data**

Replace the entire file content of `src/routes/_authenticated/properties/index.tsx` with:

```typescript
// Property list — shows all properties for the active organization
// Reads from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import type { AuthRouteContext } from "#/routes/_authenticated";
import { hasRole } from "#/shared/domain/roles";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Plus, ChevronRight } from "lucide-react";

const authRoute = getRouteApi("/_authenticated");

export const Route = createFileRoute("/_authenticated/properties/")({
	component: PropertyListPage,
});

function PropertyListPage() {
	const ctx = Route.useRouteContext() as AuthRouteContext;
	const role = ctx.role;
	const canCreate = hasRole(role, "PropertyManager");
	const { properties } = authRoute.useLoaderData();

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Properties</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Manage your organization's properties and locations.
					</p>
				</div>
				{canCreate && (
					<Button asChild>
						<Link to="/properties/new">
							<Plus />
							Add Property
						</Link>
					</Button>
				)}
			</div>

			{properties.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
					<p className="text-muted-foreground">No properties yet.</p>
					<p className="text-sm text-muted-foreground">
						Add your first property to get started.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{properties.map((p) => (
						<Link
							key={p.id}
							to="/properties/$propertyId"
							params={{ propertyId: p.id }}
							className="block rounded-lg border p-4 transition-colors hover:bg-accent"
						>
							<div className="flex items-center justify-between">
								<div className="flex flex-col gap-1">
									<p className="font-semibold">{p.name}</p>
									<div className="flex items-center gap-2">
										<Badge variant="secondary">{p.slug}</Badge>
										<span className="text-sm text-muted-foreground">
											{p.timezone}
										</span>
									</div>
								</div>
								<ChevronRight className="size-4 text-muted-foreground" />
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
```

Key changes:
- No loader — reads from `getRouteApi('/_authenticated').useLoaderData()`
- Removed `listProperties` import
- `Route.useLoaderData()` replaced with `authRoute.useLoaderData()`

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/index.tsx
git commit -m "perf: properties list reads parent loader data"
```

---

## Task 5: Members page — remove duplicate fetch

**Files:**
- Modify: `src/routes/_authenticated/properties/$propertyId/members.tsx`

- [ ] **Step 1: Remove listProperties from members loader**

In `src/routes/_authenticated/properties/$propertyId/members.tsx`, make two changes:

**Change 1: Remove the `listProperties` import.** Replace line 14:

```typescript
import { listProperties } from '#/contexts/property/server/properties'
```

with:

```typescript
import { getRouteApi } from '@tanstack/react-router'
```

**Change 2: Rewrite the loader to not fetch properties.** Replace the `loader` function (lines 34-41):

```typescript
  loader: async () => {
    const [{ properties }, { members }, { invitations }] = await Promise.all([
      listProperties(),
      listMembers(),
      listInvitations(),
    ])
    return { properties, members, invitations }
  },
```

with:

```typescript
  loader: async () => {
    const [{ members }, { invitations }] = await Promise.all([
      listMembers(),
      listInvitations(),
    ])
    return { members, invitations }
  },
```

**Change 3: Update data destructuring in the component.** Replace line 50:

```typescript
  const { properties, members, invitations } = Route.useLoaderData()
```

with:

```typescript
  const { members, invitations } = Route.useLoaderData()
  // Properties come from parent layout loader, not this route's loader
  const { properties } = getRouteApi('/_authenticated').useLoaderData()
```

Add the import for `getRouteApi` at the top alongside the existing `createFileRoute` import from `@tanstack/react-router` (line 4), changing:

```typescript
import { createFileRoute } from '@tanstack/react-router'
```

to:

```typescript
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
```

Note: You can remove the `listProperties` import from line 14 entirely since it's no longer used.

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/members.tsx
git commit -m "perf: members page reads properties from parent loader"
```

---

## Task 6: Org staff page — add staleTime

**Files:**
- Modify: `src/routes/_authenticated/staff/index.tsx`

**Note:** The org staff loader legitimately needs `listProperties()` — it iterates over all properties to aggregate staff assignments. Unlike dashboard/properties-list, it can't just read parent data in the component because the aggregation happens inside the server-side loader.

With the parent `_authenticated` route having `staleTime: Infinity`, the `listProperties()` call here benefits from the parent's cached data — TanStack Router deduplicates concurrent loader calls to the same server function. So this `listProperties()` is effectively free after the parent loads.

The fix is adding `staleTime: 30_000` so this route's data stays fresh across tab switches.

- [ ] **Step 1: Add staleTime to the org staff route**

In `src/routes/_authenticated/staff/index.tsx`, add `staleTime: 30_000` to the route definition.

Change:
```typescript
export const Route = createFileRoute("/_authenticated/staff/")({
	loader: async () => {
```

To:
```typescript
export const Route = createFileRoute("/_authenticated/staff/")({
	staleTime: 30_000,
	loader: async () => {
```

No other changes to this file.

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/staff/index.tsx
git commit -m "perf: add staleTime to org staff route"
```

---

## Task 7: Targeted invalidation in useMutationAction

**Files:**
- Modify: `src/components/hooks/use-mutation-action.ts`

- [ ] **Step 1: Add invalidateRoutes option to MutationActionOptions**

In `src/components/hooks/use-mutation-action.ts`, add `invalidateRoutes` to the `MutationActionOptions` interface (after line 33, before line 34):

```typescript
export interface MutationActionOptions<TOutput> {
	/** Message shown via toast.success on success. Defaults to 'Saved'. */
	successMessage?: string;
	/** Whether to call router.invalidate() after success. Defaults to true. */
	invalidate?: boolean;
	/** Navigate after success. */
	navigateTo?: string;
	/** Custom post-success callback (runs after invalidate and toast). */
	onSuccess?: (output: TOutput) => void | Promise<void>;
	/**
	 * Route path patterns to invalidate instead of all routes.
	 * When provided, only matching routes are invalidated.
	 * When undefined (default), router.invalidate() invalidates everything.
	 */
	invalidateRoutes?: string[];
}
```

- [ ] **Step 2: Update useMutationAction to use invalidateRoutes**

Replace the `useMutationAction` function body (lines 46-72) with:

```typescript
export function useMutationAction<TFn extends (...args: any[]) => Promise<any>>(
	serverFn: TFn,
	options?: MutationActionOptions<Awaited<ReturnType<TFn>>>,
): Action<Parameters<TFn>[0], Awaited<ReturnType<TFn>>> {
	const router = useRouter();
	const rawAction = useAction(useServerFn(serverFn));

	const {
		successMessage = "Saved",
		invalidate = true,
		invalidateRoutes,
		navigateTo,
		onSuccess,
	} = options ?? {};

	return wrapAction(rawAction, async (output) => {
		if (invalidate) {
			if (invalidateRoutes && invalidateRoutes.length > 0) {
				for (const routePath of invalidateRoutes) {
					await router.invalidate({ filter: (route) =>
						route.routeId === routePath
					});
				}
			} else {
				await router.invalidate();
			}
		}

		toast.success(successMessage);

		if (onSuccess) {
			await onSuccess(output);
		}

		if (navigateTo) {
			router.navigate({ to: navigateTo });
		}
	});
}
```

- [ ] **Step 3: Update useMutationActionSilent similarly**

Replace the `useMutationActionSilent` function (lines 78-101) with:

```typescript
export function useMutationActionSilent<
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	TFn extends (...args: any[]) => Promise<any>,
>(
	serverFn: TFn,
	options?: {
		invalidate?: boolean;
		invalidateRoutes?: string[];
		onSuccess?: (output: Awaited<ReturnType<TFn>>) => void | Promise<void>;
	},
): Action<Parameters<TFn>[0], Awaited<ReturnType<TFn>>> {
	const router = useRouter();
	const rawAction = useAction(useServerFn(serverFn));

	const { invalidate = true, invalidateRoutes, onSuccess } = options ?? {};

	return wrapAction(rawAction, async (output) => {
		if (invalidate) {
			if (invalidateRoutes && invalidateRoutes.length > 0) {
				for (const routePath of invalidateRoutes) {
					await router.invalidate({ filter: (route) =>
						route.routeId === routePath
					});
				}
			} else {
				await router.invalidate();
			}
		}
		if (onSuccess) {
			await onSuccess(output);
		}
	});
}
```

- [ ] **Step 4: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add src/components/hooks/use-mutation-action.ts
git commit -m "feat: add invalidateRoutes option for targeted cache invalidation"
```

---

## Task 8: Add staleTime to property-scoped routes

**Files:**
- Modify: `src/routes/_authenticated/properties/$propertyId.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/teams/index.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/teams/$teamId.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/staff/index.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/members.tsx`

- [ ] **Step 1: Add staleTime to each route**

For each file, add `staleTime` between the `createFileRoute(...)` opening and the `loader`:

**`src/routes/_authenticated/properties/$propertyId.tsx`** — add `staleTime: 60_000`:
```typescript
export const Route = createFileRoute("/_authenticated/properties/$propertyId")({
	staleTime: 60_000,
	loader: async ({ params: { propertyId } }) => {
```

**`src/routes/_authenticated/properties/$propertyId/portals/index.tsx`** — add `staleTime: 30_000`:
```typescript
export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
	staleTime: 30_000,
	loader: async ({ params }) => {
```

**`src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`** — add `staleTime: 30_000`:
```typescript
export const Route = createFileRoute(
	'/_authenticated/properties/$propertyId/portals/$portalId',
)({
	staleTime: 30_000,
	loader: async ({ params }) => {
```

**`src/routes/_authenticated/properties/$propertyId/teams/index.tsx`** — add `staleTime: 30_000`:
```typescript
export const Route = createFileRoute('/_authenticated/properties/$propertyId/teams/')({
	staleTime: 30_000,
	loader: async ({ params: { propertyId } }) => {
```

**`src/routes/_authenticated/properties/$propertyId/teams/$teamId.tsx`** — add `staleTime: 30_000`:
```typescript
export const Route = createFileRoute(
	'/_authenticated/properties/$propertyId/teams/$teamId',
)({
	staleTime: 30_000,
	loader: async ({ params }) => {
```

**`src/routes/_authenticated/properties/$propertyId/staff/index.tsx`** — add `staleTime: 30_000`:
```typescript
export const Route = createFileRoute("/_authenticated/properties/$propertyId/staff/")({
	staleTime: 30_000,
	loader: async ({ params: { propertyId } }) => {
```

**`src/routes/_authenticated/properties/$propertyId/members.tsx`** — add `staleTime: 30_000`:
```typescript
export const Route = createFileRoute('/_authenticated/properties/$propertyId/members')({
	staleTime: 30_000,
	loader: async () => {
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/
git commit -m "perf: add per-route staleTime to property-scoped routes"
```

---

## Task 9: Sidebar — remove unbuilt nav items

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Remove reviews and metrics nav items**

In `src/components/layout/AppSidebar.tsx`, remove the `reviews` and `metrics` entries from the `navItems` array (lines 81-94):

Remove these two objects:
```typescript
  {
    key: 'reviews',
    label: 'Reviews',
    icon: MessageSquare,
    to: '/properties/$propertyId/reviews' as const,
    disabled: true,
  },
  {
    key: 'metrics',
    label: 'Metrics',
    icon: BarChart3,
    to: '/properties/$propertyId/metrics' as const,
    disabled: true,
  },
```

Also remove the `MessageSquare` and `BarChart3` imports from `lucide-react` (line 7-8) since they're no longer used:

Change:
```typescript
import {
  LayoutDashboard,
  Users,
  Globe,
  MessageSquare,
  BarChart3,
  Contact,
  ChevronRight,
  Building2,
  ChevronsUpDown,
  Settings2,
} from 'lucide-react'
```

To:
```typescript
import {
  LayoutDashboard,
  Users,
  Globe,
  Contact,
  ChevronRight,
  Building2,
  ChevronsUpDown,
  Settings2,
} from 'lucide-react'
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppSidebar.tsx
git commit -m "ui: remove unbuilt reviews and metrics sidebar nav items"
```

---

## Task 10: Top bar — conditional property switcher

**Files:**
- Modify: `src/components/layout/AppTopBar.tsx`

- [ ] **Step 1: Make property switcher conditional on property count**

In `src/components/layout/AppTopBar.tsx`, replace the property switcher section (lines 87-118) with conditional rendering.

Replace:
```typescript
			{/* Property switcher */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" className="gap-2 px-2">
						<span className="text-sm font-medium">
							{currentProperty?.name ?? "Select property"}
						</span>
						<ChevronsUpDown className="size-3.5 text-muted-foreground" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64">
					{properties.length === 0 ? (
						<div className="px-2 py-4 text-center text-sm text-muted-foreground">
							No properties yet
						</div>
					) : (
						properties.map((p) => (
							<DropdownMenuItem
								key={p.id}
								onClick={() => handlePropertySwitch(p.id)}
							>
								{p.name}
								{p.id === propertyId && (
									<span className="ml-auto text-xs text-muted-foreground">
										Active
									</span>
								)}
							</DropdownMenuItem>
						))
					)}
				</DropdownMenuContent>
			</DropdownMenu>
```

With:
```typescript
			{/* Property switcher — interactive for multi-property, static for single */}
			{properties.length > 1 ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" className="gap-2 px-2">
							<span className="text-sm font-medium">
								{currentProperty?.name ?? "Select property"}
							</span>
							<ChevronsUpDown className="size-3.5 text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-64">
						{properties.map((p) => (
							<DropdownMenuItem
								key={p.id}
								onClick={() => handlePropertySwitch(p.id)}
							>
								{p.name}
								{p.id === propertyId && (
									<span className="ml-auto text-xs text-muted-foreground">
										Active
									</span>
								)}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				currentProperty && (
					<span className="text-sm font-medium text-muted-foreground">
						{currentProperty.name}
					</span>
				)
			)}
```

Key changes:
- `properties.length > 1`: show interactive dropdown
- Otherwise: show plain text with property name (or nothing if no property)

- [ ] **Step 2: Verify build passes**

Run: `pnpm tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppTopBar.tsx
git commit -m "ui: static property name for single-property users"
```

---

## Task 11: Verify end-to-end

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run dev server and verify routes**

Run: `pnpm dev`

Verify:
1. Login redirects to dashboard
2. Dashboard redirects to first property (if single property)
3. Dashboard shows property list (if multiple properties)
4. Navigate between property tabs — no loading spinner flash for cached data
5. Create/edit a portal — only portal routes reload, not the whole app
6. Sidebar shows: Overview, Staff, Teams, Portals, Members (no Reviews/Metrics)
7. Top bar shows static property name for single property, dropdown for multiple

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: verify data loading and UI refinement changes"
```
