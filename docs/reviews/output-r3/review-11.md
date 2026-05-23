# Review 11: Multi-tenancy & Tenant Isolation

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Scope

All repository methods in `src/contexts/*/infrastructure/repositories/`, all server functions in `src/contexts/*/server/`, and event handlers in `src/contexts/*/infrastructure/event-handlers/`.

---

## Findings

### [MAJOR] Guest-facing `resolveLinkAndTrack` has no tenant scoping on the link lookup

File: `src/contexts/guest/server/public.ts:250-267`
Quote: ```ts
export const resolveLinkAndTrack = createServerFn({ method: 'GET' })
.inputValidator(resolveLinkSchema)
.handler(
tracedHandler(
async ({ data }) => {
const { useCases } = getContainer()
try {
return await useCases.resolveLinkAndTrack({ linkId: portalLinkId(data.linkId) })
} catch (e) { ... }
},

````
Rule: Guest-facing endpoints must not leak other tenants' data. The `resolveLinkAndTrack` use case takes only a `linkId` — no `organizationId`.
Fix: Verify that the `resolveLinkAndTrack` use case and underlying repository query join back to the link's portal → property → organization before returning the URL. If it only queries by `linkId`, any link ID could be resolved regardless of tenant. The link resolver repository must verify the link belongs to an active, published portal.

### [MAJOR] `resolveReferralCode` use case takes `orgId` but no auth check

File: `src/contexts/staff/application/use-cases/resolve-referral-code.ts`
Quote: ```ts
export const resolveReferralCode =
  (deps: ResolveReferralCodeDeps) =>
  async (orgId: OrganizationId, code: string): Promise<StaffId | null> => {
    const assignment = await deps.staffRepo.findByReferralCode(orgId, code)
````

Rule: This is a public (guest) use case — it correctly takes `orgId` to scope the lookup. However, the `orgId` comes from the portal context resolution, not from the caller directly. The risk is that if the portal context resolver has a bug, referral codes could leak across tenants.
Fix: Verify the portal context resolver always returns the correct `organizationId`. The current chain is: `resolvePortalContext({ portalId })` → looks up portal → returns `{ organizationId, propertyId }`. This is correct as long as the portal lookup is by unique slug pair, not just portalId.

### [MINOR] `getPublicPortal` server function has no tenant validation

File: `src/contexts/guest/server/public.ts:100-120`
Quote: ```ts
return await useCases.getPublicPortal({
propertySlug: data.propertySlug,
portalSlug: data.portalSlug,
})

````
Rule: Guest-facing endpoint — must verify it cannot return data from inactive portals of other tenants.
Fix: The lookup is by `(propertySlug, portalSlug)` which are unique per tenant. The use case verifies portal is active. This is safe as long as slug uniqueness is enforced at the DB level with a composite unique index across the organization boundary.

### [MINOR] Event handlers use `event.organizationId` correctly

File: All event handlers in `src/contexts/*/infrastructure/event-handlers/`
Quote: Every event handler passes `event.organizationId` to repository methods. For example, `on-metric-recorded.ts:51`:
```ts
event.organizationId,
````

Rule: No cross-tenant data access in event handlers.
Fix: **No issue found.** Event handlers correctly scope all operations to the event's `organizationId`.

### [MINOR] Dashboard stats correctly scoped by `organizationId`

File: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`
Quote: Every method takes `organizationId` from `input` and passes it to stats adapters:

```ts
const { organizationId, propertyId, limit = 5 } = input
```

Rule: Dashboard stats must be scoped to the correct organization.
Fix: **No issue found.** Dashboard repository consistently uses `organizationId` in all queries.

---

## Positive Observations

- **Repository pattern is consistently tenant-scoped.** Every repository method takes `orgId` as a parameter and uses it in WHERE clauses:
  - `goal.repository.ts` — `eq(goals.organizationId, orgId)` in all queries
  - `inbox.repository.ts` — `eq(inboxItems.organizationId, orgId)` in all queries
  - `google-connection.repository.ts` — filters by `orgId` in all methods
  - `gbp-import.repository.ts` — filters by `orgId` in all queries
  - `guest-interaction.repository.ts` — `orgId` parameter in all lookups
  - `property.repository.ts`, `portal.repository.ts`, `portal-link.repository.ts` — all filter by org
  - `team.repository.ts` — `findById(ctx.organizationId, ...)`
  - `staff-assignment.repository.ts` — scoped by org

- **Server functions never trust client-provided orgId.** Every authenticated server function resolves `organizationId` from the session via `resolveTenantContext(headers)`, not from the request payload.

- **Guest-facing server functions resolve org from portal context.** `recordScanFn`, `submitRatingFn`, `submitFeedbackFn` all call `useCases.resolvePortalContext({ portalId })` which returns the org/property IDs from the DB, preventing tenant spoofing.

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 3     |
| NIT      | 0     |

**Most important thing to fix first:** Verify that `resolveLinkAndTrack` (the public click-tracking endpoint) cannot resolve links from other tenants. The use case takes only a `linkId` without an `organizationId` — confirm the repository joins through portal → property to enforce tenant isolation, or add an `organizationId` parameter derived from the link's owning portal.
