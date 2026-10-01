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
- Not exported, and not queried: `portal_tokens` (address-token hash and the sealed raw address) and `portal_access_artifacts.portal_token_id`, which is the join key into the token secret. `portal_address_downloads` is exported without the token id.
- Not touched by any phase: `portal_metric_lifetime_aggregates` (Metric's anonymous aggregate), `properties`, and the Staff-owned people rows. Each is another owner's receipt.

## Model

A Portal is Property-owned and may contain ordered secondary-link categories. A
Portal Publication Snapshot is the immutable, manager-approved rating-first
experience. Editing the working copy never mutates an active snapshot.
Activations are append-only effective-dated routes from a stable token to one
snapshot; publish and rollback append activations, while disable/archive close
one. Groups remain Property-scoped, and one Portal has at most one active group.

A Portal changes group in one commit: `movePortalToGroup` (and create-with-move,
where a new group takes Portals that are in another group) ends the old
`portal_group_memberships` row with `end_reason = 'moved_to_group'` and begins the
new one, so the results the Portal earned stay with the group it left. It takes the
fence of every group it touches in sorted id order, then locks the Portal, then
the membership; it records `portal_group.portal_removed` for the old group and
`portal_group.portal_added` for the new one, both by identifier. Every group
command also writes `portal_group_history` in its own transaction (created,
renamed with the previous name, archived, Portal added, removed, moved in or out,
each with the actor and the time); names live in that ledger, never on a fact.
`portal_groups.created_by` records who created a group (null before round 4).

The link section of the guest page is the **Linktree**. Its working model is
`portal_link_texts` (one label and optional line per link and language), a title
per language in `portal_localized_overrides.linktree_title` (null means the
language pack's default, "Useful links") and `portals.linktree_enabled`. Until the
legacy column is dropped, `portal_links.label` mirrors the primary-language text:
creating or renaming a link and saving the primary text all write both, and
readers (`listLinkTexts`) fall back to the link's own label for a link with no
primary-language row. Changing the Portal's primary language re-establishes the
mirror in the same transaction: a link label takes the new primary's text where
one exists, and the new primary's text starts from the label where none does.
Old code that runs between migration 0044 and the new web rollout can still
rename a link without touching its text; slice 19 reconciles that window before
the v3 writer reads texts. A Portal carries at most four links, counted under the
Portal fence on create; a Portal that already has more keeps them. Icons come
from a closed catalogue (`src/shared/domain/portal-link-icon.ts`, 27 keys, every
icon the round-4 editor offers), enforced by a CHECK and refused in the link
constructor.

The **Property look** is the part of the Property Brand Profile a guest sees:
accent colour, background (`background_mode` `auto` derives the dark page field
from the accent with `src/shared/domain/portal-field-colour.ts`, `manual` uses
`background_color`), wordmark and, in later releases, logo and photo, plus the
per-language hero alt text on the brand content. The profile keeps two versions
on purpose. `version` moves only with the public display name, because AI reply
drafts fence on it (`ai-reply-brand-profile-authority.ts`); `look_version` moves
with the look. A look edit writes one `property_brand_profile` pending change
per look facet (`look:accent`, `look:field`, `look:text`, `look:wordmark`,
`look:images`) for each Portal that has a snapshot, sourced at `look_version`;
a name edit writes the `all` row sourced at `version`. A save that changes
nothing only records who saved. `default_guest_locales` (ordered, one to six,
first is the primary) only seeds new Portals, so editing it bumps no version,
records no pending change, emits no fact and leaves `updated_by` alone (that
column decides whether the public display name counts as confirmed).

The editor no longer shows categories. `getPortalLinktree` reads the whole
section (switch, written titles, and each link in guest order with its texts,
icon and the approval of its destination), and a link is created without a
category: it joins the Portal's last category, and the first link starts one,
which only the legacy guest page prints as a heading. It is titled in the
Portal's primary language (the Linktree title written for that language, else its
default), so a Bulgarian-primary Portal does not show an English heading. The
category is built only after the link's label, icon, cap and destination have
passed and is committed in the link's own transaction (`startCategory` on the
create command), so a refused link leaves neither it nor its fact behind. Re-ordering still saves one category's order, so the
editor moves a tile only among those of its own (older) category. The category
commands stay until the snapshot builders flatten categories (slice 19).

The eligible creator is the initial Portal Responsible Manager. Multiple eligible
managers may be assigned; losing the last sets `responsibilityNeededSince`, and
nobody is auto-promoted. Only a live Portal of an active Property also raises
`portal.responsibility_became_needed`; a deleted or archived Portal, or one whose
Property is not active, records the gap silently. When the Property is restored,
the `portal.on-property-restored` worker consumer raises the fact for each of its
live Portals (not deleted, not archived) that still has no manager, because
Restore itself checks only the Property's manager (ADR 0052).

## Media

An uploaded image is a `portal_media_assets` row plus one WebP object in the
private store (`portal-media/<id>.webp`, the key derived from the id, never from
anything a manager typed). It is the **re-encoded** image: the upload is decoded
and encoded again, so metadata, colour profiles, trailing bytes and anything
hidden in a segment do not survive, and the original is never stored.

- **Policy** (`portal-image-policy.ts`, pure): JPEG, PNG and WebP, still, at most
  10 MiB, at most 40 million pixels, no side over 16,384, with a per-purpose
  minimum size, aspect limit, output size and output budget. The declared type
  must agree with the leading bytes. SVG, GIF, HEIC, AVIF and animated PNG or
  WebP are refused. Every refusal is `image_rejected` carrying one `reason`.
- **Decoder** (`sharp-image-processor.adapter.ts`): only the JPEG, PNG and WebP
  loaders are enabled in libvips; the decoder holds at most 40 million pixels
  and fails on any decode error; at most two decodes run at once.
- **Ingest** (`ingestPortalImage`): checks who (an Account Admin for a Property's
  photograph and logo, a Property Manager for a link tile's picture), the
  Property, the rights confirmation, the bytes, and a cap of 200 stored images per
  Property, then decodes and re-encodes, writes the object, then the row. A failed
  row removes the object again. The endpoint is gated on `portal.upload`.
- **Serving**: a guest's browser gets an image from
  `GET /api/public/portal-media/:assetId` on the app's own origin (`servePortalMedia`).
  The asset is found by its id alone (the id is the capability), served only while
  `active`, only while the execution policy allows `portal.public_read` for its
  Organization and Property (a denial is the same 404), and only if the bytes the store returns match the row's size and hash.
  A published page's image URLs are made when the page is read
  (`resolvePortalMediaUrls`), never stored in a snapshot.
- **Takedown** (`takeDownPortalMedia`, an Account Admin, gated on `portal.write`):
  the row becomes `taken_down` and is never served; its object is then removed and
  `object_deleted_at` recorded. The row stays, because snapshots name assets by id
  with no foreign key. A failed removal is retried by the sweep.
- **Sweep** (`sweepPortalMedia`, hourly, not capability-gated): finishes takedown
  removals, and deletes `active` assets older than a day that no Brand Profile,
  link or publication snapshot refers to (object, then row, in one transaction with
  the row locked). A snapshot's reference keeps an asset for as long as the
  snapshot exists.
- **Purge**: the Organization lifecycle contributor removes the objects of the
  Organization's assets before it deletes their rows.
- **References**: the Brand Profile's `logo_asset_id`, `hero_asset_id` (with
  `hero_focal_x/y`, present exactly when there is a hero) and a link's
  `image_asset_id` are composite foreign keys to an asset of the same
  Organization and Property. No command writes them yet; the manager controls
  (a later slice) will. The database does
  not tie a reference to the asset's **purpose**: whatever writes one of these
  columns must call `canReferencePortalMediaAsset(slot, asset)`, so a link
  picture cannot stand in as the hero and skip the hero's size and byte budget.

`portal.upload` is `controlled_beta`. The owner removed the SAFE-01 completion
ceremony on 2026-09-30; the technical safeguards above stay in the build (ADR
0063, ADR 0032, `docs/BETA.md` §8).

## Runtime

`build.ts` is the sole composition root. Server adapters call Portal use cases;
public token resolution returns only the current open, digest-verified snapshot.
Portal, Group, content, responsibility, and token commands use Portal-owned stores
that commit state, revisions, receipts, and identifier-only outbox facts together.

`listPortalOverview` is the batched read behind the Portals overview. For a Property
or for the Organization it returns one row per Portal (languages, Health and its
reason, pending-change count, current group, responsible-manager user ids, token
status, publication state) and asks each source once for the whole set: the
`*ForPortals` reads on the health, publication, group, responsible-manager and token
repositories. Each mirrors its single-Portal read (`portal-overview-reads.test.ts`
compares them), so each batched read returns what its single-Portal read returns,
including the token's grace end. It is scoped like
`listPortals` (`portal.read`, assigned Properties) and carries no content.

`getPortalLanguageCoverage` is the read behind the editor's Languages section. For each
language a Portal offers (the fallback language first) it counts the wording guests read
that is written and names what is missing: a title and a description and one label per
link. A title or description counts as written only when the Property has wording (a content
row) for that language, the Portal's own override then taking the place of it: publishing
drops a language without Property wording and refuses to publish, so an override alone does
not count, and such a gap is flagged `blocksPublish` (its wording is written by an account
admin in the Property Brand Profile; until the builder copies the fallback language into a gap, slice 19, it is a real block). A missing link label does not block publishing. Every
link in the tree is counted, approved destination or not, because its label is needed once the
destination is approved. The Linktree title, a link's line and the hero description are
optional, so they are never "missing". It carries
identifiers and kinds, plus the fallback-language label of a link with a gap so a manager can
tell which link it is, and nothing else; nothing is stored for it. Managers add only the
languages that are offered and have a generation 2 guest copy pack, and a language change
goes through the ordinary `updatePortal` command. The fallback language is never removed;
another one has to become the fallback first. There are no AI controls: the wording is
written by hand in the Welcome and Linktree sections.

"Download again" (ADR 0064) is optional and off until `PORTAL_ADDRESS_ENCRYPTION_KEYS`
is set. With a keyring, issue and replace seal the raw address
(`portal-address-cipher.ts`, AES-256-GCM, bound to organisation, property,
portal, token and version) beside the hash, and replace, stop and delete clear
it. `revealPortalAddress` is the only reader: it authorises `portal.update`,
records a `portal_address_downloads` row, then decrypts, and its server function
is a no-store POST behind an actor and Organization rate limit. The token status
carries `addressRecoverable` so the page offers the download only when the
keyring still holds the key that sealed the live code. Without a keyring the
address is shown once, when a code is made, as before.

`getPortalHistory` is the one merged, read-only timeline for a Portal: its
creation, each publish and restore, each change of health (from
`portal_health_intervals`) and each public-address event, newest first, with the
actor's display name where one was recorded. It merges five independently
ordered sources under one (instant, key) order and one opaque cursor, and it
resolves names through a bounded, Organization-fenced directory that returns
only `user.name`. Nothing is stored for it: it derives from the ledgers that
already exist. An address entry names who made it when `portal_tokens.issued_by`
recorded that (null for a code made before round 4), and each time a manager was
handed an existing address is a `code_downloaded` entry from
`portal_address_downloads`; page edits join the timeline with the page-edit
ledger.

The earlier issued-image implementation (presigned browser upload, issuance
table, background job) was removed and is not coming back. The nullable
`portals.hero_image_url` column and read path remain so published historical
rows still render, while the shared arbitrary-key storage stack remains live
for Identity avatar and organization-logo uploads through `container.assetStorage`.

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
9. The raw address is request-local and never enters state, facts, logs, exports or Metric, with one exception: the sealed copy of an active code (ADR 0064). Replacing, stopping or deleting clears it in the same statement, and a CHECK refuses a sealed address on any other code.
10. Portal lifecycle facts never copy Portal name, slug, description, theme, responsible-manager assignments, destination, or link content.
11. An image enters the Portal only through the server-side ingest, which stores a re-encoded WebP and never the upload; no Portal request issues a presigned upload or writes `portals.hero_image_url`, and a published Portal with a null value remains valid.
12. The POR-01 report never copies names, localized content, raw URLs, token material, themes, or print-batch values and never infers creator, ownership, translation, brand, or destination provenance. Reported ambiguous Portal rows remain Disabled or Archived; raw secondary links are treated as quarantined and excluded from publication until a separately reviewed command resolves them.
13. Closing is a **stop, not a delete**, and it is reversible: the immutable publication snapshot survives and `portals.publication_state` keeps the tenant's own published/draft intent, so explicit reactivation re-points a new activation at the same snapshot rather than guessing what each Portal used to be. Ordinary closure cancellation does not itself reactivate Portals — see `docs/operations/organization-lifecycle.md`.
14. `portal_group_members` is purged as a **row delete only**. It is a physical-drop-blocked compatibility mirror: the rows are tenant content and must go, the table must not. No phase issues a DROP or TRUNCATE.
15. Linktree edits (link texts, the section title, the switch) take the Portal fence like any content command and record `portal_links` pending changes under structured keys: `link:<id>:text:<locale>`, `linktree:title:<locale>` and `linktree:enabled`. Only a value that actually changed records one, and their facts carry identifiers, never the wording.
16. A group's history starts at the deploy of migration 0046; earlier changes are not reconstructed, because earlier names were never kept. History rows are never updated or deleted while their group exists, and a purge removes them with the group.

## Verification

Unit tests stay beside domain rules, publication, token, responsibility, and server
contracts. PostgreSQL integration tests cover command atomicity, revision fences,
public resolution, lifecycle contributors, and the POR-01 read-only reconciliation.
The build and architecture tests pin public surfaces, worker reachability, and the
read-only repository boundary.
