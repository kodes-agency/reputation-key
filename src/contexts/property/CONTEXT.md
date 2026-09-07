# Property Context

## Bounded context

Property management — creation, updates, lifecycle containment, and cross-context property lookups.

## Glossary

- **Property** — The organizational unit everything else lives under. Belongs to an organization. Has name, slug, timezone, optional GBP binding, and the Property-owned Google review destination snapshot used by its Portals.
- **Google review destination** — A validated snapshot of Google's output-only review URI, pinned to the Property binding source epoch and profile version. Only `verified` destinations may be rendered; `awaiting_refresh` and `unavailable` fail closed.
- **PropertyPublicApi** — Application-level API for cross-context consumption. Provides slug lookups, GBP place ID lookups, import, and connection cleanup.
- **Responsible Manager** — An explicitly selected AccountAdmin or eligible PropertyManager who receives property-wide workflow notifications. This is notification-routing responsibility, not authorization or participation.
- **Archive recovery window** — The 30-day interval beginning when an AccountAdmin archives a Property. Archive preserves the stable Property identity and all retained managerial history while blocking public and provider work. Self-service Restore is unavailable at or after the deadline; expiry does not itself delete data.

## Relationships

- Property → Organization (required `organizationId`).
- Property ← Portal, StaffParticipation, PortalResponsibility, PropertyAccessGrant, Goal, and Review (all reference `propertyId`).
- Property ← Integration context (via `PropertyGoogleBindingPublicApi` for canonical binding lifecycle).
- Property ← Guest context (via slug lookup for public portal resolution).
- Property context **depends on** `StaffPublicApi` for accessible property filtering and linked participation eligibility.
- Property context **depends on** `IdentityPublicApi` for membership, role, and Property access eligibility.

## Invariants

- Property slugs must be unique within an organization.
- Destructive Property deletion is unreachable from the normal product in beta. The legacy `deleteProperty` server boundary and use case both fail closed before lookup, purge, provider fencing, or durable writes; `property.delete` maps to the permanently blocked `property.erase` capability.
- Archive mutates the existing Property row in place, records the initiating AccountAdmin/reason/deadline, increments `sourceEpoch`, invalidates the Google review destination to `awaiting_refresh` when one exists, and co-commits the content-free `property.archived` fact. It never deletes the Property or a dependent row.
- Only an archived Property inside its original recovery window may be restored through the normal product. Restore revalidates at least one current eligible Responsible Manager, increments `sourceEpoch`, co-commits `property.restored`, and reports whether Google reconnection is required. It does not silently reconnect or resume provider work that current binding authorization still denies.
- Property Google disconnect is a separate, idempotent action available only after Archive. It changes only the Property-owned binding generation and destination readiness; the Organization Google connection, stable Property identity, provider suffix history, and retained managerial data remain intact. Provider identity scrubbing and permanent erasure are not part of this action.
- An expired recovery window leaves the Property archived for support handling. There is no automatic purge, hard-delete path, or irreversible erasure in this slice; support-mediated permanent erasure remains separate LIF-01 work.
- Canonical GBP location suffixes must be unique within an organization.
- A Google review destination is accepted only from the provider discovery/import path, is restricted to approved HTTPS Google hosts, and is pinned to the Property binding generation that produced it.
- Disconnect preserves the last destination only as `awaiting_refresh`; credential scrub clears it. Neither state is a public rendering authority.
- Country and timezone are business facts. One deployment serves every supported
  country (`docs/BETA.md` §1), and editing either moves no data.
- Responsible Managers are explicit and may be multiple. Property creation never infers one from the creator.
- AccountAdmins are eligible organization-wide. A PropertyManager needs active membership, an active PropertyAccessGrant, and an active linked StaffParticipation for the Property.
- Losing membership, access, or participation ends only the affected manager's active interval. If none remain, the Property records `responsibilityNeededSince`; no replacement is guessed and offboarding is not blocked.
- Responsible Manager history is owned by the Property aggregate. Its behavior at permanent erasure remains part of the future support-mediated LIF-01 workflow; normal product actions cannot erase it.

## Events produced

| Tag                                     | Payload                                                                                                       | When recorded                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `property.created`                      | eventId, propertyId, organizationId, name, slug, occurredAt                                                   | A Property is created with its country and timezone business facts                                             |
| `property.updated`                      | eventId, propertyId, organizationId, name, slug, occurredAt                                                   | Mutable Property metadata changes                                                                              |
| `property.deleted`                      | eventId, propertyId, organizationId, occurredAt                                                               | Legacy/future Erase compatibility only; normal product actions cannot record it during LIF-01 containment      |
| `property.archived`                     | eventId, organizationId, propertyId, userId, previousState, sourceEpoch, recoveryDeadline, occurredAt         | Archive commits in place and opens the bounded recovery window; reason/content remain Property-local           |
| `property.restored`                     | eventId, organizationId, propertyId, userId, previousState, sourceEpoch, Google binding readiness, occurredAt | Explicit restore passes current responsibility checks                                                          |
| `property.google_binding.changed`       | eventId, organizationId, propertyId, connectionId, sourceEpoch, change, occurredAt                            | The Property-owned Google binding is created, relinked, disconnected, or enters deletion                       |
| `property.responsibility_became_needed` | eventId, propertyId, organizationId, occurredAt                                                               | The Property loses its last active responsible manager; Notification alerts current AccountAdmins content-free |

## Events consumed

None. Property context does not subscribe to events from other contexts.

## Architecture layers

```
property/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             property.repository.ts, property-responsible-manager.repository.ts,
                       property-lifecycle-command-store.port.ts,
                       property-lifecycle-readiness.port.ts
    dto/               create-property.dto.ts, update-property.dto.ts,
                       property-lifecycle.dto.ts
    public-api.ts      exports read-only property queries and binding lifecycle contracts
    use-cases/         create-property.ts, update-property.ts, soft-delete-property.ts,
                       get-property.ts, list-properties.ts,
                       property-lifecycle.ts,
                       property-responsible-managers.ts
  infrastructure/
    property-lifecycle-command-store.ts (atomic state + durable fact)
    repositories/      property.repository.ts (Drizzle)
    adapters/          property-organization-export.adapter.ts
    mappers/           property.mapper.ts
  server/              properties.ts, property-read.ts, property-lifecycle.ts
  build.ts             composition root
```

## Use cases

- **`createProperty`** — Create a new property and atomically record `property.created`.
- **`updateProperty`** — Update property settings and atomically record `property.updated`.
- **`getProperty`** — Retrieve a single property by ID.
- **`listProperties`** — List properties for an org, filtered by user's accessible properties (via StaffPublicApi).
- **`deleteProperty`** — Contained legacy entry point (file: `soft-delete-property.ts`). Always refuses before effects. It does not implement Archive/Disconnect or support-mediated erasure.
- **`archiveProperty`** — AccountAdmin-only recoverable lifecycle transition. Preserves identity/history, opens one fixed 30-day recovery window, fences stale work through `sourceEpoch`, and atomically records `property.archived`.
- **`restoreProperty`** — AccountAdmin-only explicit recovery for an archived Property before its deadline. Requires an eligible Responsible Manager and returns `ready` or `reconnect_required` for the Google binding.
- **`disconnectPropertyGoogleBinding`** — AccountAdmin-only, archived-Property binding disconnect. It does not revoke or delete the Organization Google connection.

## Public API

Exported from `application/public-api.ts`:

- Types: `PropertyPublicApi`, `PropertyFactsPublicApi`, `PropertySourceEpochPublicApi`, `PropertyGoogleBindingPublicApi`, `PropertyGoogleReviewDestinationPublicApi`, `PropertyLifecyclePublicApi`, `GoogleBindingState`
- Lifecycle contract: `isPropertyActive`, used by cross-context request-time and external-effect gates to fail closed even before asynchronous projections settle.

## Server functions

- **`properties.ts` / `property-read.ts`** — Create, update, list, and get server functions plus a typed, fail-closed stale-client boundary for legacy deletion requests.
- **`property-lifecycle.ts`** — Validated Archive, Restore, and archived-Property Google disconnect boundaries. Each resolves current tenant authority and uses a distinct permission before the application command.
- **`property-responsible-managers.ts`** — list eligible/assigned managers and replace the explicit selection with revision-based compare-and-swap.

## Permissions

- `property.read` — View property details and list properties.
- `property.create` — Create new properties (also used cross-context by integration).
- `property.update` — Update property settings.
- `property.delete` — Legacy destructive request permission. Maps to blocked `property.erase`; there is no normal product deletion capability.
- `property.archive` — AccountAdmin-only recoverable Archive; maps to core Property management, never `property.erase`.
- `property.restore` — AccountAdmin-only explicit recovery during the original deadline.
- `property.disconnect` — AccountAdmin-only Property binding disconnect after Archive; does not disconnect the Organization account.

## Organization Export contribution (LIF-01)

`infrastructure/adapters/property-organization-export.adapter.ts` implements
`identity/application/ports/organization-export-contributor.port.ts` and is
returned from `build.ts` as `organizationExportContributor` — deliberately
outside `publicApi`, because an export slice is lifecycle composition input,
not a Property product capability.

It emits `property/properties.csv` and `property/properties.json` at
classification `tenant_visible`, deterministic for a fixed
`(organizationId, asOf)` and ordered by UTF-8 byte order. Covered tables:
`properties` (including archived and soft-deleted rows) and
`property_responsible_managers`. An Organization with no Property rows answers
`no_data`.

Not exported: the `property_operation` scope in `idempotency_receipts`
(content-free control plane), the Google
account/location/review-destination identifiers (provider-controlled
identifiers — only the content-free binding and destination _state_ ships),
and Property policy/capability/access-grant rows, which Identity already
exports. Each reason is recorded in the payload's `excludedRecordClasses`.

## Organization lifecycle contribution (LIF-01)

`infrastructure/adapters/property-organization-lifecycle.adapter.ts` implements
`identity/application/ports/organization-lifecycle-contributor.port.ts` on top
of the shared receipt store
(`shared/db/lifecycle/organization-lifecycle-receipt-store.ts`), and is
returned from `build.ts` as `organizationLifecycleContributor` — deliberately
outside `publicApi`. It owns an irreversible purge phase, so keeping it off the
request-facing surface is what keeps that phase unreachable by default.

| Phase                  | What Property does                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepareClosing`       | Moves every `active` Property to `suspended` with `lifecycle_reason = organization_closure:<closureLineageId>`. `isPropertyActive` is the request-time gate for provider work and for the public Portal gateway, so this stops new work everywhere at once. Nothing is deleted. |
| `verifyPurgeReadiness` | Read-only. Fails closed while any Property is still `active` or `disconnecting` — both admit provider work that would outlive the irreversible boundary.                                                                                                                        |
| `purge`                | Idempotent row deletes over `PROPERTY_PURGE_PLAN`: the `property_operation` scope in `idempotency_receipts`, `property_responsible_managers`, `properties`.                                                                                                                     |

Closing **retains authorized history**: the Google binding, review destination,
profile confirmation, responsible-manager intervals and operation receipts are
untouched. Suspension is reversible and precisely identifiable — a Property the
tenant archived on its own keeps its own state and reason, and explicit
reactivation restores exactly the rows carrying this closure lineage.

Portal and Guest rows RESTRICT the `properties` delete until those contexts
have supplied their own purge receipts. That failure is deliberate: the phase
throws, the lifecycle state stays at `purging`, other contexts keep their
receipts, and the next pass converges. It is never converted into a cascade
that erases another owner's rows without that owner's receipt.
