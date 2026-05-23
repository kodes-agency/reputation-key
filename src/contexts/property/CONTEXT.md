# Property Context

Property management — creation, updates, soft-deletion, and cross-context property lookups.

## Glossary

- **Property** — The organizational unit everything else lives under. Belongs to an organization. Has name, slug, timezone, optional GBP place ID and Google connection reference.
- **PropertyPublicApi** — Application-level API for cross-context consumption. Provides slug lookups, GBP place ID lookups, import, and connection cleanup.

## Relationships

- Property → Organization (required `organizationId`).
- Property ← Portal, Team, StaffAssignment, Goal, Review (all reference `propertyId`).
- Property ← Integration context (via `PropertyPublicApi` for GBP imports and webhook resolution).
- Property ← Guest context (via slug lookup for public portal resolution).
- Property context **depends on** `StaffPublicApi` for accessible property filtering.

## Invariants

- Property slugs must be unique within an organization.
- Properties are soft-deleted (`deletedAt`), never hard-deleted.
- GBP place IDs must be unique within an organization (enforced by `PropertyImportConflict`).

## Events produced

- **`property.created`** — propertyId, organizationId, name, slug, gbpPlaceId?, gbpLocationName?, googleConnectionId?, occurredAt.
- **`property.updated`** — propertyId, organizationId, name, slug, occurredAt.
- **`property.deleted`** — propertyId, organizationId, occurredAt.

## Events consumed

None. Property context does not subscribe to events from other contexts.

## Architecture layers

```
property/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             property.repository.ts
    dto/               create-property.dto.ts, update-property.dto.ts
    public-api.ts      re-exports PropertyPublicApi, import types, event types/constructors
  infrastructure/
    repositories/      property.repository.ts (Drizzle)
    mappers/           property.mapper.ts
  server/              properties.ts
  build.ts             composition root
```

## Use cases

- **`createProperty`** — Create a new property, emits `property.created`.
- **`updateProperty`** — Update property settings, emits `property.updated`.
- **`getProperty`** — Retrieve a single property by ID.
- **`listProperties`** — List properties for an org, filtered by user's accessible properties (via StaffPublicApi).
- **`softDeleteProperty`** — Soft-delete a property, emits `property.deleted`.

## Public API

Exported from `application/public-api.ts`:

- Types: `PropertySlugLookupResult`, `PropertyLookupResult`, `PropertyImportResult`, `PropertyImportConflict`, `PropertyPublicApi`
- Functions: `propertyImportConflict`, `isPropertyImportConflict`
- Event types: `PropertyCreated`
- Event constructors: `propertyCreated`

## Server functions

- **`properties.ts`** — CRUD server functions for properties (create, update, list, get, delete).

## Permissions

- `property.read` — View property details and list properties.
- `property.create` — Create new properties (also used cross-context by integration).
- `property.update` — Update property settings.
- `property.delete` — Soft-delete properties.

## Dependencies

- **Staff context** — Property listing uses `StaffPublicApi.getAccessiblePropertyIds` to filter properties by user role.
