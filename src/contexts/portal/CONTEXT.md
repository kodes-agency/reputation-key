# Portal Context

## Bounded context

Property-owned public review gateways. The private rating-first → Google Review
Action journey is primary; optional secondary links are a subordinate link tree.
The context also owns publication lifecycle, Portal Groups, responsible-manager
assignment, and governed access artifacts.

## Glossary

- **Portal** — A Property-owned, rating-first public review gateway with an optional secondary link tree and optional Staff performance attribution.
- **EntityType** — Legacy targeting field. New beta behavior is Property-owned; `team` must not create Team authority, and Staff association is attribution rather than ownership or access.
- **PortalLinkCategory** — Grouping container for links within a portal. Has title and sort key.
- **PortalLink** — An external link within a portal category. Has label, URL, icon, and sort key.
- **PortalTheme** — Visual customization: `primaryColor`, optional `backgroundColor`, `textColor`.
- **Private Feedback Threshold** — Inclusive 1–5 threshold (default 3) captured with a guest rating. Ratings at or below it may add an optional private note after the same Google Review Action shown to every rating.
- **Portal Publication Snapshot** — Immutable, manager-approved version of the exact rating-first public experience: resolved Portal content, ordered secondary links, threshold, locale/language pack, and verified Property-owned Google destination binding. Editing the working copy never mutates an active snapshot.
- **Portal Publication Activation** — Append-only effective-dated routing history from a stable Portal token to one exact publication snapshot. Publish and rollback add activations; disable/archive close the current activation.
- **Portal Publication History** — Manager read model that separates the current live activation from prior publish/rollback activity and reports whether saved Portal content differs from the live (or most recently active) immutable snapshot. Provider-owned Google destination refreshes do not masquerade as saved-content changes.
- **AI Reply Brand Authority** — Content-minimal public authority over the current Property Brand Profile. Generation may read only the exact display name, profile version, and derived display-name digest; transaction-bound callers receive only a boolean exact-current answer. Image URLs, colors, localized content, Portal overrides, links, Guest ratings, and Private Feedback are never exposed through it.
- **Portal Group** — A named collection of portals within a property. Used for shared goal scoping. One portal belongs to at most one group. Metrics are always aggregated from member portals at query time (no pre-computed group metrics).
- **Ungrouped Portal** — A portal not assigned to any portal group. It remains individually targetable by goals.
- **Portal Creator** — Immutable provenance for who created a portal. Creation does not permanently confer notification responsibility.
- **Portal Responsible Manager** — An effective-dated AccountAdmin or eligible PropertyManager assigned to receive and manage that portal's workflow notifications. Multiple managers are supported; assignment does not grant access or staff-performance attribution.
- **Responsibility Needed** — Visible recovery state when a non-archived portal has no assigned responsible manager. It is not an implicit AccountAdmin assignment.
- **Soft Delete** — Portals and portal groups are soft-deleted (marked `deletedAt`), not hard-deleted, to preserve referential integrity.
- **Portal Upload Issuance** — Opaque, single-use authorization for one Portal hero source object, bound to Organization, Property, Portal, MIME, exact declared size, purpose, and 15-minute expiry. Browser callers never submit or receive its object key as API data.
- **Portal Access Artifact** — A RepKey-issued, high-entropy QR/NFC identifier bound to one Portal token and channel. It is qualification evidence, not an alternate Portal identity; public resolution still requires the stable token and exact active Publication Snapshot.

## Relationships

- Portal → Property (required `propertyId`).
- Retained `entityType`/`entityId` values may reference historical Team or Staff rows for reconciliation. They never change Property ownership, authorization, grouping, or notification responsibility.
- Portal → Portal Group (optional, via effective-dated `portal_group_memberships`).
  Retained `portal_group_members` rows are legacy reconciliation evidence only.
  One portal belongs to at most one active group.
- Portal Group → Property (required `propertyId`). One property has many groups.
- Portal has many PortalLinkCategories, each with many PortalLinks.
- Portal has zero or more effective-dated Portal Responsible Managers (`portal_responsible_managers`).
- Portal has zero or more immutable Publication Snapshots and at most one current Publication Activation.
- Portal has zero or more Access Artifacts, each bound to exactly one Portal token and controlled channel.
- Guest context **depends on** `PortalPublicApi` for resolving portal context and public portal data.
- Goal context **subscribes to** `portal.deleted` events to cancel portal-scoped goals.
- Goal context **subscribes to** `portal_group.deleted` events to cancel portal-group-scoped goals.
- Goal context **depends on** `PortalGroupPublicApi.findGroupForPortal` to resolve group membership for metric events.

## Invariants

- Portal slugs must be unique within a property.
- Private Feedback Threshold must be an integer 1–5.
- Portal links belong to a category; categories belong to a portal.
- Portal commands require the named permission, current Property access, and the relevant capability; raw role rank is not command authority.
- Portal group names must be unique within a property.
- One portal belongs to at most one active portal group (enforced by the
  effective-dated membership exclusion/unique constraints).
- A portal group belongs to exactly one property.
- A Portal may have no secondary links. It cannot enter `published` unless its Property has a verified, provider-derived Google review destination.
- Every transition from Draft/Disabled to Published atomically inserts a new immutable snapshot, activates that exact version, updates Portal state, and records both the compatibility `portal.updated` fact and the dedicated `portal.publication.published` fact. Publication fails if the locked working copy differs from the approved snapshot.
- A stable active/rotating Portal token resolves only the current open activation and its digest-verified immutable snapshot. Working-copy edits are prospective and cannot change the public response until another deliberate publication.
- Rollback never rewrites history: it closes the current activation and appends a new activation to an older valid snapshot. Database guards reject snapshot rewrites and every activation rewrite except its one-time interval closure; deletion remains reserved for the future governed Erase path. Disable/archive closes the activation, and token revocation always prevents resolution.
- Publication history reads require `portal.read`, re-use the same Property access guard as Portal detail, and query activations by the exact Organization/Property/Portal tuple. The manager surface never exposes destination URIs, publication digests, or actor identifiers.
- If that destination later becomes stale, unavailable, or temporarily unreadable, the published private rating/feedback gateway remains available in a degraded state. No stale URI is serialized and Google selection is denied with gentle guest copy.
- Public resolution fails closed when that Property destination is `awaiting_refresh` or `unavailable`; a stale URI is never rendered.
- Each successful public resolution carries the immutable snapshot ID, version, and SHA-256 publication digest plus a per-render configuration digest covering the exact content, link order/destinations, current Google availability, threshold, locale, and language-pack version. The browser projection omits this evidence; Guest persists it atomically with a new private rating. A composite database reference prevents Guest evidence from pairing a real snapshot ID with the wrong version or digest. The revisioned public language contract supports `en` / `guest-ui-en-v1` and `bg` / `guest-ui-bg-v1`; the selected locale and exact pack version are bound into the published snapshot and per-render evidence.
- Soft-deleting a portal revokes its active/rotating portal tokens; a deleted portal never has a live token.
- The eligible creator is the initial Portal Responsible Manager. AccountAdmins are organization-wide eligible; PropertyManagers require both current property access and active participation for that property.
- Responsible-manager assignment never grants property access, portal access, or staff attribution.
- Responsible-manager updates preserve unchanged effective-dated intervals and use `responsibleManagerRevision` compare-and-swap; stale writes fail with `revision_conflict`. If a regressed business clock would close an interval at or before its start, the transient interval is removed instead of storing an invalid zero-length history row. Every changed selection or offboarding release atomically records one identifier-only `portal.responsible_managers.updated` per affected Portal with the resulting assignment count and the DB-returned Portal revision.
- Losing the last manager sets `responsibilityNeededSince` and atomically records a separate identifier-only recovery fact at that same committed revision. Adding any manager clears the state; nobody is auto-promoted.
- Core Portal creation, update/publication transition, and soft deletion use one Portal-owned command store. Authoritative Portal state, initial responsibility, live-token revocation on delete, and every required lifecycle outbox fact commit in the same PostgreSQL transaction. The in-process bus runs only after commit.
- Portal Group soft deletion uses the same command boundary: the Group archive, effective-dated membership closure, and `portal_group.deleted` outbox fact commit together under an `updatedAt` revision fence. A failed fact write or stale manager view changes none of them.
- Portal Group create/rename/membership commands use that boundary too. Group state, effective-dated membership changes, an `updatedAt` compare-and-swap fence, and identifier-only versioned facts commit together.
- After a confirmed Portal Group create, rename, archive, membership add, or membership remove, the manager client invalidates the exact Property-scoped Group list, Goal subject picker, and Goal subject-name projections. A rejected command leaves those caches untouched; no whole-router or cross-Property invalidation is used.
- Portal link/category create, update, delete, and reorder commands fence the parent Portal `updatedAt`; update/delete discovery reads the child and parent revision from one database snapshot. Content rows, the parent revision, and identifier-only versioned facts share one transaction. This prevents a content edit from crossing publication or another content mutation unnoticed.
- Portal token issue/rotation/revocation use the parent Portal revision and one lock order. Token state, Portal revision, and the versioned lifecycle fact commit together; retries cannot duplicate a token or fact.
- Token issue and rotation atomically publish a new QR Access Artifact and return its identifier only as part of the generated public URL. The artifact row and identifier-only `portal.access_artifact.published` fact share the token transaction; a failed artifact/fact insert rolls back the token mutation.
- An Access Artifact resolves only when its Organization/Property/Portal scope matches, it is published and unretired at observation time, the presented raw address matches its bound token, that token is active (or inside rotation grace), the Portal is published, and the exact server-rendered Publication Snapshot has an active interval. Portal Group attribution is resolved at that observation time and returned as captured provenance; later group moves do not reinterpret it. The raw address is request-local and never enters state, facts, logs, or Metric.
- `portals.updatedAt` is a monotonic command revision, not raw wall-clock time. Every command captures `occurredAt = clock()` for business timestamps, then separately allocates a revision strictly after the locked aggregate value. Delayed workflow, upload, and responsibility writers use the same database allocator. Durable facts carry the DB-committed revision even when the clock regresses, while snapshots, activations, memberships, tokens, content rows, and deletion intervals retain actual occurrence time. Publication and content edits acquire the Portal row before working-copy table locks.
- Portal lifecycle facts are content-minimal. Every fact carries exact Organization/Property/Portal scope and `sourceAggregateVersion = committed updatedAt.toISOString()`; `occurredAt` is independent business time and need not equal that revision. Publication and rollback facts additionally carry the exact immutable snapshot ID/version/digest and acting user ID; archive and restore facts carry the acting user ID. They never copy Portal name, slug, description, theme, responsible-manager assignments, destination, or link content. Constructors generate each outbox event UUID. Command-specific semantic receipts or locked source identities govern replay, while optimistic `updatedAt` fencing rejects stale commands.
- `PortalRepository` is a read-only production port. Authoritative mutations are available only through Portal command stores; direct PostgreSQL seeding/mutation lives under explicit test scaffolding and is guarded from production wiring by an architecture test.
- Portal hero source keys are server-derived from an opaque issuance ID and the presigned PUT is first-write-only. Finalization accepts only that ID, rechecks current scope/state/expiry and exact storage MIME/size/ETag, and atomically consumes it with the durable processing fact. The worker reads with that observed ETag as an immutable-version fence. A newer consumed issuance supersedes an older worker; only the current consumed issuance may publish newly derived WebP keys. Hero URL publication, issuance finalization, and identifier-only `portal.hero_image.published` commit together; replay returns `already_finalized` without another fact. Client Portal updates may remove a hero image but may never set a non-null URL.
- The POR-01 beta-readiness reconciliation is read-only and requires an explicit
  observation cutoff. It emits only Organization/Property/Portal/source IDs,
  related IDs, controlled reason codes, counts, and a canonical fingerprint.
  It never copies names, localized content, raw URLs, token material, themes, or
  print-batch values and never infers creator, ownership, translation, brand, or
  destination provenance. Reported ambiguous Portal rows remain Disabled or
  Archived; raw secondary links are treated as quarantined and excluded from
  publication until a separately reviewed command resolves them.

## Events produced

Every domain fact also carries its unique `eventId` and nullable
`correlationId`; the table lists the versioned durable payload fields.

| Tag                                          | Payload                                                                                                                                        | When                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `portal.created`                             | portalId, organizationId, propertyId, publicationState, sourceAggregateVersion, occurredAt                                                     | Portal is created                                       |
| `portal.updated`                             | portalId, organizationId, propertyId, previousPublicationState, publicationState, sourceAggregateVersion, occurredAt                           | Portal aggregate revision advances (compatibility fact) |
| `portal.publication.published`               | organizationId, propertyId, portalId, publicationSnapshotId, publicationVersion, publicationDigest, userId, sourceAggregateVersion, occurredAt | A manager publishes an exact immutable snapshot         |
| `portal.publication.rolled_back`             | organizationId, propertyId, portalId, publicationSnapshotId, publicationVersion, publicationDigest, userId, sourceAggregateVersion, occurredAt | A manager activates an earlier immutable snapshot       |
| `portal.archived`                            | organizationId, propertyId, portalId, userId, sourceAggregateVersion, occurredAt                                                               | A manager moves the Portal into recoverable Archive     |
| `portal.restored`                            | organizationId, propertyId, portalId, userId, sourceAggregateVersion, occurredAt                                                               | A manager restores Archive to Disabled                  |
| `portal.deleted`                             | portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                                       | Portal is soft-deleted                                  |
| `portal.health.changed`                      | portalId, organizationId, propertyId, previousStatus/reason, status/reason, sourceVersion, occurredAt                                          | Reconciliation changes the persisted health interval    |
| `portal.property_brand_profile.updated`      | organizationId, propertyId, profileVersion, sourceAggregateVersion, occurredAt                                                                 | Property brand profile changes                          |
| `portal.property_brand_content.updated`      | organizationId, propertyId, guestLocale, contentVersion, sourceAggregateVersion, occurredAt                                                    | Localized Property brand content changes                |
| `portal.localized_override.updated`          | organizationId, propertyId, portalId, guestLocale, overrideVersion, sourceAggregateVersion, occurredAt                                         | Portal-localized override changes or is removed         |
| `portal.locale_set.updated`                  | organizationId, propertyId, portalId, primaryGuestLocale, additionalGuestLocales, sourceAggregateVersion, occurredAt                           | Portal guest-locale set changes                         |
| `portal.approved_destination.updated`        | approvedDestinationId, organizationId, propertyId, approvalState, sourceAggregateVersion, occurredAt                                           | Approved-destination state changes                      |
| `portal.responsibility_became_needed`        | portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                                       | Portal becomes unowned and needs manager responsibility |
| `portal.responsible_managers.updated`        | portalId, organizationId, propertyId, assignmentCount, sourceAggregateVersion, occurredAt                                                      | Responsible-manager assignments change                  |
| `portal.hero_image.processing_requested`     | uploadId, portalId, organizationId, propertyId, sourceETag, occurredAt                                                                         | Finalized upload requests fenced image processing       |
| `portal.hero_image.published`                | uploadId, portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                             | Processed hero image is published                       |
| `portal.content_review.completed`            | reviewId, revision, organizationId, propertyId, portalId, portalGroupId, supersedesSourceEventId, sourceAggregateVersion, occurredAt           | A versioned content review completes                    |
| `portal.configuration_completeness.recorded` | content-review identifiers, completedFields, requiredFields                                                                                    | Content review records configuration completeness       |
| `portal.approved_destination_ratio.recorded` | content-review identifiers, approvedDestinations, configuredDestinations                                                                       | Content review records approved-destination coverage    |
| `portal.token.issued`                        | portalId, organizationId, propertyId, tokenIdentifier, version, sourceAggregateVersion, occurredAt                                             | Portal access token is issued                           |
| `portal.token.rotated`                       | portalId, organizationId, propertyId, previousVersion, version, gracePeriodEnds, sourceAggregateVersion, occurredAt                            | Portal access token is rotated                          |
| `portal.token.revoked`                       | portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                                       | All portal access tokens are revoked                    |
| `portal.access_artifact.published`           | accessArtifactId, organizationId, propertyId, portalId, channel, sourceAggregateVersion, occurredAt                                            | QR, NFC, or short-link access artifact is published     |
| `portal_group.created`                       | portalGroupId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                                  | Portal group is created                                 |
| `portal_group.updated`                       | portalGroupId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                                  | Portal group is updated                                 |
| `portal_group.deleted`                       | portalGroupId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                                  | Portal group is soft-deleted                            |
| `portal_group.portal_added`                  | portalGroupId, portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                        | Portal is added to a group                              |
| `portal_group.portal_removed`                | portalGroupId, portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                        | Portal is removed from a group                          |
| `portal_link_category.created`               | portalId, categoryId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                           | Portal link category is created                         |
| `portal_link_category.reordered`             | portalId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                                       | Portal link categories are reordered                    |
| `portal_link_category.updated`               | portalId, categoryId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                           | Portal link category is updated                         |
| `portal_link_category.deleted`               | portalId, categoryId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                           | Portal link category is deleted                         |
| `portal_link.created`                        | portalId, linkId, categoryId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                   | Portal link is created                                  |
| `portal_link.reordered`                      | portalId, categoryId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                           | Portal links are reordered                              |
| `portal_link.updated`                        | portalId, linkId, categoryId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                   | Portal link is updated                                  |
| `portal_link.deleted`                        | portalId, linkId, categoryId, organizationId, propertyId, sourceAggregateVersion, occurredAt                                                   | Portal link is deleted                                  |

> **Subscriber status:** `portal.created`, the compatibility `portal.updated`
> fact, and the four dedicated publication/archive/restore facts are durable
> lifecycle/audit facts with no product projection today. Dedicated facts are
> the semantic authority for those four transitions. `portal.deleted` is durable and has the retained
> Goal cleanup subscriber. The link/category/group events
> (`portal_group.created`, `portal_group.updated`, `portal_group.portal_added`,
> `portal_group.portal_removed`, `portal_link_category.created`,
> `portal_link_category.reordered`, `portal_link_category.updated`,
> `portal_link_category.deleted`, `portal_link.created`, `portal_link.reordered`,
> `portal_link.updated`, `portal_link.deleted`,
> `portal.responsible_managers.updated`, and `portal.hero_image.published`) are
> durable identifier-only audit facts with no current subscriber. Display names, titles,
> labels, and URLs are excluded from their outbox allowlists.

## Events consumed

None. Portal context does not subscribe to events from other contexts.

## Architecture layers

```
portal/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             portal.repository.ts, portal-group.repository.ts, portal-link.repository.ts,
                       portal-command-store.port.ts, portal-publication.repository.ts,
                       portal-upload-issuance-store.port.ts,
                       portal-token.repository.ts, portal-token-codec.port.ts,
                       storage.port.ts, link-resolver.port.ts
    dto/               create-portal.dto.ts, update-portal.dto.ts,
                       create-portal-group.dto.ts, update-portal-group.dto.ts,
                       portal-link.dto.ts, portal-link-category.dto.ts
    use-cases/         create-portal.ts, update-portal.ts, get-portal.ts, list-portals.ts,
                       soft-delete-portal.ts, create-link.ts, update-link.ts, delete-link.ts,
                       create-link-category.ts, update-link-category.ts, delete-link-category.ts,
                       reorder-links.ts, reorder-categories.ts, request-upload-url.ts,
                       finalize-upload.ts, list-portal-links.ts,
                       create-portal-group.ts, update-portal-group.ts, soft-delete-portal-group.ts,
                       list-portal-groups.ts, get-portal-group.ts,
                       add-portal-to-group.ts, remove-portal-from-group.ts,
                       issue-portal-token.ts, rotate-portal-token.ts, revoke-portal-tokens.ts,
                       resolve-public-portal-token.ts, rollback-portal-publication.ts,
                       get-portal-publication-history.ts,
                       complete-content-review.ts,
                       portal-responsible-managers.ts
    portal-beta-readiness-reconciliation.ts (canonical identifier-only operator report)
    public-api.ts      re-exports port types, PortalPublicApi, PortalGroupPublicApi, event types/constructors
  infrastructure/
    portal-command-store.ts (atomic Portal, Group, content, token state + outbox facts)
    portal-upload-issuance-store.ts (single-use scoped issuance + stale-worker fence)
    repositories/      portal.repository.ts, portal-publication.repository.ts,
                       portal-access-artifact.repository.ts,
                       portal-group.repository.ts, portal-link.repository.ts,
                       portal-token.repository.ts, portal-scope.repository.ts,
                       portal-responsible-manager.repository.ts,
                       portal-beta-readiness-reconciliation.repository.ts,
                       link-resolver.repository.ts (Drizzle)
    adapters/          s3-storage.adapter.ts,
                       portal-organization-export.adapter.ts
    mappers/           portal.mapper.ts, portal-group.mapper.ts, portal-link.mapper.ts
    jobs/              process-image.job.ts, cleanup-upload-sources.job.ts,
                       revalidate-approved-destinations.job.ts
  server/              portals.ts, portal-groups.ts, portal-links.ts,
                       portal-responsible-managers.ts,
                       portal-link-categories.ts, property-scope.ts
  build.ts             composition root
```

## Use cases

- **`createPortal`** — Create a new Property-owned portal. New commands accept only the selected Property as ownership; retained Team/Staff fields are legacy-read evidence, never command authority. The use case validates the Property through `PropertyPublicApi`, then atomically commits the Portal, initial responsibility state, `portal.created`, and any responsibility-needed recovery fact.
- **`updatePortal`** — Update portal settings (name, slug, description, hero image, theme, Private Feedback Threshold, publication state). `heroImageUrl: null` clears the hero image. A transition into Published requires a verified Property-owned Google destination and atomically creates/activates an immutable publication snapshot; disable/archive closes the active route. Ordinary edits to an already-published working copy remain prospective. The patch and identifier-only `portal.updated` fact share one optimistic, version-fenced commit.
- **`rollbackPortalPublication`** — Deliberately route a currently Published Portal to an older digest-verified snapshot by appending a rollback activation; never mutates either snapshot or erases activation history.
- **`getPortalPublicationHistory`** — Return the current live version, prior publish/rollback activations, and saved-content pending state after rechecking Portal read permission and Property access. A paused/archived Portal has no live version but retains earlier activity.
- **`getPortal`** — Retrieve a single portal by ID, plus `tokenStatus` (C2): whether a public token still resolves (active, or rotating inside its grace window — same predicate as public token resolution), its version, issue time and grace end. Metadata only: the raw token and its digest are returned by issue/rotate alone.
- **`listPortals`** — List portals for an org/property with filters.
- **`softDeletePortal`** — Atomically soft-delete a Portal, revoke all live Portal tokens, and record `portal.deleted` plus `portal.token.revoked` when tokens were live. A fact conflict or stale Portal version rolls back the entire set.
- **`createLink`** / **`updateLink`** / **`deleteLink`** — Manage portal links.
- **`createLinkCategory`** / **`updateLinkCategory`** / **`deleteLinkCategory`** — Manage link categories.
- **`reorderLinks`** / **`reorderCategories`** — Reorder items by sort key.
- **`requestUploadUrl`** / **`finalizeUpload`** — Persist and consume a scoped hero upload issuance. The API returns/accepts `uploadId`, never an object key; the PUT cannot overwrite an existing source, and finalization records an ETag-bound processing request in the same transaction as consumption. The previous hero remains visible while a private source is decoded and re-encoded.
- **`listPortalLinks`** — List all links for a portal (flat, with category info).
- **`createPortalGroup`** — Create a new portal group for a property. Validates name uniqueness and portal memberships. Optionally adds initial portals (pre-validated).
- **`updatePortalGroup`** — Update group name. Validates name uniqueness (excluding self).
- **`softDeletePortalGroup`** — Atomically soft-delete a group, close its active effective-dated memberships, and record `portal_group.deleted`; membership history is not hard-deleted.
- **`listPortalGroups`** — List groups for an org/property.
- **`getPortalGroup`** — Retrieve a single group by ID.
- **`addPortalToGroup`** — Add a portal to a group. Validates portal not already in another group.
- **`removePortalFromGroup`** — Remove a portal from its group. Validates portal was in the group.
- **`issuePortalToken`** / **`rotatePortalToken`** / **`revokePortalTokens`** — Portal token lifecycle for public QR links.
- **`resolvePublicPortalToken`** — Resolve an active/rotating token to the exact current immutable publication snapshot, honouring rotation grace periods and failing closed on missing/tampered snapshot evidence. A changed destination binding degrades only the Google action; private rating/feedback remains available.
- **`completeContentReview`** — Lock the Portal first, then read its child configuration in a new statement so a lock wait cannot pair a new Portal revision with a stale statement snapshot. Record the completed review and its three derived workflow facts at one DB-returned Portal revision, then emit after commit. Replay is recognized by the locked Organization/Property/Portal/Review/revision identity, so it neither duplicates facts nor advances the revision; event IDs remain constructor-generated facts rather than caller-owned idempotency keys.
- **`listPortalResponsibleManagers`** — Return current assignments, currently eligible candidates, responsibility-needed state, and the CAS revision.
- **`updatePortalResponsibleManagers`** — Replace the manager set after revalidating every selected manager; supports multiple or zero, preserves effective-dated history, and records the assignment-count fact plus any last-manager recovery fact in the same revision transaction.
- **`buildPortalBetaReadinessReportFromDatabase`** — Read-only POR-01 inventory
  for legacy owner/creator evidence, current group overlap or compatibility
  disagreement, printed-token/Access Artifact replacement readiness,
  Property-brand and enabled-locale completeness, and raw secondary-link
  classification. The explicit cutoff and sorted Organization scope produce a
  canonical, repeatable JSON report; corrections occur only through separately
  reviewed Portal commands.

## Public API

Exported from `application/public-api.ts`:

- Ports: `StoragePort`, `PortalStoragePort`, `IssuedPortalUploadStoragePort`, `LinkResolverPort`
- Types: `Portal`, `PortalContextResult`, `PortalPublicApi`, `PortalGroupSummary`, `PortalTokenStatus` (token existence/metadata for management surfaces — never token material), `PortalPublicationHistory`, `PortalPublicationHistoryItem`
- Public-load types: `PublicPortalResult`, `PublicPortalByTokenOutcome` (every unavailable posture collapses to one outcome), `PublicGoogleReviewDestination`, `PublicPortalResponseConfiguration` (submission evidence the guest browser projection omits)
- `PortalPublicApi.getResponsibleManagerUserIds` returns only current assignments that remain role/access/participation eligible at read/delivery time.
- Authority facades: `PortalContactRequestManagerAuthorityPublicApi` with `PortalContactRequestManagerAuthorityFacts`, and `PortalAiReplyBrandProfilePublicApi` for the one Property Brand field permitted in AI Reply Drafting.
- `PortalContactRequestManagerAuthorityPublicApi.getContactRequestManagerAuthorityFacts` returns only the exact Portal's Property ID, creator ID, and current eligible assigned-manager IDs. Guest combines these identifier-only facts with current Identity membership and Property access; Portal never reads contact material or grants contact permission.
- Types: `PortalGroupPublicApi` (exposes `findGroupForPortal`)
- Functions: `isValidExternalUrl` (https-only link-destination guard, used by the public redirect route)
- Event types: `PortalDeleted`, `PortalArchived`, `PortalRestored`, `PortalResponsibilityNeeded`, `PortalPublicationPublished`, `PortalPublicationRolledBack`, `PortalAccessArtifactPublished`, `PortalContentReviewCompleted`, `PortalApprovedDestinationRatioRecorded`, `PortalConfigurationCompletenessRecorded`, `PortalGroupDeleted`, `PortalEvent`
- Event constructors are deliberately not re-exported. Only Portal emits Portal events, so consumers receive decoding types and nothing that can produce one.

## Server functions

- **`portals.ts`** — CRUD, publication history/rollback, read, image-upload, and portal-token server functions for portals (create/update/list/get/delete portal, read/rollback publication, request/finalize upload, issue/rotate/revoke token).
- **`portal-links.ts`** — CRUD server functions for portal links and link categories.
- **`portal-groups.ts`** — CRUD server functions for portal groups and portal membership management.
- **`portal-responsible-managers.ts`** — scoped list/update endpoints for responsible-manager assignments and CAS conflict handling.
- **`portal-link-categories.ts`** — Server functions for portal link category CRUD operations.

## Permissions

- `portal.read` — View portals, portal links, and portal groups.
- `portal.admin` — Govern Property-wide Portal branding and approve or disable custom destinations. Granted to AccountAdmin by default; authorization follows effective permissions rather than a raw role comparison.
- `portal.update` — Update portal settings, links, link categories, and portal groups (including membership).
- `portal.create` — Create new portals and portal groups.
- `portal.delete` — Soft-delete portals and portal groups.

## Background jobs

- **process-image** — Reloads the scoped issuance, privately reads only its source, resource-bounds decode/re-encode, writes server-derived WebP variants, and atomically publishes only if the issuance is still current.
- **portal-upload-source-cleanup** — Runs hourly even while `portal.upload` is dark. It expires a bounded oldest-first batch, deletes only issuance-derived private sources and non-published derivative keys, and records separate durable cleanup markers. Object deletes are idempotent, so a crash between deletion and the marker safely converges on retry; finalized public variants are never selected as orphans.
- **portal-approved-destination-revalidation** — Revalidates a bounded batch every 15 minutes. Registration, schedule authority, and each discovered Property scope carry `portal.write`; a denied Property is skipped before network validation or mutation.

## Organization Export contribution (LIF-01)

`infrastructure/adapters/portal-organization-export.adapter.ts` implements
`identity/application/ports/organization-export-contributor.port.ts` and is
returned from `build.ts` as `organizationExportContributor` — deliberately
outside `publicApi`, because an export slice is lifecycle composition input,
not a Portal product capability.

It emits `portal/portals.csv` and `portal/portals.json` at classification
`tenant_visible`, deterministic for a fixed `(organizationId, asOf)` and
ordered by UTF-8 byte order. Covered tables: `portals`, `portal_groups`,
`portal_group_members`, `portal_link_categories`, `portal_links`,
`portal_approved_destinations`, `portal_localized_overrides`,
`property_portal_brand_profiles`, `property_portal_brand_contents`,
`portal_publication_snapshots`, `portal_publication_activations`,
`portal_pending_content_changes`, `portal_responsible_managers`,
`portal_access_artifacts` (metadata only) and `portal_health_intervals`. An
Organization with no Portal rows answers `no_data`.

Not exported, and not queried: `portal_tokens` (address-token hash and
encrypted raw token), `portal_upload_issuances` and their object keys
(`portal.upload` is safety-blocked, so Portal upload stays dark), and
`portal_access_artifacts.portal_token_id`, which is the join key into the
token secret. Goals are exported by the Goal contributor and Guest Responses
by the Guest contributor, so neither is duplicated here. Each reason is
recorded in the payload's `excludedRecordClasses`.

## Organization lifecycle contribution (LIF-01)

`infrastructure/adapters/portal-organization-lifecycle.adapter.ts` implements
`identity/application/ports/organization-lifecycle-contributor.port.ts` on top
of the shared receipt store
(`shared/db/lifecycle/organization-lifecycle-receipt-store.ts`), and is
returned from `build.ts` as `organizationLifecycleContributor` — deliberately
outside `publicApi`. It owns an irreversible purge phase, so keeping it off the
request-facing surface is what keeps that phase unreachable by default; it is
composed only through an explicitly reviewed lifecycle coordinator.

| Phase                  | What Portal does                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prepareClosing`       | Deactivates every current `portal_publication_activations` row (`deactivation_reason = 'disabled'`). Public resolution needs an undeactivated activation, so every Portal becomes unavailable. Nothing is deleted. |
| `verifyPurgeReadiness` | Read-only. Fails closed while any activation for the Organization is still current, so the irreversible boundary is never crossed in front of a live printed address.                                              |
| `purge`                | Idempotent row deletes over `PORTAL_PURGE_PLAN`, innermost dependency first.                                                                                                                                       |

Closing is a **stop, not a delete**, and it is reversible: the immutable
publication snapshot survives and `portals.publication_state` keeps the
tenant's own published/draft intent, so explicit reactivation re-points a new
activation at the same snapshot rather than guessing what each Portal used to
be. Ordinary closure cancellation does not itself reactivate Portals — see
`docs/operations/organization-lifecycle.md`.

`portal_group_members` is purged as a **row delete only**. It is a
physical-drop-blocked compatibility mirror: the rows are tenant content and
must go, the table must not. No phase issues a DROP or TRUNCATE.

Not touched by any phase: `portal_upload_issuances` beyond the purge plan
(`portal.upload` is safety-blocked, so there is no live effect to cancel and a
lifecycle write there would reach into a dark capability),
`portal_metric_lifetime_aggregates` (Metric's anonymous aggregate),
`properties`, and the Staff-owned people rows. Each is another owner's receipt.
