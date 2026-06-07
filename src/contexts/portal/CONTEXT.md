# Portal Context

## Bounded context

Portal page management — creation, configuration, theming, link management, image uploads, and portal group aggregation.

## Glossary

- **Portal** — A public-facing page for a property. Has slug, theme, smart routing settings, hero image. Optionally belongs to a PortalGroup.
- **PortalGroup** — Aggregates multiple portals into a named department/unit for metrics and goals (e.g., "Reception", "Housekeeping"). Scoped to a property.
- **PortalLinkCategory** — Grouping container for links within a portal. Has title and sort key.
- **PortalLink** — An external link within a portal category. Has label, URL, icon, and sort key.
- **PortalTheme** — Visual customization: `primaryColor`, optional `backgroundColor`, `textColor`.
- **Smart Routing** — Layout emphasis strategy for low ratings. Controls feedback form positioning.
- **Soft Delete** — Portals and portal groups are soft-deleted (marked `deletedAt`), not hard-deleted, to preserve referential integrity.

## Relationships

- Portal → Property (required `propertyId`).
- Portal → PortalGroup (optional `groupId`, scopes portal to a department).
- PortalGroup → Property (required `propertyId`).
- Portal has many PortalLinkCategories, each with many PortalLinks.
- Guest context **depends on** `PortalPublicApi` for resolving portal context and public portal data.
- Goal context **subscribes to** `portal.deleted` events to cancel portal-scoped goals.
- Goal context **subscribes to** `portal.portal_group.deleted` events to cancel group-scoped goals.

## Invariants

- Portal slugs must be unique within a property.
- Smart routing threshold must be 1–5.
- Portal links belong to a category; categories belong to a portal.
- PortalGroup names must be unique per property+organization.
- Only PM+ roles can create/update/delete portals and portal groups.

## Events produced

- **`portal.created`** — portalId, organizationId, name, slug, occurredAt.
- **`portal.updated`** — portalId, organizationId, name, slug, occurredAt.
- **`portal.deleted`** — portalId, organizationId, occurredAt.
- **`portal.portal_group.created`** — groupId, organizationId, propertyId, name, occurredAt.
- **`portal.portal_group.updated`** — groupId, organizationId, propertyId, name, occurredAt.
- **`portal.portal_group.deleted`** — groupId, organizationId, propertyId, occurredAt.
- **`portal.portal_link_category.created`** — portalId, categoryId, organizationId, occurredAt.
- **`portal.portal_link_category.reordered`** — portalId, organizationId, occurredAt.
- **`portal.portal_link.created`** — portalId, linkId, categoryId, organizationId, occurredAt.
- **`portal.portal_link.reordered`** — portalId, categoryId, organizationId, occurredAt.

## Events consumed

None. Portal context does not subscribe to events from other contexts.

## Architecture layers

```
portal/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
                       (PortalGroup types, constructors, and events are in the shared files above)
  application/
    ports/             portal.repository.ts, portal-group.repository.ts, portal-link.repository.ts,
                       storage.port.ts, link-resolver.port.ts
    dto/               create-portal.dto.ts, update-portal.dto.ts,
                       portal-link.dto.ts, portal-link-category.dto.ts, portal-group.dto.ts
    use-cases/         create-portal.ts, update-portal.ts, get-portal.ts, list-portals.ts,
                       soft-delete-portal.ts, create-link.ts, update-link.ts, delete-link.ts,
                       create-link-category.ts, update-link-category.ts, delete-link-category.ts,
                       reorder-links.ts, reorder-categories.ts, request-upload-url.ts,
                       finalize-upload.ts, get-portal-qr-url.ts, list-portal-links.ts,
                       create-portal-group.ts, update-portal-group.ts, delete-portal-group.ts,
                       list-portal-groups.ts
    public-api.ts      re-exports port types, PortalPublicApi, event types/constructors
  infrastructure/
    repositories/      portal.repository.ts, portal-group.repository.ts, portal-link.repository.ts,
                       link-resolver.repository.ts (Drizzle)
    adapters/          s3-storage.adapter.ts
    mappers/           portal.mapper.ts, portal-link.mapper.ts, portal-group.mapper.ts
    jobs/              process-image.job.ts
  server/              portals.ts, portal-links.ts, portal-groups.ts
  build.ts             composition root
```

## Use cases

- **`createPortal`** — Create a new portal for a property. Validates property exists via PropertyPublicApi.
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
- **`createPortalGroup`** / **`updatePortalGroup`** / **`deletePortalGroup`** — Manage portal groups.
- **`listPortalGroups`** — List portal groups for a property.

## Public API

Exported from `application/public-api.ts`:

- Types: `StoragePort`, `LinkResolverPort`, `PortalContextResult`, `PublicPortalBySlugResult`, `PortalPublicApi`
- Event types: `PortalDeleted`, `PortalGroupDeleted`, `PortalEvent`
- Event constructors: `portalDeleted`, `portalGroupDeleted`

## Server functions

- **`portals.ts`** — CRUD server functions for portals.
- **`portal-links.ts`** — CRUD server functions for portal links and link categories.
- **`portal-groups.ts`** — CRUD server functions for portal groups.

## Permissions

- `portal.read` — View portals and portal links.
- `portal.update` — Update portal settings, links, and link categories.
- `portal.create` — Create new portals.
- `portal.delete` — Soft-delete portals.

## Background jobs

- **process-image** — Resizes and converts uploaded portal hero images to multiple variants.
