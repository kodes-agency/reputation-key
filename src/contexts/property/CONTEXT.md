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
  `PropertyGoogleBindingPublicApi`, which the build returns as its own
  `googleBinding` capability and never on `publicApi`.
- Identity supplies membership, role and Property access, which decide
  Responsible Manager eligibility. Responsible Manager assignment is notification
  routing, not authorization or attribution.
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
A Property archived and restored with its Google binding untouched comes back
with the same Google review destination, verified under the same pin.

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
   Organization. Two Organizations can hold the same Google location, so the
   one lookup by location alone (`listByGbpLocationId`, for a verified Google
   notification) answers with every Property that holds it, in a fixed order,
   and never with a single arbitrary row.
2. Only `verified` Google review destinations may be rendered; `awaiting_refresh`
   and `unavailable` fail closed.
3. Destructive Property deletion is unreachable from the normal product in beta. The legacy `deleteProperty` server boundary and use case both fail closed before lookup, purge, provider fencing, or durable writes; `property.delete` maps to the permanently blocked `property.erase` capability.
4. Archive mutates the existing Property row in place, records the initiating AccountAdmin/reason/deadline, increments `sourceEpoch`, fences the Google review destination as `awaiting_refresh` when one is held (the URI and its pin are kept), and co-commits the content-free `property.archived` fact. It never deletes the Property or a dependent row.
5. Only an archived Property inside its original recovery window may be restored through the normal product. Restore revalidates at least one current eligible Responsible Manager, increments `sourceEpoch`, co-commits `property.restored`, and reports whether Google reconnection is required. It does not silently reconnect or resume provider work that current binding authorization still denies.
   Restore returns a fenced destination to `verified` when, and only when, the Google binding is still `active` (`googleReviewDestinationStateAfterLifecycleTransition`). Nothing re-reads it from Google and nothing has to: every binding change (disconnect, relink, scrub) moves the binding off `active` or replaces the destination, so an `active` binding still holding a fenced destination is the same binding (connection, account, location) that destination was accepted for. The URI and its pin are unchanged, so a Portal published against it offers the Google action again without republishing. Under any other binding the destination stays `awaiting_refresh` until a relink accepts a new one, and a Property with no destination keeps none.
6. Property Google disconnect is a separate, idempotent action available only after Archive. It changes only the Property-owned binding generation and destination readiness; the Organization Google connection, stable Property identity, provider suffix history, and retained managerial data remain intact. Provider identity scrubbing and permanent erasure are not part of this action.
7. An expired recovery window leaves the Property archived for support handling. There is no automatic purge, hard-delete path, or irreversible erasure in this slice; support-mediated permanent erasure remains separate LIF-01 work.
8. A Google review destination is accepted only from provider discovery/import,
   restricted to approved HTTPS Google hosts, and pinned to the binding generation.
   It carries no age limit and there is no background refresh: the destination
   read at import or relink stands until the next relink. A Property imported
   while Google returned no review URI is `unavailable` and stays so, through
   Archive and Restore too; only a relink asks Google again, and that is
   Archive, Disconnect, Restore, then the Google import (Disconnect needs an
   archived Property and the import relinks only an active one).
   `awaiting_refresh` is therefore a hold, not a refresh under way: Restore
   lifts it for a Property that is still linked and a relink replaces it, and
   on an active Property it means Google was disconnected. No manager surface
   may say the link is being refreshed or will clear by itself. A Portal is
   published only against a `verified` destination, so the Property's Google
   card and the Restore result say, for every state short of it, that
   publishing is blocked or which step brings the link back.
9. Disconnect preserves the last destination only as `awaiting_refresh`; credential scrub clears it. Neither state is a public rendering authority.
10. Property creation never infers a Responsible Manager from the creator. Losing
    all eligible managers records `responsibilityNeededSince`; no replacement is
    guessed and offboarding is not blocked. Only an active Property also raises
    `property.responsibility_became_needed`: an archived one needs a manager to
    be restored, not an urgent notice (ADR 0052).
    Removing a member releases their Property responsibilities twice: before
    the membership is deleted, in a commit of its own, and again from
    `identity.member.removed` (`property.on-member-removed`), the fact every
    removal path records with the membership delete. Until that delete the
    member is still eligible, so an assignment saved in between is accepted,
    and only the second release sees it. Eligibility is asked at delivery, so a
    member invited again in the meantime keeps what they may hold.
    A save of the managers reads eligibility twice: before its write, and again
    once the write has committed. The first read is not under the write's lock,
    so a removal, role change or lost access that commits in between is seen by
    neither that read nor a release that ran before the assignment existed.
    Whichever of the two commits second is therefore followed by a check that
    sees the other: the save's second read, or the release from the fact (after
    a removal) or the reconciliation (after a role or access change). A manager
    the second read finds no longer eligible is released with reason
    `manager_became_ineligible`, the gap is recorded and announced with no actor
    left out, and the save answers `responsible_manager_ineligible`; the rest
    of the selection stays saved.
11. Responsible Manager history is owned by the Property aggregate. Its behavior at permanent erasure remains part of the future support-mediated LIF-01 workflow; normal product actions cannot erase it.
12. `verifyPurgeReadiness` fails closed while any Property is still `active` or
    `disconnecting`.
13. Portal and Guest rows RESTRICT Property deletion until their own purge receipts
    exist. It is never converted into a cascade that erases another owner's rows without that owner's receipt.
14. A Property update writes only the columns the request changes, and answers
    and records `property.updated` from the row as committed. The country is no
    exception, although the Profile form sends it with every save: a country
    that repeats the stored one is left out, so a save that changes nothing
    writes nothing and records no fact, and the source the country was recorded
    under stays as it is. A country or a timezone the manager does change is
    recorded with source `tenant_confirmed`, the one source Reporting's setup
    facts accept for either. The request reads the Property without a lock and
    its fence covers the Google binding (`sourceEpoch`) and the name and
    timezone (`profileVersion`) only, so a slug, reply language or country
    repeated from that read would undo another admin's save of it. A save that
    read the Property before a rename or timezone change committed is refused
    (`stale_property`); two saves of the same other column are last-write-wins.

## Verification

Unit tests stay beside domain rules, use cases, server contracts, public APIs, and
responsibility/lifecycle behavior. PostgreSQL integration tests cover command
atomicity, source-epoch fences, archive/restore/disconnect, denied deletion,
closure readiness, restrictive purge order, export, and replay.
`property-archive-restore-google-destination.integration.test.ts` runs Archive,
Disconnect, Restore and relink as the product does and asserts what Portal
publication and the guest page are then told about the Google destination.
`property-update-overlap.integration.test.ts` overlaps two Property saves and
asserts that neither undoes the other.
