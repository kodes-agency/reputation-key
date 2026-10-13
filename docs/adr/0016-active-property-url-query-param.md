---
status: accepted
date: 2026-06-16
---

# 0016 — Active Property as URL Query-Param Context

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

## Amended 2026-10-13 — the path carries the active Property; `?propertyId=` is a scope where it is read

The Decision above describes the app before the Inbox workspace (ADR 0057,
Inbox queues). Three of its statements no longer hold, and a page built from
them would be wrong, so this section replaces them. `usePropertyId()` and its
order (path first, then `?propertyId=`) stand.

**The active Property is in the path.** The sidebar's property tile navigates by
path and writes no query param (`ManagerSidebar`, `handlePropertySwitch`): to
`/properties/$propertyId`, or, inside the Inbox, to that Property's Reviews page.
Every page about one Property lives under `/properties/$propertyId/...`, so the
shell (the tile, the nav links, the capability set `_authenticated` resolves in
`beforeLoad`) reads the Property from there.

**In the Inbox the Property is a scope, not context.** "All properties" is
`/inbox`; one Property is `/properties/$propertyId/reviews`, the same workspace
filtered to it. Changing the scope goes through `useInboxScopeNavigation`, which
keeps the queue, the filters and the sort and drops `propertyId` and the open
item. So the Inbox does not "carry and preserve the param", and the param is
not "context, not a forced filter" there.

**`?propertyId=` is still read, and it is never harmless.** `usePropertyId()`
reads it from the address on every page that is not under a Property's path, so
an address that carries the key makes that Property the shell's: the tile names
it, the nav links lead to it, and the capability set is resolved for it. It
must be a Property id; any other value is dropped. Three pages are linked with
it today:

- `/inbox?propertyId=X` is a deep link, written by notices and emails that are
  about one Property (`notificationLink`) and by that Property's own pages (its
  overview and attention band, its guest insights, its Portals' results). It
  narrows the list and the queue counts to that Property (`use-inbox-page.ts`),
  exactly as that Property's Reviews page does; it is a filter.
- `/settings/notifications?propertyId=X` names the Property whose notification
  preferences are being edited, and is honoured only while it names a Property
  the reader can see.
- `/settings/integrations?propertyId=X` is written by a Property's overview
  (`overview-profile-views.tsx`). The page does not read the key; it only keeps
  the shell on that Property.

`/settings/ai?propertyId=X` and `/progress?propertyId=X` are old links that
redirect to the Property's own page.

**A cross-property page that only filters uses another key.** `/notifications`
filters its feed with `?property=`, which `usePropertyId()` does not read: the
feed is narrowed and the shell stays on "All properties". `/properties`,
`/portals` and `/notifications` carry no active Property. A new cross-property
page takes `?propertyId=` only if it means to move the shell's Property with
it, and then says, as the Inbox does, that it is a scope.

The fleet overview and leaderboards the Context names are gone (the dashboard
path redirects to `/properties`); nothing else in the Context changed.

## Related

- `src/routes/CONTEXT.md` (data-loading + `validateSearch` conventions)
- `src/components/hooks/use-property-id.ts` (the hook this extends)
- `src/components/inbox/use-inbox-scope-navigation.ts` (the Inbox scope change)
- ADR 0057, Inbox queues (the workspace that made the Property a scope)
