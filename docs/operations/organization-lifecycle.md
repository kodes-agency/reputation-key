# Organization and Property Lifecycle Control Plane (LIF-01)

## Operational status

Property lifecycle (Archive, Restore, Disconnect) and member offboarding are
composed through authenticated server functions. Organization closure has no
in-app runtime: there is no request, cancel, reactivation, scheduled worker or
support command. An Organization is suspended by naming its ID in
`BETA_SUSPENDED_ORGS`, and its personal data is exported and erased on request
through the manual procedure in [rights-requests.md](rights-requests.md).

The Organization lifecycle authority tables, their triggers and the lifecycle
event are gone. Only `organization_lifecycle_events` remains, an append-only
ledger that backup erasure hold releases read and write.

## Property lifecycle

Normal product management uses Archive, Restore, and Disconnect. The legacy
`property.delete` server/use-case path always returns the lifecycle-unavailable
error before it can call a repository, provider, queue, or purge dependency.
The capability map sends that legacy permission to the blocked
`property.erase` capability.

Archive atomically changes the stable Property row to `archived`, advances its
source epoch, creates a 30-day recovery deadline, fences the current Google
review destination (`awaiting_refresh`; the URI and its pin are kept), and
records `property.archived`. Archived Properties are
excluded from normal external effects and public work by lifecycle admission.
Owners of scheduled work react to the fact themselves: Inbox cancels the
Property's unreleased Response Target reminder slots, and Notification treats a
reminder released for a non-active Property as obsolete. Restore re-arms none of
those slots; a cancelled slot is terminal
(`docs/operations/inbox-response-targets.md`). Review cancels the Property's
reply publications that were approved but not yet sent as policy
cancellations (the Reply returns to draft); a write already dispatched stays
with the publish worker and reconciliation. The publish worker itself refuses
to send, and cancels as policy, a cycle whose Property is not active at the
cycle's source epoch, so a Restore before either runs cannot turn the stale
cycle into a "Google rejected" notice. New approvals are refused until the
Property is active again and the Review has been observed at its current
source epoch.

Restore is permitted only before the recovery deadline. It rechecks current
Property access and an eligible Responsible Manager,
then advances the source epoch and records `property.restored`. Portal reacts
by raising `portal.responsibility_became_needed` for each live Portal of the
Property that still has no manager, because those gaps stayed silent while it
was archived and Restore checks only the Property's own manager. The returned
Google-binding readiness is either `ready` or `reconnect_required`; Restore does
not silently recreate provider authority. When the binding is still `active`,
Restore also returns the fenced Google review destination to `verified`, pin
unchanged, so the Property's live Portals offer the Google action again and can
be published; it calls Google for nothing. A binding disconnected while
archived leaves the destination `awaiting_refresh` until a relink, and a
Property Google gave no review link at import still has none.

Google-binding Disconnect requires the Property to be archived. It uses the
Property-owned exact epoch/profile-version store and is idempotent for already
disconnected/unbound bindings. It does not erase retained managerial history.

Permanent Property Erase remains deliberately absent. Beta activation still
requires AccountAdmin request, support identity verification, dependency and
retention preview, typed confirmation, asynchronous per-owner purge evidence,
and an irreversible boundary drill.

## Organization closure and suspension

- **Suspension.** Add the Organization ID (not its slug) to `BETA_SUSPENDED_ORGS`
  on web and worker. Every capability check is then denied with `org_suspended`.
  Removing the ID lifts it.
- **Purge.** `pnpm ops rights-request` refuses an Organization purge unless the
  Organization is suspended in the environment the command runs with. Export
  first, send the final warning, then apply with the typed confirmation
  (rights-requests.md).
- **Scheduled worker.** The former lifecycle advancement job is gone. Its
  scheduler name `advance-organization-lifecycle` is kept in the retired
  scheduler list so worker reconciliation removes any recurrence a surviving
  Redis still holds, and no handler remains for a job queued under the old name.

## Member offboarding

There is no self-service leave: an AccountAdmin removes a member, and nobody
removes themselves. The app-owned member-removal flow refuses removal of the
final AccountAdmin.
Before the Identity command, composition fences Google connector/import work
and releases current Property/Portal/Inbox manager authorities and Property
access grants. The Identity transaction then locks the exact membership,
verifies the durable fact names that same user, deletes all Better Auth sessions
for the departing user, deletes membership, and appends
`identity.member.removed`.

The release before the Identity command is not the last one. Until the
membership is deleted the member is still an eligible manager, so an assignment
another admin saves in between is accepted. Property and Portal therefore
release again from `identity.member.removed` (worker consumers
`property.on-member-removed` and `portal.on-member-removed`): whatever the
member still holds and may no longer hold. A "Responsible Manager needed" notice
can follow a removal by a few seconds for that reason, and it is correct. A
save of a Property's or Portal's managers also reads eligibility again after it
commits and releases, and refuses, a manager who was removed while it ran.

When these two consumers are first deployed, the five-minute redelivery sweep
hands them every published `identity.member.removed` fact older than two hours
that is still in the outbox: such a fact has no receipt for them yet. That
releases a Responsible Manager who was removed earlier and is still assigned; a
member who is back keeps what they may hold; a fact with nothing left to
release only records its receipt.

`property_access_grant` revocation now commits INSIDE the Identity transaction
alongside session deletion, binding release, membership deletion and the
`identity.member.removed` fact. Google connector and import fencing cannot join
that transaction, so they still run before it — deliberately, because a fenced
connector with a surviving membership is repairable while a deleted membership
with a live provider grant is not.
