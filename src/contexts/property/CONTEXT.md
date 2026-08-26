# Property Context

## Bounded context

Property management — creation, updates, lifecycle containment, and cross-context property lookups.

## Glossary

- **Property** — The organizational unit everything else lives under. Belongs to an organization. Has name, slug, timezone, optional GBP binding, and the Property-owned Google review destination snapshot used by its Portals.
- **Google review destination** — A validated snapshot of Google's output-only review URI, pinned to the Property binding source epoch and profile version. Only `verified` destinations may be rendered; `awaiting_refresh` and `unavailable` fail closed.
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
- Destructive Property deletion is unreachable from the normal product in beta. The legacy `deleteProperty` server boundary and use case both fail closed before lookup, purge, provider fencing, or durable writes; `property.delete` maps to the permanently blocked `property.erase` capability. Recoverable Archive/Disconnect and support-mediated permanent erasure remain separate LIF-01 work.
- Canonical GBP location suffixes must be unique within an organization.
- A Google review destination is accepted only from the provider discovery/import path, is restricted to approved HTTPS Google hosts, and is pinned to the Property binding generation that produced it.
- Disconnect preserves the last destination only as `awaiting_refresh`; credential scrub clears it. Neither state is a public rendering authority.
- `dataCellId` is assigned from the signed Data Cell catalogue and cannot be
  cleared or changed outside the audited operator move workflow.
- Responsible Managers are explicit and may be multiple. Property creation never infers one from the creator.
- AccountAdmins are eligible organization-wide. A PropertyManager needs active membership, an active PropertyAccessGrant, and an active linked StaffParticipation for the Property.
- Losing membership, access, or participation ends only the affected manager's active interval. If none remain, the Property records `responsibilityNeededSince`; no replacement is guessed and offboarding is not blocked.
- Responsible Manager history is owned by the Property aggregate. Its behavior at permanent erasure remains part of the future support-mediated LIF-01 workflow; normal product actions cannot erase it.

## Events produced

- **`property.created`** — propertyId, organizationId, name, slug, dataCellId (when resolved), legacy processingRegion, occurredAt.
- **`property.updated`** — propertyId, organizationId, name, slug, occurredAt.
- **`property.deleted`** — legacy/future-erasure fact retained in the low-level command contract; normal product actions cannot produce it during LIF-01 containment.
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
- **`deleteProperty`** — Contained legacy entry point (file: `soft-delete-property.ts`). Always refuses before effects. It does not implement Archive/Disconnect or support-mediated erasure.

## Public API

Exported from `application/public-api.ts`:

- Types: `PropertySlugLookupResult`, `PropertyLookupResult`, `PropertyPublicApi`, `PropertyFactsPublicApi`, `PropertyGoogleBindingPublicApi`, `PropertyGoogleReviewDestinationPublicApi`
- Binding contract: `GOOGLE_BINDING_STATES`, `PROPERTY_GOOGLE_BINDING_CHANGED_EVENT`, `isGoogleBindingState`

## Server functions

- **`properties.ts` / `property-read.ts`** — Create, update, list, and get server functions plus a typed, fail-closed stale-client boundary for legacy deletion requests.
- **`property-responsible-managers.ts`** — list eligible/assigned managers and replace the explicit selection with revision-based compare-and-swap.

## Permissions

- `property.read` — View property details and list properties.
- `property.create` — Create new properties (also used cross-context by integration).
- `property.update` — Update property settings.
- `property.delete` — Legacy destructive request permission. Maps to blocked `property.erase`; there is no normal product deletion capability.
