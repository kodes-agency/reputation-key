---
status: accepted
date: 2026-10-28
---

# 0072 — The shell's checks are remembered in the browser for 30 seconds

Refines the authenticated layout contract in `src/routes/CONTEXT.md` ("Authenticated
layout") and the controlled-route gate and capability set that [ADR 0049](0049-beta-local-acceptance.md)
introduced.
It changes when the browser asks; it does not change who decides.

## Context

`_authenticated.tsx`'s `beforeLoad` runs on every navigation: a click, a search-only
change (every keystroke of a URL-bound search) and a hover preload. Each run asked the
server three questions, the session, the active Organization with the person's role,
and the capability set for the Property in scope, and a controlled route asked a
fourth (`checkControlledRoute`) in its own `beforeLoad`. The 2026-10-28 layout audit
measured 3 shell calls per navigation and 12 to 20 requests per hover preload. The
router awaits every `beforeLoad` before any loader, so each of those calls stands in
front of the page.

The owner approved remembering the answers in the browser for 30 seconds, knowing it
touches the sign-in boundary.

## Decision

1. **The server never remembers.** `getRouter` makes a QueryClient per call, and the
   server calls it per request. On the server the shell and the gates call their server
   functions directly and write nothing to that QueryClient, so no answer can reach
   another request or ride the dehydrated cache into a browser. A full page load is
   always checked fresh.
2. **The browser remembers four kinds of answer for 30 seconds** in its Query cache
   (`src/shared/queries/shell-context-cache.ts`, `src/shared/shell-context/`):
   - the session, only when there is one;
   - the active Organization answer, only one that lets the person into the shell;
   - the capability set, per Property scope;
   - each controlled-route decision, per capability and Property.

   The session is the answer to who the person is, so it is the one entry not under a
   user id; every other entry is under the user id of the session that was fresh when
   it was read, and a session for a different person removes the old person's entries.
   With a fresh session the Organization and capability set are read from their entries,
   each asked again only when missing or stale; with no fresh session all three are
   asked at once, as before, and remembered after. A hover preload and the click after
   it share one such question while it is out; an answer to a question asked before a
   forget (decision 5) is used for that navigation and never remembered.

3. **The decisions do not move.** `beforeLoad` still decides in the same order from the
   same three settled answers: no session, then an Organization failure
   (`organizationLoadFailure`: a 401 to login, `no_active_org` and a disabled workspace
   to `/unavailable`), then a capability redirect; a failed capability read is still the
   empty set. Failures, a missing session and a refused workspace are never
   remembered, so the next navigation asks again. A 401 from any of the three forgets
   everything.
4. **The gate remembers its own decision** rather than reading `context.capabilities`.
   That set is resolved for the Property in the address, a `?propertyId=` included,
   which an Organization-wide page such as Portals may carry without being scoped to
   it, and it falls back to the empty set when its read fails, which would refuse a page
   the gate would have opened. Only a decision asked with the gate's own input is the
   same decision.
5. **Forgetting.** `invalidateShellContext(queryClient)` removes every entry and tells
   the person's other tabs (a `BroadcastChannel`). It runs after:
   - sign-in, sign-out and an Organization change, through the tenant cache transitions,
     which clear the whole cache and announce;
   - a password change, which replaces the session and calls `ensureActiveOrg`;
   - the person's profile save (name, avatar), before the shell reads the session again;
   - an Organization update (name, logo), which the sidebar shows;
   - a member's role change, removal or Property access save, and leaving the
     Organization, because the member may be the reader;
   - any 401 or 403 a route error boundary meets (`useGuardedRouteError`).

   The browser router also forgets the entries when the tab becomes visible again and
   when another tab announces a change (`forgetShellContextOnReturn`).

## The boundary

The route context is a navigation affordance and was never the boundary: every server
function behind a page resolves the tenant from the request and asserts the session,
role, permission and capability on its own, on every call. A remembered answer can at
most draw the shell, or open a page's `beforeLoad`, with what the server said up to 30
seconds ago; the page's own reads are refused by the server if that is no longer true,
and the refusal is what the person sees (a 401 sends them to sign in). The refusal
then forgets the entries, so the next navigation and Try again ask afresh.

## Consequences

- A navigation within 30 seconds of the last check makes no shell or gate request;
  the first client navigation after a page load still asks, because the server's
  answers are not handed to the browser cache (decision 1).
- A role, Organization or feature changed by someone else is seen within 30 seconds,
  or at once on the reader's next refused read. A change by the reader is seen at once.
- Two windows of the same browser, both visible, signed in as different people one
  after the other: the window that did not sign in keeps the old person's shell until
  the announcement reaches it, its next refused read or 30 seconds, while its page
  reads answer as the cookie's person. The announcement covers every browser with
  `BroadcastChannel`. A sign-in or sign-out announces a tenant change, and the
  receiving tab drops every Query entry (not only the shell's) and reloads the page it
  is on; a tab that was away and finds a different person at its next check does the
  same, so the previous person's pages are never shown under the new person's shell.
- A refusal that never reaches a route error boundary (a role notice rendered as Not
  Found, a refused mutation) does not forget the entries: a stale "allowed" lasts at
  most 30 seconds, and the page's own server functions still refuse.
- A page whose route data is still fresh in the Query cache can be reopened from it
  within the same 30 seconds after a permission was withdrawn; it was fetched while the
  person was allowed, and the next fetch is refused.
- A forget that lands while a check is out cancels that check; the cancelled answer is
  asked for again directly and not remembered.
- A new mutation that changes what the shell shows or decides from must call
  `invalidateShellContext`; `shell-context-invalidation-sites.test.ts` lists the
  current sites.
