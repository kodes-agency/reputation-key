# Portal Context

Portal page management — creation, configuration, theming, link management, image uploads, and portal groups.

## Glossary

- **Portal** — A public-facing page for a property, team, or staff member. Has slug, theme, smart routing settings, hero image.
- **EntityType** — The kind of entity a portal belongs to: `property`, `team`, or `staff`.
- **PortalLinkCategory** — Grouping container for links within a portal. Has title and sort key.
- **PortalLink** — An external link within a portal category. Has label, URL, icon, and sort key.
- **PortalTheme** — Visual customization: `primaryColor`, optional `backgroundColor`, `textColor`.
- **Smart Routing** — Layout emphasis strategy for low ratings. Controls feedback form positioning.
- **Portal Group** — A named collection of portals within a property. Used for goal scoping and leaderboard ranking. One portal belongs to at most one group. Metrics are always aggregated from member portals at query time (no pre-computed group metrics).
- **Ungrouped Portal** — A portal not assigned to any portal group. Still individually targetable by goals and rankable on leaderboards.
- **Soft Delete** — Portals and portal groups are soft-deleted (marked `deletedAt`), not hard-deleted, to preserve referential integrity.

## Relationships

- Portal → Property (required `propertyId`).
- Portal → Team or Staff (via `entityType` + `entityId`).
- Portal → Portal Group (optional, via `portal_group_members`). One portal belongs to at most one group.
- Portal Group → Property (required `propertyId`). One property has many groups.
- Portal has many PortalLinkCategories, each with many PortalLinks.
- Guest context **depends on** `PortalPublicApi` for resolving portal context and public portal data.
- Goal context **subscribes to** `portal.deleted` events to cancel portal-scoped goals.
- Goal context **subscribes to** `portal_group.deleted` events to cancel portal-group-scoped goals.
- Goal context **depends on** `PortalGroupPublicApi.findGroupForPortal` to resolve group membership for metric events.

## Invariants

- Portal slugs must be unique within a property.
- Smart routing threshold must be 1–5.
- Portal links belong to a category; categories belong to a portal.
- Only PM+ roles can create/update/delete portals.
- Portal group names must be unique within a property.
- One portal belongs to at most one portal group (enforced by unique index on `portal_group_members.portalId`).
- A portal group belongs to exactly one property.

## Events produced

- **`portal.created`** — portalId, organizationId, name, slug, occurredAt.
- **`portal.updated`** — portalId, organizationId, name, slug, occurredAt.
- **`portal.deleted`** — portalId, organizationId, occurredAt.
- **`portal_group.created`** — portalGroupId, organizationId, propertyId, name, occurredAt.
- **`portal_group.updated`** — portalGroupId, organizationId, propertyId, name, occurredAt.
- **`portal_group.deleted`** — portalGroupId, organizationId, propertyId, occurredAt.
- **`portal_group.portal_added`** — portalGroupId, portalId, organizationId, occurredAt.
- **`portal_group.portal_removed`** — portalGroupId, portalId, organizationId, occurredAt.
- **`portal_link_category.created`** — portalId, categoryId, organizationId, occurredAt.
- **`portal_link_category.reordered`** — portalId, organizationId, occurredAt.
- **`portal_link.created`** — portalId, linkId, categoryId, organizationId, occurredAt.
- **`portal_link.reordered`** — portalId, categoryId, organizationId, occurredAt.

## Events consumed

None. Portal context does not subscribe to events from other contexts.

## Architecture layers

```
portal/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             portal.repository.ts, portal-group.repository.ts, portal-link.repository.ts,
                       storage.port.ts, link-resolver.port.ts
    dto/               create-portal.dto.ts, update-portal.dto.ts,
                       create-portal-group.dto.ts, update-portal-group.dto.ts,
                       portal-link.dto.ts, portal-link-category.dto.ts
    use-cases/         create-portal.ts, update-portal.ts, get-portal.ts, list-portals.ts,
                       soft-delete-portal.ts, create-link.ts, update-link.ts, delete-link.ts,
                       create-link-category.ts, update-link-category.ts, delete-link-category.ts,
                       reorder-links.ts, reorder-categories.ts, request-upload-url.ts,
                       finalize-upload.ts, get-portal-qr-url.ts, list-portal-links.ts,
                       create-portal-group.ts, update-portal-group.ts, soft-delete-portal-group.ts,
                       list-portal-groups.ts, get-portal-group.ts,
                       add-portal-to-group.ts, remove-portal-from-group.ts
    public-api.ts      re-exports port types, PortalPublicApi, PortalGroupPublicApi, event types/constructors
  infrastructure/
    repositories/      portal.repository.ts, portal-group.repository.ts, portal-link.repository.ts,
                       link-resolver.repository.ts (Drizzle)
    adapters/          s3-storage.adapter.ts
    mappers/           portal.mapper.ts, portal-group.mapper.ts, portal-link.mapper.ts
    jobs/              process-image.job.ts
  server/              portals.ts, portal-groups.ts, portal-uploads.ts, portal-links.ts,
                       portal-link-categories.ts, portal-read.ts
  build.ts             composition root
```

## Use cases

- **`createPortal`** — Create a new portal for a property/entity. Validates property exists via PropertyPublicApi.
- **`updatePortal`** — Update portal settings (name, theme, smart routing, etc.).
- **`getPortal`** — Retrieve a single portal by ID.
- **`listPortals`** — List portals for an org/property with filters.
- **`softDeletePortal`** — Soft-delete a portal, emits `portal.deleted`.
- **`createLink`** / **`updateLink`** / **`deleteLink`** — Manage portal links.
- **`createLinkCategory`** / **`updateLinkCategory`** / **`deleteLinkCategory`** — Manage link categories.
- **`reorderLinks`** / **`reorderCategories`** — Reorder items by sort key.
- **`requestUploadUrl`** / **`finalizeUpload`** — S3 presigned URL flow for hero images.
- **`getPortalQrUrl`** — Generate QR code URL for a portal.
- **`listPortalLinks`** — List all links for a portal (flat, with category info).
- **`createPortalGroup`** — Create a new portal group for a property. Validates name uniqueness and portal memberships. Optionally adds initial portals (pre-validated).
- **`updatePortalGroup`** — Update group name. Validates name uniqueness (excluding self).
- **`softDeletePortalGroup`** — Soft-delete a group, emits `portal_group.deleted`. Does not cascade-remove portal memberships. Note: a duplicate `deletePortalGroup` function exists in `delete-portal-group.ts` (same behavior); `softDeletePortalGroup` is the canonical version.
- **`listPortalGroups`** — List groups for an org/property.
- **`getPortalGroup`** — Retrieve a single group by ID.
- **`addPortalToGroup`** — Add a portal to a group. Validates portal not already in another group.
- **`removePortalFromGroup`** — Remove a portal from its group. Validates portal was in the group.

## Public API

Exported from `application/public-api.ts`:

- Types: `StoragePort`, `LinkResolverPort`, `PortalContextResult`, `PublicPortalBySlugResult`, `PortalPublicApi`
- Types: `PortalGroupPublicApi` (exposes `findGroupForPortal`)
- Event types: `PortalDeleted`, `PortalEvent`, `PortalGroupDeleted`
- Event constructors: `portalDeleted`, `portalGroupDeleted`

## Server functions

- **`portals.ts`** — CRUD server functions for portals.
- **`portal-links.ts`** — CRUD server functions for portal links and link categories.
- **`portal-groups.ts`** — CRUD server functions for portal groups and portal membership management.
- **`portal-uploads.ts`** — Server functions for portal image upload operations.
- **`portal-link-categories.ts`** — Server functions for portal link category CRUD operations.
- **`portal-read.ts`** — Read-only server functions for portal data retrieval.

## Permissions

- `portal.read` — View portals, portal links, and portal groups.
- `portal.update` — Update portal settings, links, link categories, and portal groups (including membership).
- `portal.create` — Create new portals and portal groups.
- `portal.delete` — Soft-delete portals and portal groups.

## Background jobs

- **process-image** — Resizes and converts uploaded portal hero images to multiple variants.

## Errors

Closed union of 20 error codes (`PortalErrorCode`):

`forbidden`, `invalid_slug`, `invalid_name`, `invalid_description`, `invalid_theme`, `invalid_threshold`, `invalid_url`, `invalid_label`, `invalid_title`, `slug_taken`, `portal_not_found`, `category_not_found`, `link_not_found`, `property_not_found`, `group_not_found`, `group_name_taken`, `portal_already_grouped`, `portal_not_in_group`, `portal_inactive`, `upload_failed`
