# Portal — Context

**Audience:** Developers and agents working in `src/contexts/portal/`.

## Responsibility

Property-owned public review gateways. The private rating-first → Google Review
Action journey is primary; optional secondary links are a subordinate link tree.
The context also owns publication lifecycle, Portal Groups, responsible-manager
assignment, and governed access artifacts.

## Boundaries

- Guest resolves public Portal data through `PortalPublicApi`; Goal reads group
  membership through `PortalGroupPublicApi`. Portal does not read their stores.
- Retained `entityType`/`entityId` values may reference historical Team or Staff rows for reconciliation. They never change Property ownership, authorization, grouping, or notification responsibility.
- AI Reply Brand Authority is content-minimal. Generation may read only the exact display name, profile version, and derived display-name digest; transaction-bound callers receive only a boolean exact-current answer. Image URLs, colors, localized content, Portal overrides, links, Guest ratings, and Private Feedback are never exposed through it.
- Responsible-manager assignment never grants property access, portal access, or staff attribution.
- `PortalRepository` is a read-only production port. Authoritative mutations are available only through Portal command stores; direct PostgreSQL seeding/mutation lives under explicit test scaffolding and is guarded from production wiring by an architecture test.
- Lifecycle export and purge contributors stay outside `publicApi`; irreversible
  phases are composed only through the reviewed Identity lifecycle coordinator.
- Not exported, and not queried: `portal_tokens` (address-token hash and encrypted raw token), `portal_upload_issuances` and their object keys (`portal.upload` is safety-blocked, so Portal upload stays dark), and `portal_access_artifacts.portal_token_id`, which is the join key into the token secret.
- Not touched by any phase: `portal_upload_issuances` beyond the purge plan (`portal.upload` is safety-blocked, so there is no live effect to cancel and a lifecycle write there would reach into a dark capability), `portal_metric_lifetime_aggregates` (Metric's anonymous aggregate), `properties`, and the Staff-owned people rows. Each is another owner's receipt.

## Model

A Portal is Property-owned and may contain ordered secondary-link categories. A
Portal Publication Snapshot is the immutable, manager-approved rating-first
experience. Editing the working copy never mutates an active snapshot.
Activations are append-only effective-dated routes from a stable token to one
snapshot; publish and rollback append activations, while disable/archive close
one. Groups remain Property-scoped, and one Portal has at most one active group.

The eligible creator is the initial Portal Responsible Manager. Multiple eligible
managers may be assigned; losing the last sets `responsibilityNeededSince`, and
nobody is auto-promoted.

The beta has no upload UI, issuance/finalization server function, or application use case, and `portal.upload` is safety-blocked. Its store, worker, and storage code remain only as deferred infrastructure cleanup and are unreachable from product requests.

## Runtime

`build.ts` is the sole composition root. Server adapters call Portal use cases;
public token resolution returns only the current open, digest-verified snapshot.
Portal, Group, content, responsibility, and token commands use Portal-owned stores
that commit state, revisions, receipts, and identifier-only outbox facts together.

The image jobs and their issuance/storage dependencies remain registered only because removing them is deployment-shaped infrastructure work. No UI, server function, or application use case can create an issuance or emit a processing request. Consequently `process-image` has no producer, while the scheduled cleanup job has no candidate rows in the disposable beta environment; neither can perform a hero-image effect.

## Invariants

1. Portal slugs and Portal Group names are unique within a Property; one Portal
   belongs to at most one active group.
2. Private Feedback Threshold is an integer from 1 through 5.
3. A Portal may have no secondary links. It cannot enter `published` unless its Property has a verified, provider-derived Google review destination.
4. Publishing atomically creates and activates an immutable snapshot. Working-copy edits are prospective and cannot change the public response until another deliberate publication.
5. Rollback never rewrites history: it closes the current activation and appends a new activation to an older valid snapshot.
6. If that destination later becomes stale, unavailable, or temporarily unreadable, the published private rating/feedback gateway remains available in a degraded state. No stale URI is serialized and Google selection is denied with gentle guest copy.
7. Public resolution fails closed when that Property destination is `awaiting_refresh` or `unavailable`; a stale URI is never rendered.
8. Soft-deleting a Portal revokes its live tokens; a deleted Portal never has a live
   token. Token issue, rotation, and revocation share the Portal revision fence.
9. The raw address is request-local and never enters state, facts, logs, or Metric.
10. Portal lifecycle facts never copy Portal name, slug, description, theme, responsible-manager assignments, destination, or link content.
11. No request surface can create an issuance or emit `portal.hero_image.processing_requested`, so this path is unreachable in the disposable beta environment.
12. The POR-01 report never copies names, localized content, raw URLs, token material, themes, or print-batch values and never infers creator, ownership, translation, brand, or destination provenance. Reported ambiguous Portal rows remain Disabled or Archived; raw secondary links are treated as quarantined and excluded from publication until a separately reviewed command resolves them.
13. Closing is a **stop, not a delete**, and it is reversible: the immutable publication snapshot survives and `portals.publication_state` keeps the tenant's own published/draft intent, so explicit reactivation re-points a new activation at the same snapshot rather than guessing what each Portal used to be. Ordinary closure cancellation does not itself reactivate Portals — see `docs/operations/organization-lifecycle.md`.
14. `portal_group_members` is purged as a **row delete only**. It is a physical-drop-blocked compatibility mirror: the rows are tenant content and must go, the table must not. No phase issues a DROP or TRUNCATE.

## Verification

Unit tests stay beside domain rules, publication, token, responsibility, and server
contracts. PostgreSQL integration tests cover command atomicity, revision fences,
public resolution, lifecycle contributors, and the POR-01 read-only reconciliation.
The build and architecture tests pin public surfaces, worker reachability, and the
read-only repository boundary.
