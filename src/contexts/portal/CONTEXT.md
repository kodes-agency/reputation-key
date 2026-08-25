# Portal Context

## Bounded context

Portal page management — creation, configuration, theming, link management, image uploads, and portal groups.

## Glossary

- **Portal** — A rating-first public review gateway for a property, team, or staff participant, with an optional secondary link tree.
- **EntityType** — The kind of entity a portal belongs to: `property`, `team`, or `staff`.
- **PortalLinkCategory** — Grouping container for links within a portal. Has title and sort key.
- **PortalLink** — An external link within a portal category. Has label, URL, icon, and sort key.
- **PortalTheme** — Visual customization: `primaryColor`, optional `backgroundColor`, `textColor`.
- **Private Feedback Threshold** — Inclusive 1–5 threshold (default 3) captured with a guest rating. Ratings at or below it may add an optional private note after the same Google Review Action shown to every rating.
- **Portal Group** — A named collection of portals within a property. Used for goal scoping and leaderboard ranking. One portal belongs to at most one group. Metrics are always aggregated from member portals at query time (no pre-computed group metrics).
- **Ungrouped Portal** — A portal not assigned to any portal group. Still individually targetable by goals and rankable on leaderboards.
- **Portal Creator** — Immutable provenance for who created a portal. Creation does not permanently confer notification responsibility.
- **Portal Responsible Manager** — An effective-dated AccountAdmin or eligible PropertyManager assigned to receive and manage that portal's workflow notifications. Multiple managers are supported; assignment does not grant access or staff-performance attribution.
- **Responsibility Needed** — Visible recovery state when a non-archived portal has no assigned responsible manager. It is not an implicit AccountAdmin assignment.
- **Soft Delete** — Portals and portal groups are soft-deleted (marked `deletedAt`), not hard-deleted, to preserve referential integrity.

## Relationships

- Portal → Property (required `propertyId`).
- Portal → Team or Staff (via `entityType` + `entityId`).
- Portal → Portal Group (optional, via `portal_group_members`). One portal belongs to at most one group.
- Portal Group → Property (required `propertyId`). One property has many groups.
- Portal has many PortalLinkCategories, each with many PortalLinks.
- Portal has zero or more effective-dated Portal Responsible Managers (`portal_responsible_managers`).
- Guest context **depends on** `PortalPublicApi` for resolving portal context and public portal data.
- Goal context **subscribes to** `portal.deleted` events to cancel portal-scoped goals.
- Goal context **subscribes to** `portal_group.deleted` events to cancel portal-group-scoped goals.
- Goal context **depends on** `PortalGroupPublicApi.findGroupForPortal` to resolve group membership for metric events.

## Invariants

- Portal slugs must be unique within a property.
- Private Feedback Threshold must be an integer 1–5.
- Portal links belong to a category; categories belong to a portal.
- Only PM+ roles can create/update/delete portals.
- Portal group names must be unique within a property.
- One portal belongs to at most one portal group (enforced by unique index on `portal_group_members.portalId`).
- A portal group belongs to exactly one property.
- A Portal may have no secondary links. It cannot enter `published` unless its Property has a verified, provider-derived Google review destination.
- If that destination later becomes stale, unavailable, or temporarily unreadable, the published private rating/feedback gateway remains available in a degraded state. No stale URI is serialized and Google selection is denied with gentle guest copy.
- Public resolution fails closed when that Property destination is `awaiting_refresh` or `unavailable`; a stale URI is never rendered.
- Each successful public resolution creates an internal response-configuration contract with a SHA-256 digest of the exact resolved content, link order/destinations, Google availability/destination, threshold, locale, and language-pack version. The browser projection omits this evidence; Guest persists it atomically with a new private rating. The current public language contract is explicitly `en` / `guest-ui-en-v1` until the revisioned multilingual publication model replaces it.
- Soft-deleting a portal revokes its active/rotating portal tokens; a deleted portal never has a live token.
- The eligible creator is the initial Portal Responsible Manager. AccountAdmins are organization-wide eligible; PropertyManagers require both current property access and active participation for that property.
- Responsible-manager assignment never grants property access, portal access, or staff attribution.
- Responsible-manager updates preserve unchanged effective-dated intervals and use `responsibleManagerRevision` compare-and-swap; stale writes fail with `revision_conflict`.
- Losing the last manager sets `responsibilityNeededSince` and atomically records one identifier-only recovery fact. Adding any manager clears the state; nobody is auto-promoted.

## Events produced

- **`portal.created`** — portalId, organizationId, name, slug, occurredAt.
- **`portal.updated`** — portalId, organizationId, name, slug, occurredAt.
- **`portal.deleted`** — portalId, organizationId, occurredAt.
- **`portal.responsibility_became_needed`** — portalId, organizationId, propertyId, occurredAt. Identifier-only, atomically recorded with the unowned transition; Notification sends one content-free recovery alert to each current AccountAdmin.
- **`portal.token.issued`** — portalId, organizationId, propertyId, tokenIdentifier, version, occurredAt.
- **`portal.token.rotated`** — portalId, organizationId, propertyId, previousVersion, version, gracePeriodEnds, occurredAt.
- **`portal.token.revoked`** — portalId, organizationId, propertyId, occurredAt. Identifier-only audit fact; no consumers.
- **`portal_group.created`** — portalGroupId, organizationId, propertyId, name, occurredAt.
- **`portal_group.updated`** — portalGroupId, organizationId, propertyId, name, occurredAt.
- **`portal_group.deleted`** — portalGroupId, organizationId, propertyId, occurredAt.
- **`portal_group.portal_added`** — portalGroupId, portalId, organizationId, occurredAt.
- **`portal_group.portal_removed`** — portalGroupId, portalId, organizationId, occurredAt.
- **`portal_link_category.created`** — portalId, categoryId, organizationId, occurredAt.
- **`portal_link_category.reordered`** — portalId, organizationId, occurredAt.
- **`portal_link.created`** — portalId, linkId, categoryId, organizationId, occurredAt.
- **`portal_link.reordered`** — portalId, categoryId, organizationId, occurredAt.
  > **Subscriber status:** `portal.created`, `portal.updated`, and `portal.deleted` are
  > reserved for future activity-audit handlers. The remaining link/category/group events
  > (`portal_group.created`, `portal_group.updated`, `portal_group.portal_added`,
  > `portal_group.portal_removed`, `portal_link_category.created`,
  > `portal_link_category.reordered`, `portal_link.created`, `portal_link.reordered`) are
  > **fire-and-forget** — they have no current subscriber but are cheap to emit and may be
  > needed for real-time UI updates. They are intentionally retained for future extensibility.

## Events consumed

None. Portal context does not subscribe to events from other contexts.

## Architecture layers

```
portal/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             portal.repository.ts, portal-group.repository.ts, portal-link.repository.ts,
                       portal-token.repository.ts, portal-token-codec.port.ts,
                       storage.port.ts, link-resolver.port.ts
    dto/               create-portal.dto.ts, update-portal.dto.ts,
                       create-portal-group.dto.ts, update-portal-group.dto.ts,
                       portal-link.dto.ts, portal-link-category.dto.ts
    use-cases/         create-portal.ts, update-portal.ts, get-portal.ts, list-portals.ts,
                       soft-delete-portal.ts, create-link.ts, update-link.ts, delete-link.ts,
                       create-link-category.ts, update-link-category.ts, delete-link-category.ts,
                       reorder-links.ts, reorder-categories.ts, request-upload-url.ts,
                       finalize-upload.ts, list-portal-links.ts,
                       create-portal-group.ts, update-portal-group.ts, soft-delete-portal-group.ts,
                       list-portal-groups.ts, get-portal-group.ts,
                       add-portal-to-group.ts, remove-portal-from-group.ts,
                       issue-portal-token.ts, rotate-portal-token.ts, revoke-portal-tokens.ts,
                       resolve-public-portal-token.ts, complete-content-review.ts,
                       portal-responsible-managers.ts
    public-api.ts      re-exports port types, PortalPublicApi, PortalGroupPublicApi, event types/constructors
  infrastructure/
    repositories/      portal.repository.ts, portal-group.repository.ts, portal-link.repository.ts,
                       portal-token.repository.ts, portal-scope.repository.ts,
                       portal-responsible-manager.repository.ts,
                       link-resolver.repository.ts (Drizzle)
    adapters/          s3-storage.adapter.ts
    mappers/           portal.mapper.ts, portal-group.mapper.ts, portal-link.mapper.ts
    jobs/              process-image.job.ts
  server/              portals.ts, portal-groups.ts, portal-links.ts,
                       portal-responsible-managers.ts,
                       portal-link-categories.ts, property-scope.ts
  build.ts             composition root
```

## Use cases

- **`createPortal`** — Create a new portal for a property/entity. Validates property exists via PropertyPublicApi.
- **`updatePortal`** — Update portal settings (name, slug, description, hero image, theme, Private Feedback Threshold, publication state). `heroImageUrl: null` clears the hero image. Rejects publication without a verified Property-owned Google review destination.
- **`getPortal`** — Retrieve a single portal by ID, plus `tokenStatus` (C2): whether a public token still resolves (active, or rotating inside its grace window — same predicate as public token resolution), its version, issue time and grace end. Metadata only: the raw token and its digest are returned by issue/rotate alone.
- **`listPortals`** — List portals for an org/property with filters.
- **`softDeletePortal`** — Soft-delete a portal, revoke its portal tokens, emits `portal.deleted` (and `portal.token.revoked` when tokens were live).
- **`createLink`** / **`updateLink`** / **`deleteLink`** — Manage portal links.
- **`createLinkCategory`** / **`updateLinkCategory`** / **`deleteLinkCategory`** — Manage link categories.
- **`reorderLinks`** / **`reorderCategories`** — Reorder items by sort key.
- **`requestUploadUrl`** / **`finalizeUpload`** — S3 presigned URL flow for hero images.
- **`listPortalLinks`** — List all links for a portal (flat, with category info).
- **`createPortalGroup`** — Create a new portal group for a property. Validates name uniqueness and portal memberships. Optionally adds initial portals (pre-validated).
- **`updatePortalGroup`** — Update group name. Validates name uniqueness (excluding self).
- **`softDeletePortalGroup`** — Soft-delete a group, emits `portal_group.deleted`. Does not cascade-remove portal memberships.
- **`listPortalGroups`** — List groups for an org/property.
- **`getPortalGroup`** — Retrieve a single group by ID.
- **`addPortalToGroup`** — Add a portal to a group. Validates portal not already in another group.
- **`removePortalFromGroup`** — Remove a portal from its group. Validates portal was in the group.
- **`issuePortalToken`** / **`rotatePortalToken`** / **`revokePortalTokens`** — Portal token lifecycle for public QR links.
- **`resolvePublicPortalToken`** — Resolve a public token to its portal, honouring rotation grace periods.
- **`completeContentReview`** — Record a completed portal content review and emit the derived workflow facts.
- **`listPortalResponsibleManagers`** — Return current assignments, currently eligible candidates, responsibility-needed state, and the CAS revision.
- **`updatePortalResponsibleManagers`** — Replace the manager set after revalidating every selected manager; supports multiple or zero and preserves effective-dated history.

## Public API

Exported from `application/public-api.ts`:

- Types: `StoragePort`, `LinkResolverPort`, `PortalContextResult`, `PublicPortalBySlugResult`, `PortalPublicApi`
- `PortalPublicApi.getResponsibleManagerUserIds` returns only current assignments that remain role/access/participation eligible at read/delivery time.
- Types: `PortalGroupPublicApi` (exposes `findGroupForPortal`), `PortalTokenStatus` (token existence/metadata for management surfaces — never token material)
- Functions: `isValidExternalUrl` (https-only link-destination guard, used by the public redirect route)
- Event types: `PortalDeleted`, `PortalResponsibilityNeeded`, `PortalEvent`, `PortalGroupDeleted`
- Event constructors: `portalDeleted`, `portalGroupDeleted`

## Server functions

- **`portals.ts`** — CRUD, read, image-upload, and portal-token server functions for portals (create/update/list/get/delete portal, request/finalize upload, issue/rotate/revoke token).
- **`portal-links.ts`** — CRUD server functions for portal links and link categories.
- **`portal-groups.ts`** — CRUD server functions for portal groups and portal membership management.
- **`portal-responsible-managers.ts`** — scoped list/update endpoints for responsible-manager assignments and CAS conflict handling.
- **`portal-link-categories.ts`** — Server functions for portal link category CRUD operations.

## Permissions

- `portal.read` — View portals, portal links, and portal groups.
- `portal.update` — Update portal settings, links, link categories, and portal groups (including membership).
- `portal.create` — Create new portals and portal groups.
- `portal.delete` — Soft-delete portals and portal groups.

## Background jobs

- **process-image** — Resizes and converts uploaded portal hero images to multiple variants.
