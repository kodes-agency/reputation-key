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
- Property ← Portal, Team, StaffAssignment, Goal, Review (all reference `propertyId`).
- Property ← Integration context (via `PropertyGoogleBindingPublicApi` for canonical binding lifecycle).
- Property ← Guest context (via slug lookup for public portal resolution).
- Property context **depends on** `StaffPublicApi` for accessible property filtering and linked participation eligibility.
- Property context **depends on** `IdentityPublicApi` for membership, role, and Property access eligibility.

## Invariants

- Property slugs must be unique within an organization.
- Destructive Property deletion is unreachable from the normal product in beta. The legacy `deleteProperty` server boundary and use case both fail closed before lookup, purge, provider fencing, or durable writes; `property.delete` maps to the permanently blocked `property.erase` capability.
- Archive mutates the existing Property row in place, records the initiating AccountAdmin/reason/deadline, increments `sourceEpoch`, invalidates the Google review destination to `awaiting_refresh` when one exists, and co-commits the content-free `property.archived` fact. It never deletes the Property or a dependent row.
- Only an archived Property inside its original recovery window may be restored through the normal product. Restore revalidates an accepting Data Cell and at least one current eligible Responsible Manager, increments `sourceEpoch`, co-commits `property.restored`, and reports whether Google reconnection is required. It does not silently reconnect or resume provider work that current binding authorization still denies.
- Property Google disconnect is a separate, idempotent action available only after Archive. It changes only the Property-owned binding generation and destination readiness; the Organization Google connection, stable Property identity, provider suffix history, and retained managerial data remain intact. Provider identity scrubbing and permanent erasure are not part of this action.
- An expired recovery window leaves the Property archived for support handling. There is no automatic purge, hard-delete path, self-service region move, or irreversible erasure in this slice; support-mediated permanent erasure remains separate LIF-01 work.
- Canonical GBP location suffixes must be unique within an organization.
- A Google review destination is accepted only from the provider discovery/import path, is restricted to approved HTTPS Google hosts, and is pinned to the Property binding generation that produced it.
- Disconnect preserves the last destination only as `awaiting_refresh`; credential scrub clears it. Neither state is a public rendering authority.
- `dataCellId` is assigned from the signed Data Cell catalogue and cannot be
  cleared or changed outside the audited operator move workflow.
- A denied region-move request changes no Property state and records only its
  content-free operator decision. An accepted request co-commits the
  `region_moves` machine row and matching allow decision; mismatched tenant,
  Property, or actor evidence is refused before either write.
- PostgreSQL permits at most one non-terminal region move per Property. Every
  accepted move begins at state revision 1; every later transition validates
  the domain edge and compares the expected state and revision before
  incrementing the revision. Concurrent or stale steppers cannot reopen a
  terminal move or overwrite a newer transition. Target activation and source
  restoration co-commit the Property authority swap with that CAS; a losing
  stepper cannot change the authoritative Data Cell.
- Responsible Managers are explicit and may be multiple. Property creation never infers one from the creator.
- AccountAdmins are eligible organization-wide. A PropertyManager needs active membership, an active PropertyAccessGrant, and an active linked StaffParticipation for the Property.
- Losing membership, access, or participation ends only the affected manager's active interval. If none remain, the Property records `responsibilityNeededSince`; no replacement is guessed and offboarding is not blocked.
- Responsible Manager history is owned by the Property aggregate. Its behavior at permanent erasure remains part of the future support-mediated LIF-01 workflow; normal product actions cannot erase it.

## Events produced

| Tag                                     | Payload                                                                                                       | When emitted                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `property.created`                      | eventId, propertyId, organizationId, name, slug, dataCellId/legacy processingRegion, occurredAt               | A Property is created with its resolved routing facts                                                          |
| `property.updated`                      | eventId, propertyId, organizationId, name, slug, occurredAt                                                   | Mutable Property metadata changes                                                                              |
| `property.deleted`                      | eventId, propertyId, organizationId, occurredAt                                                               | Legacy/future Erase compatibility only; normal product actions cannot emit it during LIF-01 containment        |
| `property.archived`                     | eventId, organizationId, propertyId, userId, previousState, sourceEpoch, recoveryDeadline, occurredAt         | Archive commits in place and opens the bounded recovery window; reason/content remain Property-local           |
| `property.restored`                     | eventId, organizationId, propertyId, userId, previousState, sourceEpoch, Google binding readiness, occurredAt | Explicit restore passes current responsibility and Data Cell checks                                            |
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
                       property-lifecycle-readiness.port.ts,
                       region-move-store.port.ts,
                       region-move-request-command-store.port.ts
    dto/               create-property.dto.ts, update-property.dto.ts,
                       property-lifecycle.dto.ts
    public-api.ts      exports read-only property queries and binding lifecycle contracts
    use-cases/         create-property.ts, update-property.ts, soft-delete-property.ts,
                       get-property.ts, list-properties.ts,
                       property-lifecycle.ts,
                       property-responsible-managers.ts, request-region-move.ts,
                       advance-region-move.ts
  infrastructure/
    property-lifecycle-command-store.ts (atomic state + durable fact)
    repositories/      property.repository.ts, region-move.repository.ts (Drizzle)
    adapters/          region-move-request-command-store.adapter.ts (atomic move + audit)
    mappers/           property.mapper.ts
  server/              properties.ts, property-read.ts, property-lifecycle.ts
  build.ts             composition root
```

## Use cases

- **`createProperty`** — Create a new property, emits `property.created`.
- **`updateProperty`** — Update property settings, emits `property.updated`.
- **`getProperty`** — Retrieve a single property by ID.
- **`listProperties`** — List properties for an org, filtered by user's accessible properties (via StaffPublicApi).
- **`deleteProperty`** — Contained legacy entry point (file: `soft-delete-property.ts`). Always refuses before effects. It does not implement Archive/Disconnect or support-mediated erasure.
- **`archiveProperty`** — AccountAdmin-only recoverable lifecycle transition. Preserves identity/history, opens one fixed 30-day recovery window, fences stale work through `sourceEpoch`, and atomically records `property.archived`.
- **`restoreProperty`** — AccountAdmin-only explicit recovery for an archived Property before its deadline. Requires an accepting assigned Data Cell and an eligible Responsible Manager and returns `ready` or `reconnect_required` for the Google binding.
- **`disconnectPropertyGoogleBinding`** — AccountAdmin-only, archived-Property binding disconnect. It does not revoke or delete the Organization Google connection.
- **`requestRegionMove`** — Operator-only typed request. Known but non-accepting
  cells deny without a machine row; an accepting target starts the durable
  move machine through the atomic request command store.
- **`advanceRegionMove`** — Advances the explicit pause, drain, copy, verify,
  activation, source-erasure, completion, failure, and rollback states.

## Public API

Exported from `application/public-api.ts`:

- Types: `PropertySlugLookupResult`, `PropertyLookupResult`, `PropertyPublicApi`, `PropertyFactsPublicApi`, `PropertyGoogleBindingPublicApi`, `PropertyGoogleReviewDestinationPublicApi`, `PropertyLifecyclePublicApi`
- Lifecycle contract: `isPropertyActive`, used by cross-context request-time and external-effect gates to fail closed even before asynchronous projections settle.
- Binding contract: `GOOGLE_BINDING_STATES`, `PROPERTY_GOOGLE_BINDING_CHANGED_EVENT`, `isGoogleBindingState`

## Server functions

- **`properties.ts` / `property-read.ts`** — Create, update, list, and get server functions plus a typed, fail-closed stale-client boundary for legacy deletion requests.
- **`property-lifecycle.ts`** — Validated Archive, Restore, and archived-Property Google disconnect boundaries. Each resolves current tenant authority and uses a distinct permission before the application command.
- **`property-responsible-managers.ts`** — list eligible/assigned managers and replace the explicit selection with revision-based compare-and-swap.
- **`region-move.ts`** — policy-admin-gated request boundary; activation still
  depends on the signed catalogue and completed Data Cell readiness evidence.

## Permissions

- `property.read` — View property details and list properties.
- `property.create` — Create new properties (also used cross-context by integration).
- `property.update` — Update property settings.
- `property.delete` — Legacy destructive request permission. Maps to blocked `property.erase`; there is no normal product deletion capability.
- `property.archive` — AccountAdmin-only recoverable Archive; maps to core Property management, never `property.erase`.
- `property.restore` — AccountAdmin-only explicit recovery during the original deadline.
- `property.disconnect` — AccountAdmin-only Property binding disconnect after Archive; does not disconnect the Organization account.
