# Property — Context

**Audience:** Developers and agents working in `src/contexts/property/`.

## Responsibility

Property management: creation, metadata updates, recoverable lifecycle
containment, Google-binding state, responsible managers, and narrow cross-context
Property lookups.

## Boundaries

- A Property belongs to one Organization. Portal, Staff Participation, Property
  access, Goal, Review, and Guest records retain their own context ownership.
- Integration changes Google binding state only through
  `PropertyGoogleBindingPublicApi`.
- Identity and Staff supply membership, role, Property access, and linked
  participation eligibility. Responsible Manager assignment is notification
  routing, not authorization or participation.
- `application/public-api.ts` exposes read, source-epoch, Google-binding,
  destination, and lifecycle facts; repositories and command stores remain
  internal.
- Export and irreversible lifecycle contributors remain outside `publicApi`.

## Model

A Property is the Organization unit under which product work is scoped. It owns
name, slug, timezone, lifecycle state, optional Google binding, a validated Google
review destination snapshot, and effective-dated Responsible Manager history.

Archive is a recoverable in-place transition with a fixed 30-day window. It
preserves stable identity and history while fencing public and provider work.
Restore is explicit; Google disconnect is a separate archived-Property action.

## Runtime

`build.ts` is the composition root. Server adapters resolve current tenant and
permission before calling Property use cases. A Property-owned lifecycle command
store commits state, `sourceEpoch`, revision, responsibility, destination state,
and identifier-only facts atomically. `isPropertyActive` is the request-time gate
used before provider and public Portal effects.

Organization closing suspends active Properties without deleting them. Purge runs
only after every owning context has supplied readiness receipts; restrictive
foreign keys deliberately stop cross-owner deletion.

## Invariants

1. Property slugs and canonical GBP location suffixes are unique within an
   Organization.
2. Only `verified` Google review destinations may be rendered; `awaiting_refresh`
   and `unavailable` fail closed.
3. Destructive Property deletion is unreachable from the normal product in beta. The legacy `deleteProperty` server boundary and use case both fail closed before lookup, purge, provider fencing, or durable writes; `property.delete` maps to the permanently blocked `property.erase` capability.
4. Archive mutates the existing Property row in place, records the initiating AccountAdmin/reason/deadline, increments `sourceEpoch`, invalidates the Google review destination to `awaiting_refresh` when one exists, and co-commits the content-free `property.archived` fact. It never deletes the Property or a dependent row.
5. Only an archived Property inside its original recovery window may be restored through the normal product. Restore revalidates at least one current eligible Responsible Manager, increments `sourceEpoch`, co-commits `property.restored`, and reports whether Google reconnection is required. It does not silently reconnect or resume provider work that current binding authorization still denies.
6. Property Google disconnect is a separate, idempotent action available only after Archive. It changes only the Property-owned binding generation and destination readiness; the Organization Google connection, stable Property identity, provider suffix history, and retained managerial data remain intact. Provider identity scrubbing and permanent erasure are not part of this action.
7. An expired recovery window leaves the Property archived for support handling. There is no automatic purge, hard-delete path, or irreversible erasure in this slice; support-mediated permanent erasure remains separate LIF-01 work.
8. A Google review destination is accepted only from provider discovery/import,
   restricted to approved HTTPS Google hosts, and pinned to the binding generation.
9. Disconnect preserves the last destination only as `awaiting_refresh`; credential scrub clears it. Neither state is a public rendering authority.
10. Property creation never infers a Responsible Manager from the creator. Losing
    all eligible managers records `responsibilityNeededSince`; no replacement is
    guessed and offboarding is not blocked.
11. Responsible Manager history is owned by the Property aggregate. Its behavior at permanent erasure remains part of the future support-mediated LIF-01 workflow; normal product actions cannot erase it.
12. `verifyPurgeReadiness` fails closed while any Property is still `active` or
    `disconnecting`.
13. Portal and Guest rows RESTRICT Property deletion until their own purge receipts
    exist. It is never converted into a cascade that erases another owner's rows without that owner's receipt.

## Verification

Unit tests stay beside domain rules, use cases, server contracts, public APIs, and
responsibility/lifecycle behavior. PostgreSQL integration tests cover command
atomicity, source-epoch fences, archive/restore/disconnect, denied deletion,
closure readiness, restrictive purge order, export, and replay.
