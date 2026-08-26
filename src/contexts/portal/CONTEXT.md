# Portal Context

## Bounded context

Property-owned public review gateways. The private rating-first → Google Review
Action journey is primary; optional secondary links are a subordinate link tree.
The context also owns publication lifecycle, Portal Groups, responsible-manager
assignment, and governed access artifacts.

## Glossary

- **Portal** — A Property-owned, rating-first public review gateway with an optional secondary link tree and optional Staff performance attribution.
- **EntityType** — Legacy targeting field. New beta behavior is Property-owned; `team` must not create Team authority, and Staff association is attribution rather than ownership or access.
- **PortalLinkCategory** — Grouping container for links within a portal. Has title and sort key.
- **PortalLink** — An external link within a portal category. Has label, URL, icon, and sort key.
- **PortalTheme** — Visual customization: `primaryColor`, optional `backgroundColor`, `textColor`.
- **Private Feedback Threshold** — Inclusive 1–5 threshold (default 3) captured with a guest rating. Ratings at or below it may add an optional private note after the same Google Review Action shown to every rating.
- **Portal Publication Snapshot** — Immutable, manager-approved version of the exact rating-first public experience: resolved Portal content, ordered secondary links, threshold, locale/language pack, and verified Property-owned Google destination binding. Editing the working copy never mutates an active snapshot.
- **Portal Publication Activation** — Append-only effective-dated routing history from a stable Portal token to one exact publication snapshot. Publish and rollback add activations; disable/archive close the current activation.
- **Portal Publication History** — Manager read model that separates the current live activation from prior publish/rollback activity and reports whether saved Portal content differs from the live (or most recently active) immutable snapshot. Provider-owned Google destination refreshes do not masquerade as saved-content changes.
- **Portal Group** — A named collection of portals within a property. Used for shared goal scoping. One portal belongs to at most one group. Metrics are always aggregated from member portals at query time (no pre-computed group metrics).
- **Ungrouped Portal** — A portal not assigned to any portal group. It remains individually targetable by goals.
- **Portal Creator** — Immutable provenance for who created a portal. Creation does not permanently confer notification responsibility.
- **Portal Responsible Manager** — An effective-dated AccountAdmin or eligible PropertyManager assigned to receive and manage that portal's workflow notifications. Multiple managers are supported; assignment does not grant access or staff-performance attribution.
- **Responsibility Needed** — Visible recovery state when a non-archived portal has no assigned responsible manager. It is not an implicit AccountAdmin assignment.
- **Soft Delete** — Portals and portal groups are soft-deleted (marked `deletedAt`), not hard-deleted, to preserve referential integrity.
- **Portal Upload Issuance** — Opaque, single-use authorization for one Portal hero source object, bound to Organization, Property, Portal, MIME, exact declared size, purpose, and 15-minute expiry. Browser callers never submit or receive its object key as API data.

## Relationships

- Portal → Property (required `propertyId`).
- Retained `entityType`/`entityId` values may reference historical Team or Staff rows for reconciliation. They never change Property ownership, authorization, grouping, or notification responsibility.
- Portal → Portal Group (optional, via `portal_group_members`). One portal belongs to at most one group.
- Portal Group → Property (required `propertyId`). One property has many groups.
- Portal has many PortalLinkCategories, each with many PortalLinks.
- Portal has zero or more effective-dated Portal Responsible Managers (`portal_responsible_managers`).
- Portal has zero or more immutable Publication Snapshots and at most one current Publication Activation.
- Guest context **depends on** `PortalPublicApi` for resolving portal context and public portal data.
- Goal context **subscribes to** `portal.deleted` events to cancel portal-scoped goals.
- Goal context **subscribes to** `portal_group.deleted` events to cancel portal-group-scoped goals.
- Goal context **depends on** `PortalGroupPublicApi.findGroupForPortal` to resolve group membership for metric events.

## Invariants

- Portal slugs must be unique within a property.
- Private Feedback Threshold must be an integer 1–5.
- Portal links belong to a category; categories belong to a portal.
- Portal commands require the named permission, current Property access, and the relevant capability; raw role rank is not command authority.
- Portal group names must be unique within a property.
- One portal belongs to at most one portal group (enforced by unique index on `portal_group_members.portalId`).
- A portal group belongs to exactly one property.
- A Portal may have no secondary links. It cannot enter `published` unless its Property has a verified, provider-derived Google review destination.
- Every transition from Draft/Disabled to Published atomically inserts a new immutable snapshot, activates that exact version, updates Portal state, and records the existing lifecycle outbox fact. Publication fails if the locked working copy differs from the approved snapshot.
- A stable active/rotating Portal token resolves only the current open activation and its digest-verified immutable snapshot. Working-copy edits are prospective and cannot change the public response until another deliberate publication.
- Rollback never rewrites history: it closes the current activation and appends a new activation to an older valid snapshot. Database guards reject snapshot rewrites and every activation rewrite except its one-time interval closure; deletion remains reserved for the future governed Erase path. Disable/archive closes the activation, and token revocation always prevents resolution.
- Publication history reads require `portal.read`, re-use the same Property access guard as Portal detail, and query activations by the exact Organization/Property/Portal tuple. The manager surface never exposes destination URIs, publication digests, or actor identifiers.
- If that destination later becomes stale, unavailable, or temporarily unreadable, the published private rating/feedback gateway remains available in a degraded state. No stale URI is serialized and Google selection is denied with gentle guest copy.
- Public resolution fails closed when that Property destination is `awaiting_refresh` or `unavailable`; a stale URI is never rendered.
- Each successful public resolution carries the immutable snapshot ID, version, and SHA-256 publication digest plus a per-render configuration digest covering the exact content, link order/destinations, current Google availability, threshold, locale, and language-pack version. The browser projection omits this evidence; Guest persists it atomically with a new private rating. A composite database reference prevents Guest evidence from pairing a real snapshot ID with the wrong version or digest. The current public language contract is explicitly `en` / `guest-ui-en-v1` until the revisioned multilingual publication model replaces it.
- Soft-deleting a portal revokes its active/rotating portal tokens; a deleted portal never has a live token.
- The eligible creator is the initial Portal Responsible Manager. AccountAdmins are organization-wide eligible; PropertyManagers require both current property access and active participation for that property.
- Responsible-manager assignment never grants property access, portal access, or staff attribution.
- Responsible-manager updates preserve unchanged effective-dated intervals and use `responsibleManagerRevision` compare-and-swap; stale writes fail with `revision_conflict`.
- Losing the last manager sets `responsibilityNeededSince` and atomically records one identifier-only recovery fact. Adding any manager clears the state; nobody is auto-promoted.
- Core Portal creation, update/publication transition, and soft deletion use one Portal-owned command store. Authoritative Portal state, initial responsibility, live-token revocation on delete, and every required lifecycle outbox fact commit in the same PostgreSQL transaction. The in-process bus runs only after commit.
- Portal Group soft deletion uses the same command boundary: the Group archive, effective-dated membership closure, and `portal_group.deleted` outbox fact commit together under an `updatedAt` revision fence. A failed fact write or stale manager view changes none of them.
- Portal lifecycle facts are identifier-only. They carry Property/Portal scope, publication-state codes where relevant, and `sourceAggregateVersion = updatedAt.toISOString()`; they never copy Portal name, slug, description, theme, or link content. The outbox event UUID is the replay uniqueness key and optimistic `updatedAt` fencing rejects stale commands.
- Portal hero source keys are server-derived from an opaque issuance ID and the presigned PUT is first-write-only. Finalization accepts only that ID, rechecks current scope/state/expiry and exact storage MIME/size/ETag, and atomically consumes it with the durable processing fact. The worker reads with that observed ETag as an immutable-version fence. A newer consumed issuance supersedes an older worker; only the current consumed issuance may publish newly derived WebP keys. Client Portal updates may remove a hero image but may never set a non-null URL.

## Events produced

- **`portal.created`** — portalId, organizationId, propertyId, publicationState, sourceAggregateVersion, occurredAt.
- **`portal.updated`** — portalId, organizationId, propertyId, previousPublicationState, publicationState, sourceAggregateVersion, occurredAt.
- **`portal.deleted`** — portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt.
- **`portal.responsibility_became_needed`** — portalId, organizationId, propertyId, occurredAt. Identifier-only, atomically recorded with the unowned transition; Notification sends one content-free recovery alert to each current AccountAdmin.
- **`portal.hero_image.processing_requested`** — uploadId, portalId, organizationId, propertyId, sourceETag, occurredAt. Content-free durable hand-off committed atomically with issuance consumption; the consumer binds the source read to the observed ETag.
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
  > **Subscriber status:** `portal.created` and `portal.updated` are durable lifecycle/audit
  > facts with no product projection today. `portal.deleted` is durable and has the retained
  > Goal cleanup subscriber. The remaining link/category/group events
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
                       portal-command-store.port.ts, portal-publication.repository.ts,
                       portal-upload-issuance-store.port.ts,
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
                       resolve-public-portal-token.ts, rollback-portal-publication.ts,
                       get-portal-publication-history.ts,
                       complete-content-review.ts,
                       portal-responsible-managers.ts
    public-api.ts      re-exports port types, PortalPublicApi, PortalGroupPublicApi, event types/constructors
  infrastructure/
    portal-command-store.ts (atomic core lifecycle state + outbox facts)
    portal-upload-issuance-store.ts (single-use scoped issuance + stale-worker fence)
    repositories/      portal.repository.ts, portal-publication.repository.ts,
                       portal-group.repository.ts, portal-link.repository.ts,
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

- **`createPortal`** — Create a new portal for a property/entity. Validates property exists via PropertyPublicApi, then atomically commits the Portal, initial responsibility state, `portal.created`, and any responsibility-needed recovery fact.
- **`updatePortal`** — Update portal settings (name, slug, description, hero image, theme, Private Feedback Threshold, publication state). `heroImageUrl: null` clears the hero image. A transition into Published requires a verified Property-owned Google destination and atomically creates/activates an immutable publication snapshot; disable/archive closes the active route. Ordinary edits to an already-published working copy remain prospective. The patch and identifier-only `portal.updated` fact share one optimistic, version-fenced commit.
- **`rollbackPortalPublication`** — Deliberately route a currently Published Portal to an older digest-verified snapshot by appending a rollback activation; never mutates either snapshot or erases activation history.
- **`getPortalPublicationHistory`** — Return the current live version, prior publish/rollback activations, and saved-content pending state after rechecking Portal read permission and Property access. A paused/archived Portal has no live version but retains earlier activity.
- **`getPortal`** — Retrieve a single portal by ID, plus `tokenStatus` (C2): whether a public token still resolves (active, or rotating inside its grace window — same predicate as public token resolution), its version, issue time and grace end. Metadata only: the raw token and its digest are returned by issue/rotate alone.
- **`listPortals`** — List portals for an org/property with filters.
- **`softDeletePortal`** — Atomically soft-delete a Portal, revoke all live Portal tokens, and record `portal.deleted` plus `portal.token.revoked` when tokens were live. A fact conflict or stale Portal version rolls back the entire set.
- **`createLink`** / **`updateLink`** / **`deleteLink`** — Manage portal links.
- **`createLinkCategory`** / **`updateLinkCategory`** / **`deleteLinkCategory`** — Manage link categories.
- **`reorderLinks`** / **`reorderCategories`** — Reorder items by sort key.
- **`requestUploadUrl`** / **`finalizeUpload`** — Persist and consume a scoped hero upload issuance. The API returns/accepts `uploadId`, never an object key; the PUT cannot overwrite an existing source, and finalization records an ETag-bound processing request in the same transaction as consumption. The previous hero remains visible while a private source is decoded and re-encoded.
- **`listPortalLinks`** — List all links for a portal (flat, with category info).
- **`createPortalGroup`** — Create a new portal group for a property. Validates name uniqueness and portal memberships. Optionally adds initial portals (pre-validated).
- **`updatePortalGroup`** — Update group name. Validates name uniqueness (excluding self).
- **`softDeletePortalGroup`** — Soft-delete a group, emits `portal_group.deleted`. Does not cascade-remove portal memberships.
- **`listPortalGroups`** — List groups for an org/property.
- **`getPortalGroup`** — Retrieve a single group by ID.
- **`addPortalToGroup`** — Add a portal to a group. Validates portal not already in another group.
- **`removePortalFromGroup`** — Remove a portal from its group. Validates portal was in the group.
- **`issuePortalToken`** / **`rotatePortalToken`** / **`revokePortalTokens`** — Portal token lifecycle for public QR links.
- **`resolvePublicPortalToken`** — Resolve an active/rotating token to the exact current immutable publication snapshot, honouring rotation grace periods and failing closed on missing/tampered snapshot evidence. A changed destination binding degrades only the Google action; private rating/feedback remains available.
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

- **`portals.ts`** — CRUD, publication history/rollback, read, image-upload, and portal-token server functions for portals (create/update/list/get/delete portal, read/rollback publication, request/finalize upload, issue/rotate/revoke token).
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

- **process-image** — Reloads the scoped issuance, privately reads only its source, resource-bounds decode/re-encode, writes server-derived WebP variants, and atomically publishes only if the issuance is still current.
