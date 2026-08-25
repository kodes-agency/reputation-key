# Property Context

## Bounded context

Property management — creation, updates, soft-deletion, and cross-context property lookups.

## Glossary

- **Property** — The organizational unit everything else lives under. Belongs to an organization. Has name, slug, timezone, optional GBP place ID and Google connection reference.
- **PropertyPublicApi** — Application-level API for cross-context consumption. Provides slug lookups, GBP place ID lookups, import, and connection cleanup.
- **Responsible Manager** — An explicitly selected AccountAdmin or eligible PropertyManager who receives property-wide workflow notifications. This is notification-routing responsibility, not authorization or participation.

## Relationships

- Property → Organization (required `organizationId`).
- Property ← Portal, Team, StaffAssignment, Goal, Review (all reference `propertyId`).
- Property ← Integration context (via `PropertyGoogleBindingPublicApi` for canonical binding lifecycle).
- Property ← Guest context (via slug lookup for public portal resolution).
- Property context **depends on** `StaffPublicApi` for accessible property filtering and linked participation eligibility.
- Property context **depends on** `IdentityPublicApi` for membership, role, and Property access eligibility.

## Invariants

- Property slugs must be unique within an organization.
- Properties are hard-deleted (`deleteProperty`). BQC-1.7: reviews (+ replies via per-batch FK cascade) and inbox rows are first removed by a bounded, evidenced lifecycle purge (`sourceContentPurge`). The use-case file is named `soft-delete-property.ts` but the implementation performs a hard delete.
- Canonical GBP location suffixes must be unique within an organization.
- `dataCellId` is assigned from the signed Data Cell catalogue and cannot be
  cleared or changed outside the audited operator move workflow.
- Responsible Managers are explicit and may be multiple. Property creation never infers one from the creator.
- AccountAdmins are eligible organization-wide. A PropertyManager needs active membership, an active PropertyAccessGrant, and an active linked StaffParticipation for the Property.
- Losing membership, access, or participation ends only the affected manager's active interval. If none remain, the Property records `responsibilityNeededSince`; no replacement is guessed and offboarding is not blocked.
- Responsible Manager history is owned by the Property aggregate and is removed when the Property is hard-deleted.

## Events produced

- **`property.created`** — propertyId, organizationId, name, slug, dataCellId (when resolved), legacy processingRegion, occurredAt.
- **`property.updated`** — propertyId, organizationId, name, slug, occurredAt.
- **`property.deleted`** — propertyId, organizationId, occurredAt.
- **`property.responsibility_became_needed`** — propertyId, organizationId, occurredAt. Identifier-only and atomically recorded with the transition to no active responsible manager; Notification alerts current AccountAdmins with content-free copy.

## Events consumed

None. Property context does not subscribe to events from other contexts.

## Architecture layers

```
property/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             property.repository.ts, property-responsible-manager.repository.ts
    dto/               create-property.dto.ts, update-property.dto.ts
    public-api.ts      exports read-only property queries and binding lifecycle contracts
    use-cases/         create-property.ts, update-property.ts, soft-delete-property.ts,
                       get-property.ts, list-properties.ts,
                       property-responsible-managers.ts
  infrastructure/
    repositories/      property.repository.ts (Drizzle)
    mappers/           property.mapper.ts
  server/              properties.ts, property-read.ts
  build.ts             composition root
```

## Use cases

- **`createProperty`** — Create a new property, emits `property.created`.
- **`updateProperty`** — Update property settings, emits `property.updated`.
- **`getProperty`** — Retrieve a single property by ID.
- **`listProperties`** — List properties for an org, filtered by user's accessible properties (via StaffPublicApi).
- **`deleteProperty`** — Hard-delete a property (file: `soft-delete-property.ts`), emits `property.deleted`. BQC-1.7: bounded lifecycle purge of reviews/replies/inbox rows first. Requires `property.delete` permission.

## Public API

Exported from `application/public-api.ts`:

- Types: `PropertySlugLookupResult`, `PropertyLookupResult`, `PropertyPublicApi`, `PropertyFactsPublicApi`, `PropertyGoogleBindingPublicApi`
- Binding contract: `GOOGLE_BINDING_STATES`, `PROPERTY_GOOGLE_BINDING_CHANGED_EVENT`, `isGoogleBindingState`

## Server functions

- **`properties.ts` / `property-read.ts`** — CRUD server functions for properties (create, update, list, get, delete).
- **`property-responsible-managers.ts`** — list eligible/assigned managers and replace the explicit selection with revision-based compare-and-swap.

## Permissions

- `property.read` — View property details and list properties.
- `property.create` — Create new properties (also used cross-context by integration).
- `property.update` — Update property settings.
- `property.delete` — Soft-delete properties.
