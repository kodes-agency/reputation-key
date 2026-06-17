# ADR 0016: Active Property as URL Query-Param Context

**Status:** Accepted
**Date:** 2026-06-16
**Context:** Navigation, Property Selection, TanStack Router

## Context

The app has two kinds of surfaces:

- **Property-scoped pages** under `/properties/$propertyId/...` (dashboard, reviews, portals, goals) — the property is in the URL path.
- **Cross-property pages** outside that path — the unified inbox (`/inbox`), the dashboard fleet overview, leaderboards — which are intentionally property-agnostic (e.g. the inbox lists items across all properties).

`usePropertyId()` derived the "current property" **only** from the URL path (`/properties/([^/]+)`). On any cross-property page the path has no property, so:

1. The `ManagerPropertySwitcher` sidebar widget showed "Select property" (no active property).
2. Navigating from a property to a cross-property page and back felt like "losing your place" — the user had to re-select the property.

This was reported as a top UX pain ("when I go to inbox and come back I again need to select a property").

### Alternatives considered

- **Session-storage app state** — the shell tracks the last-selected property in `sessionStorage`; the switcher reads/sets it; survives all navigation. Pros: seamless, no URL clutter. Cons: introduces a new client state layer with SSR/desync risk (the server-rendered shell wouldn't know the active property), and cross-property links aren't shareable with a property preselected.
- **Hybrid** — session-storage for the switcher plus `?propertyId=` on cross-property pages. Cons: two sources of truth that can disagree; complexity for no gain over the query-param alone.

## Decision

Carry the active property as a **URL query parameter (`?propertyId=X`)** on cross-property pages, and extend `usePropertyId()` to read it (path first, then the `?propertyId=` search param).

- The `ManagerPropertySwitcher` sets the param when the user picks a property.
- Cross-property pages (`/inbox`, fleet overview, etc.) carry and preserve the param through their internal navigation (TanStack Router `validateSearch`).
- The param is **context, not a forced filter** — e.g. the inbox still lists items across all properties; the param only keeps the switcher + "back" context correct.
- Property-scoped pages keep using the path (`/properties/$propertyId/...`); the param is redundant there and may be absent.
- The fleet overview (multi-property landing) has no single active property by design — the param is absent there, which is correct.

## Consequences

**Positive:**

- Matches the existing URL-centric architecture (TanStack Router `validateSearch`, SSR loaders) and the established `?timeRange=` pattern on the dashboard — no new state layer.
- Shareable: a link to `/inbox?propertyId=X` opens the inbox with the property preselected in the switcher.
- SSR-safe and desync-free — the active property is in the URL, so the server-rendered shell and the client agree.
- Directly fixes the "lose my property when navigating to/from the inbox" pain.

**Negative:**

- Cross-property URLs carry an extra param; navigations must thread it through (missed `validateSearch`/`search` mappings drop it silently).
- The param is one more thing to keep consistent across the cross-property routes; a shared search-schema helper mitigates this.

## Related

- [ADR 0002 — Section-Based Navigation](./0002-section-based-navigation.md)
- `src/routes/CONTEXT.md` (data-loading + `validateSearch` conventions)
- `src/components/hooks/use-property-id.ts` (the hook this extends)
