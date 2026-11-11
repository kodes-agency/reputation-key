# Portal — Context

**Audience:** Developers and agents working in `src/contexts/portal/`.

## Responsibility

Property-owned public review gateways. The private rating or direct Google Review
Action journey is primary; optional secondary links are a subordinate link tree.
The context also owns publication lifecycle, Portal Groups, responsible-manager
assignment, and governed access artifacts.

## Entry points

- `application/public-api.ts` exposes the named cross-context server capabilities
  and facts. `application/portal-management-contracts.ts` contains the browser-safe
  management types and pure rules used by screens.
- RPC calls stay in `server/`. The editor and Linktree screens, save coordinator
  and field writers live in `editor/ui/`; the Property and Portal look screens
  live in `look/ui/`. Other management screens remain in
  `src/components/features/portal/`. None imports the context build at runtime.
- `build.ts` composes request management separately from worker jobs. Portal and
  Guest retain separate builds.
- `infrastructure/adapters/portal-rights.adapter.ts` supplies Property and
  Organization reports and erasure, plus Organization export, to
  `scripts/ops/rights-request.ts` through `composition/rights-executors.ts`.
  Composition requires the image store. Images are deleted outside the database
  transaction before the rows in `PORTAL_PURGE_PLAN`; journal failure blocks both.
  Production apply remains refused. Restore-command replay is not yet wired;
  the integration test exercises the shared fence with a test-local replayer.

The editor's coordinator serializes debounced fields and immediate address,
icon, photo and look actions. New typing retires a superseded queued field save;
discrete language changes remain ordered commands. Navigation flushes edits made
during earlier writes. A rejected field save leaves its server baseline unknown
until a successful write, including when the person returns to the initial value.
`editor/contracts.ts` names the editor's browser-safe Reporting read projection.

## Boundaries

- Guest resolves public Portal data through `PortalPublicApi`; Goal reads group
  membership and a group's name through `PortalGroupPublicApi`. Portal does not
  read their stores.
- Reporting's Monthly portal goal reads `listGoalReadinessFacts(org, property, asOf)`
  on `PortalPublicApi` (`application/goal-readiness-facts.ts`): every non-archived,
  non-deleted Portal of the Property in name order, including the complete roster
  (`truncated` is always false), each with its publication state, `liveSince`, the live
  intervals that overlap the last 60 days, when its current code was made, whether
  that code's QR or NFC marker is published (`codeReady`, the scan-goal rule) and
  its group. Names, states, identifiers and instants only. It checks no permission:
  Reporting's use case authorizes `goal.create` under `goal.use` before it calls it.
- Retained `entityType`/`entityId` values may reference historical Team or Staff rows for reconciliation. They never change Property ownership, authorization, grouping, or notification responsibility.
- AI Reply Brand Authority is content-minimal. Generation may read only the exact display name, profile version, and derived display-name digest; transaction-bound callers receive only a boolean exact-current answer. Image URLs, colors, localized content, Portal overrides, links, Guest ratings, and Private Feedback are never exposed through it.
- Responsible-manager assignment never grants property access, portal access, or staff attribution.
- Portal, Group, Link, Token, and Health repositories are read-only production ports. Authoritative mutations are available only through Portal command stores and Health reconciliation; direct PostgreSQL seeding/mutation lives under explicit test scaffolding and is guarded from production wiring by an architecture test.
- Export and purge run through the manual rights request command
  (`docs/operations/rights-requests.md`); neither is on `publicApi`.
- Not exported, and not queried: `portal_tokens` (the address-token hash, the sealed raw address and the print code hashes) and `portal_access_artifacts.portal_token_id`, which is the join key into the token secret. `portal_address_downloads` is exported without the token id. An exported artifact's `status` is the state of its code at the export snapshot (`published` while the code resolves, `retiring` through a rotation's grace window, `retired` after it, `revoked` when it was stopped), read from `portal_tokens` without exposing the join key. The stored column stays `published`: the scan path reads it, and moving it with the code would end scan counting inside a grace window. In the CSV summary `portal_id` names the Portal a record belongs to (its own id on a Portal row) and is empty for a group, an approved destination, a media asset and the Property's look and wording. A Portal's own look row (`portalLookOverrides`, ADR 0070) names its Portal in `portal_id`; its columns are listed one by one and the photo's descriptions are written as text.
- Not touched by any phase: `properties`, and the Staff-owned people rows. Each is another owner's receipt.

## Model

A Portal is Property-owned and may contain ordered secondary-link categories. A
Portal Publication Snapshot is the immutable, manager-approved guest
experience. Editing the working copy never mutates an active snapshot.
Publishing writes schema version 3 (the Immersive Hub) only, from a publication
source that `resolvePortalPublication` turns into the snapshot's content: the
one function that decides what a gap means (a primary-language gap blocks, any
other language is copied from the primary and tagged `fallbackFrom`, the
Linktree title falls back to its pack default and is never copied), shared by
the builder, the publish transaction's comparison and the history read. Version
1 and 2 snapshots remain verifiable, view-only history evidence. They are not
served publicly and rollback refuses them with `not_restorable`.
Activations are append-only effective-dated routes from a stable token to one
snapshot; publish, republish and rollback append activations, while disable/archive
close one. Groups remain Property-scoped, and one Portal has at most one active group.

A **live run** is an unbroken stretch of being live (`domain/portal-live-run.ts`).
Publishing starts one; a republish or a rollback closes the live activation as
`replaced` and opens the next, so the run goes on; a disable or an archive (and an
Organization closing, which closes as `disabled`) ends it, and the next publication
starts a new one. `liveRunStart` is when the current run began (null when the Portal
is not live): the day it "went live", however often it was republished since.
`liveIntervals` lists the runs that overlap a window, clipped to it; a run closed at
its own start (an Organization closing can write one) gives none. The rule needs
only the activations that bound each run (its first, the one that closed it and the
open one), so `listActivationsForPortals` reads only those, over the Portal's whole
history, about two rows a run, in one statement for many Portals on
`portal_publication_activations_portal_sequence_unique`. A `published` state is not
live by itself (an Organization closing keeps it): readers decide from `liveSince`.

Archive is the Portal's removal, so it asks `portal.delete` (an AccountAdmin), the
permission the Portals pages offer Archive on and the one a group's archive asks.
The archive intent asks for it itself, and the archive server function asks the policy
for `portal.delete` too, so the rule holds whichever caller carries it. Disable and Restore
are updates (`portal.update`): a PropertyManager can take a live page down and bring an
archived Portal back to Disabled. A Portal's state changes only through the intents in
`publication/portal-intents.server.ts` (publish, disable, archive, restore, settings,
address, languages), each of which commits through `commitPortalChange`; none accepts
another intent's fields.

The first go-live server function requires the digest from Review & publish and
refuses a changed draft with the same refusal as publishing changes to a live Portal.
Staff provisioning in `composition/identity-wiring.ts` deliberately calls the internal
publish intent without a digest to publish the personal Portal it just created.

Link, link-text and Linktree-setting commands recheck content mutability in
`infrastructure/portal-aggregate-fence.ts`, using the state returned by the
revision update while it holds the Portal row lock. An archived write rolls back
before content, history or facts change. Address issue, rotation and revocation
use the revision fence without the content restriction, preserving address
management on archived Portals.

Rating-collector changes recheck Reporting's transaction-bound goal read while
holding the shared Property goal fence, before publication, Portal, or Group
row locks. Skipping private ratings, disabling, archiving, or deleting cannot
remove a direct rating-goal subject or the last published collector in a wider
goal. Commit refusals use `goal_needs_collector`; staff scan-switch protection
retains its own guard. Group membership and create-with-group commands acquire
the same Property fence first.

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

A group has a page in the admin (`portals/groups/$groupId`): its results (the group's
own row of the Portals results read), its Portals, the live goal card and this ledger,
read through `listPortalGroupHistory` and named in the browser. The New group dialog,
Add portals (one `movePortalToGroup` per Portal) and Rename write through the same
commands; the group's head in the Portals overview links to the page. A group with no
Portal keeps its head in the overview, so it stays reachable.

The link section of the guest page is the **Linktree**. Its working model is
`portal_link_texts` (one label and optional line per link and language), a title
per language in `portal_localized_overrides.linktree_title` (null means the
language pack's default, "Useful links") and `portals.linktree_enabled`. The texts are
the only place a link's wording is written: creating a link writes its
primary-language text, renaming it (or saving texts) writes the text, and the
legacy `portal_links.label` column is never written (a new link holds `''` there,
because the column is NOT NULL until it is dropped). The column is a read-only
fallback for a link written before the texts existed: `resolveLinkTexts` reads it
as the primary-language text only when no such text row exists, and a stored text
always wins over it. Changing the Portal's primary language leaves no link
unnamed in the new one: the old primary keeps the link's wording (a link with no
text there starts it from its legacy label, when that is not empty) and the new
primary's text starts from it where none exists. Migration 0052 is what lets a
stored text always win: a link renamed in the window between migration 0044 and
the text-aware editor could have a label newer than its primary text, which every
reader then showed, so the migration copies that label into the text (once, with a
History row and no person) before the reader rule goes. Deploy order: the
migration runs before this release serves, and the detection query in
`docs/operations/operator-commands.md` (`link-labels-newer-than-primary-text`)
returns no rows afterwards. Rolling back to a release before this one is not safe
for links edited since: that code treated a link label newer than its text as a
rename, so it would read the empty column as the wording. A Portal carries at most four links, counted under the
Portal fence on create; a Portal that already has more keeps them. Icons come
from a closed catalogue (`src/shared/domain/portal-link-icon.ts`, 27 keys, every
icon the round-4 editor offers), enforced by a CHECK and refused in the link
constructor.

A tile opens a website, a phone number or an email address (ADR 0044, amendment
2026-10-26). A phone number or an email address is a Property destination with
`source_type` `contact` (migration 0073), stored as `tel:+15551234567` or
`mailto:front@hotel.com` and named in `hostname` by the number or address without
its scheme (`validatePortalLinkDestination`, `src/shared/domain/portal-contact-address.ts`).
It is approved as a manager enters it, is never checked over the network (the
re-check query leaves it out, `recordNetworkValidation` never quarantines one, and
`listApprovedUris` serves it whatever its `last_validated_at`), is not one of the
"Sites allowed for links" (`listPortalApprovedDestinations` leaves it out) and
cannot be turned off (`disablePortalApprovedDestination` refuses). `request` holds
the `contact` source to a stored `tel:`/`mailto:` address both ways, and approves
again a contact row a network check quarantined, which only a server from before
contacts would do. A contact tile with no icon of its own gets `phone` or `mail`,
and swaps it when its address moves to another kind. The click route, the guest page and the v3 snapshot verifier
take a `tel:` or `mailto:` address only in exactly that stored form.

**Property look and a Portal's own look.** The **Property look** is the part of the
Property Brand Profile a guest sees: accent colour, background (`background_mode`
`auto` derives the dark page field from the accent with
`src/shared/domain/portal-field-colour.ts`, `manual` uses `background_color`),
wordmark, logo and photo (uploaded assets, see Media), plus the per-language hero alt
text on the brand content. It is the look every Portal starts with: a Portal follows
it until an Account Admin gives that Portal its own version of one of three groups
(below, ADR 0070). The profile keeps two versions on purpose. `version` moves only
with the public display name, because AI reply drafts fence on it
(`ai-reply-brand-profile-authority.ts`); `look_version` moves with the look. A look
edit writes one `property_brand_profile` pending change per look facet (`look:accent`,
`look:field`, `look:text`, `look:wordmark`, `look:logo`, `look:photo`; a row written
before the photo and logo were split reads `look:images` as both) for each Portal that
has a snapshot and follows a group the facet belongs to, sourced at `look_version`; a
name edit writes the `all` row sourced at `version`, for every Portal with a snapshot.
A save that changes nothing only records who saved. `default_guest_locales` (ordered,
one to six, first is the primary) only seeds new Portals, so editing it bumps no
version, records no pending change, emits no fact and leaves `updated_by` alone (that
column decides whether the public display name counts as confirmed).

The Property look is edited on one page, `/properties/:propertyId/portals/look` (board
9 of the round-4 admin), by an Account Admin; everyone who may read portals can open
it. `savePropertyLook` writes the accent, the background mode (and the colour when it
is manual) and the wordmark through the repository's own look writer, which reads and
writes the profile inside the Property's publication lock and touches only those
columns and the look version: the display name, the images, the text colour and
`updated_by` stay as they are, so a look save never confirms an automatic public
display name, and a name or image write beside it is never put back (the actor is
recorded in the page-edit ledger only). It refuses a colour that is not `#rrggbb` and
a manual background light text cannot be read on (AAA on the field). It does not
refuse an accent that is hard to see on its field, because the default palette every
Property starts with is one and the guest resolver draws the text colour in its place;
the page's readout says so (`src/shared/domain/portal-look-readout.ts`, built on the
same arithmetic the guest resolver uses). A Property with no Brand Profile is asked to
set its public display name first. The page autosaves, so an edit is a draft until each
live Portal that follows it is published again. The page describes itself as the look
every Portal at the Property starts with. Its "Portals using this look" rail shows, for
each Portal, text chips for the groups it owns ("Own photo", "Own colours", "Own name
and logo"), groups the Portals that own all three under "With their own look", links
each to its Look section, and counts only followers in its status line; the phone
preview defaults to a Portal that follows the look and lays the draft only over the
groups that Portal follows. In the batch review a Portal that owns the edited group is
"Already up to date", and a Portal with its own look draft starts unticked as "also
publishes N other draft edits".

A **Portal's own look** (ADR 0070) is a sparse override of three groups, and each group
follows the Property or is the Portal's own independently of the others: the **photo** (the hero, its
focal point and a description per language; `inherit`, `own` or `none`, "No photo on
this portal"), the **colours** (the accent and the background together, because contrast
is judged on the pair; `inherit` or `own`) and the **name and logo** (the wordmark and
the logo; `inherit` or `own`). So a Portal with its own photo keeps following the
Property's colours and logo, and a later Property edit to those still reaches it. The
public display name, the default languages, the Property's wording and the text colour
are never a Portal's: AI reply drafts keep fencing on `display_name` and `version`
only, and a light page or other fonts would need a v4 snapshot. The override is one
row of `portal_look_overrides` (migration 0074) per Portal, made by the first save of
an own group and removed by nothing but an Organization purge; no row means the Portal
follows everything and resolves to exactly the content, digest and look version it had
before, and nothing was backfilled. Switching a group to `own` copies the Property's
current values, so nothing visible moves; switching it back to `inherit` nulls the
group's columns, so no dormant image reference remains. The own photo's descriptions
are jsonb on the same row, so a description always travels with its photo, and the
Property's description of a different photo is never used; the keys are filtered with
`isGuestLocale` on read and a blank value is refused on write. Composite RESTRICT
foreign keys tie the row to its Portal and to its two assets within one Property.

The override is resolved only where a working copy is read, never when a guest opens a
page (`domain/portal-look.ts`). `applyPortalLook` lays a Portal's own groups over the
Brand Profile and `withPortalHeroAlt` over the Property's content rows, and both run
before the asset ids are collected, so the Portal's own hero and logo pass the same
check as the Property's (active, of this Property, and of the slot's purpose,
`brand_hero` or `brand_logo`): a taken-down own photo resolves to **no photo**, never to
the Property's. With no Brand Profile the default look is used and any row is ignored
(writers refuse with `brand_profile_missing`, so a row cannot exist without a profile).
The working-copy reader (publish, the in-transaction re-check, Review, History's
pending test, the completeness fact and the print kit's legacy path) and the draft
preview both use it, and the preview's `brandOf` shares `fieldColourOf`, which is
`brandProfileOf`'s expression extracted unchanged; a parity test holds the two on
content (brand and `heroAlt`) with an explicit allow-list of the differences that
already existed. The result is written into the unchanged v3 snapshot
(`configuration.brandProfile`, `localizedContent[].heroAlt`; no v4), so the guest page,
`og:image`, the print kit and the verifier read only the snapshot and need no change.
Which groups a Portal owns (`lookSources`) comes back beside the working copy
(`loadWorkingCopyWithLook`) and is not a field of the publication source, so it never
reaches a snapshot or a digest. A Portal's effective `lookVersion` is its override's
`look_version` when it has a row and the Property's otherwise. A first row starts at the
Property's version when the save moved nothing visible (a prefilled "Set colours for
this portal") and one above it when it did; after that the row moves by one on every
Portal save that changes what the Portal shows, and by one on every Property save that
changes a group the row follows (once per save, under the Property lock). It is only
ever compared for equality.

A Portal's look is saved by `savePortalLookColours`, `savePortalLookIdentity` and
`savePortalLookPhoto`. Each use case loads the Portal under `portal.update`, refuses an
archived one (`portal_inactive`), requires `PORTAL_LOOK_EDIT_PERMISSION` (`portal.admin`,
one constant, so letting a Property Manager edit it later is a local change), checks
Property access and that the Portal belongs to the Property in the request. Each server
function also asks for the `portal.write` capability. The writer takes the Property's
publication lock, then the Portal row `FOR UPDATE` (publish's order), diffs the
**effective** look before and after, and only when something guests see moved raises
the version and writes, per changed facet, one `portal_configuration` ledger row and
fence (`look:accent`, `look:field`, `look:wordmark`, `look:logo`, `look:photo`, source
version `look:v<n>`); a save that moves nothing stores the modes and values and
records nothing. It checks colours on the merged pair (`#rrggbb`, a readable pair, AAA
text on a manual field), the photo and the logo against `findReferencableMediaAsset`
for this Property, the wordmark (24 characters) and each description (160 characters,
for a language the Portal offers; blank means decorative). No outbox event is emitted.
The Property's writers narrow with it: `recordPropertyProfileChange` (in
`infrastructure/property-look-fanout.ts`) opens the fence only on Portals that follow a
changed group and, under the lock it already holds, raises the version of the override
rows that follow it, once per save; `saveHeroAltText` fences only photo followers and
writes its ledger key as `photo_alt:<locale>`. With no override rows the fence set is
what it always was.

The portal editor's Look section (`?section=look`) shows the Property look read-only
and links to the Property look page. Its own-look controls show only when the flag is
on, the viewer is an Account Admin with `portal.write`, the Portal is not archived and
the Property has two or more non-archived Portals (or the Portal already has an
override, so it can still be undone). Then it shows three blocks (Photo, Colours, Name
and logo), each "Follows the property look" or the Portal's own, with "Use the
property's …" to go back, and the photo block also offers "No photo on this portal". It
autosaves with the workspace's draft saving, and the phone preview refreshes when a
save lands. A Property Manager sees the same facts and who can change them, never a
disabled control. The Property look page (above) and this section are the only places a
look is edited. The name and logo block states the business name as a fact (set in Settings).

A new Portal (`createPortal`, the New portal dialog) commits in one transaction
with its group membership (the group is fenced like a membership change and the
`portal_group.portal_added` fact is recorded), its responsible managers and, when
it starts from another Portal, a copy of that Portal's settings, wording per
language, Linktree title, approved links with their categories and link texts, and its own look.
It starts from the Property's own wording by default. Languages default to the
Property's, or to those of the Portal being copied; only languages with a reviewed
pack may be chosen. A copy never takes codes and their artifacts, publication
snapshots or activations, responsible managers, health or history, and leaves
behind the legacy hero image columns (a hero image is a server-owned upload
derivative that v3 ignores) and every link
whose destination is not approved now (disabled, quarantined or pending
approval, or a legacy URL with no destination), which take no slot of the
four-link limit. A copy takes the source's own look (owner decision D5, ADR 0070): its
override row is inserted in the same commit as the new Portal (also when a Property
Manager creates the Portal, and also when the source has no links), with the same
Property asset references, descriptions kept only for the new Portal's languages and
`look_version` one above the Property's. No fence is needed, because a new Portal has no
snapshot. The reader and publication apply every saved override, so a copy
shows what its source shows. A
source asset swept or taken down between the read and the commit makes the
create a normal refusal. The dialog's one fact line reads "Look: same as {source}" or
"Look: the property look". An archived Portal cannot be a starting point
(`portal_inactive`, HTTP 410). A name whose derived address is taken at the
Property gets the next free numbered address; a name that gives no address (no
Latin letters or digits, as in Cyrillic) is addressed from the start of the new
Portal's own id (`portal-<first 8 hex>`, a longer slice if that is held), so it
never walks a counter; an address the manager typed must be free. There are no
place types: the dialog asks for a name, a group, languages and what to start
from.

The editor hides category headings, but categories still determine link behaviour.
`getPortalLinktree` reads the section's switch, titles and links in guest order
with their texts, icons and destination approvals. `LinktreeSection` renders
`LinkTree`, whose `planLinkMove` permits moves only within a category;
`useLinktreeMutations` calls `server/portal-links.ts`'s `reorderLinks`, which
authorizes both the Portal and category before the command saves that category's
order. The browser contract retains `categoryId` through the
`application/public-api.ts` type exports.

Creating a link without a category joins the Portal's last category or starts
one with a neutral title. `create-link.ts` builds it only after the label, icon,
cap and destination pass, then commits it with the link (`startCategory`) and
the category-created fact imported through `domain/events.ts`. A refused link
leaves neither the category nor its fact behind.

Publication also depends on categories: `readPortalWorkingCopy` in
`infrastructure/portal-working-copy.reader.ts`, used by the publication repository
and commands, orders by category sort key, category id, link sort key and link id.
`resolvePortalPublication` preserves that sequence in the flat guest Linktree.
Keep category rows, references, events and sort keys while these editor and
publication paths use them; removing headings did not remove their ordering role.

The eligible creator is the initial Portal Responsible Manager (by default; the
dialog may name other eligible managers, or nobody). Multiple eligible
managers may be assigned; losing the last sets `responsibilityNeededSince`, and
nobody is auto-promoted. Only a live Portal of an active Property also raises
`portal.responsibility_became_needed`; a deleted or archived Portal, or one whose
Property is not active, records the gap silently. When the Property is restored,
the `portal.on-property-restored` worker consumer raises the fact for each of its
live Portals (not deleted, not archived) that still has no manager, because
Restore itself checks only the Property's manager (ADR 0052).

Removing a member releases their Portal responsibilities twice. The removal
itself releases them before the membership is deleted, in a commit of its own,
and until that delete the member is still an eligible manager, so an assignment
another admin saves in between is accepted. The `portal.on-member-removed`
worker consumer therefore releases again from `identity.member.removed`, the
fact every removal path records with the membership delete: every assignment
the member is no longer eligible for, with the gap recorded and announced as
for any release. Eligibility is asked at delivery, so a member invited again in
the meantime keeps what they may hold.

A save of a Portal's managers reads eligibility twice: before its write, and
again once the write has committed. The first read is not under the write's
lock, so a removal, role change or lost access that commits in between is seen
by neither that read nor a release that ran before the assignment existed.
Whichever of the two commits second is therefore followed by a check that sees
the other: the save's second read, or the release from the fact (after a
removal) or the reconciliation (after a role or access change). A manager the
second read finds no longer eligible is released with reason
`manager_became_ineligible`, the gap is recorded and announced with no actor
left out, and the save answers `responsible_manager_ineligible`; the rest of the
selection stays saved. Creating a Portal names its first managers from one read
before its write and makes no second one: a manager removed in that instant is
released by `portal.on-member-removed` unless the fact was consumed before the
create committed.

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
  photograph and logo, which is also how a Portal's own photograph and logo get
  uploaded, a Property Manager for a link tile's picture), the
  Property, the rights confirmation, the bytes, and a cap of 200 stored images per
  Property (a Portal's own photos and logos count toward it), then decodes and re-encodes, writes the object, then the row. A failed
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
  Portal look override, link or publication snapshot refers to (object, then row, in
  one transaction with the row locked). A snapshot's reference keeps an asset for as
  long as the snapshot exists.
- **Purge**: the rights request command removes the objects of the
  Organization's assets before it deletes their rows. `portal_look_overrides` is
  scrubbed ahead of the rows it points at (after `portal_localized_overrides`, before
  the brand contents, profiles, media assets and Portals), because its RESTRICT foreign
  keys name a Portal and an asset.
- **References**: the Brand Profile's `logo_asset_id`, `hero_asset_id` (with
  `hero_focal_x/y`, present exactly when there is a hero), a Portal look override's
  `hero_asset_id` and `logo_asset_id` (ADR 0070) and a link's
  `image_asset_id` are composite foreign keys to an asset of the same
  Organization and Property. `updateLink` takes an `imageAssetId` (or null) and
  checks it with `canReferencePortalMediaAsset('link_image', asset)` against the
  Portal's own Property; `savePropertyHero` and `savePropertyLogo` do the same
  for `brand_hero` and `brand_logo` (an Account Admin, `portal.write`, the
  Property's own asset; any other id is `media_not_found`), and so do
  `savePortalLookPhoto` and `savePortalLookIdentity` for a Portal's own photograph
  and logo, against the Portal's own Property (`findReferencableMediaAsset`). The database does
  not tie a reference to the asset's **purpose**: whatever writes one of these
  columns must call `canReferencePortalMediaAsset(slot, asset)`, so a link
  picture cannot stand in as the hero and skip the hero's size and byte budget.
- **The look's photograph and logo** (Property look page, boards 9 and 14).
  `savePropertyHero` puts an uploaded photograph on the Brand Profile, moves its
  focal point (0 to 1 across and down, the middle when none is given; the
  browser's circle is dragged or moved with the arrow keys and autosaves) and
  takes it off with `assetId: null`, which clears the focal point with it.
  Its descriptions are per language (`property_portal_brand_contents.hero_alt_text`,
  at most 160 characters, a language left out keeps its own, null clears one). A
  language with no wording row gets one holding the description alone: its title
  and description are `''`. Every reader (publication, the preview, the language
  coverage) asks `hasPropertyWording` (domain/property-wording.ts), which is
  false for such a row, so it claims no wording and a Portal override on that
  language still does not count until the Property writes some; the row exists
  only because the description lives in it. The settings editor then shows the
  fallback placeholder rather than an empty one. A page reads the primary
  language's description for every language that has none of its own. The write
  runs inside the Property's publication lock and moves what every look edit
  moves: `look_version`, a `look:photo` pending change for each live Portal that
  follows the photo and the profile fact (a description is a
  `property_brand_content` change for its language, ledger key `photo_alt:<locale>`,
  fenced on the Portals that follow the photo); the display name and `updated_by` are
  not touched. `savePropertyLogo` is the same for `logo_asset_id`, with `look:logo`. Both answer with the media as
  a page draws it (`resolvePropertyLookMedia`: size, focal point and the media
  route's address, for an asset of this Property that may still be served; a
  taken-down image reads as none), which the experience read carries as `media`.
  The draft preview draws only those assets, so a photograph that is only an
  address on the profile or in an override (which a v3 publication drops) is not
  previewed; a tile's uploaded photo and the live version's photograph and logo
  are drawn too. The browser checks a chosen file against the same size rules as
  the policy (`PORTAL_MEDIA_SIZE_RULES` in `src/shared/domain/portal-media.ts`)
  before sending it. A hero photograph also gets one piece of advice, never a
  stop: "May look soft in print" when it is under `PRINT_PHOTO_MIN_WIDTH_PX`
  (1000 px) wide, the width at which every Large card band prints at 200 dpi or
  better (the size rule alone lets a 500 x 1000 portrait in, which prints at
  about 118 dpi). Only raster logos are accepted: no SVG.
- **A Portal's own photograph and logo** (ADR 0070, the portal editor's Look section).
  The upload is the same one (`POST /api/portal-media`, purpose `hero` or `logo`, an
  Account Admin); `savePortalLookPhoto` then puts the asset on the Portal's override
  with its focal point (autosaved) and one description per language the _Portal_
  offers, shown as "Shown at the top of {portal} only". A new photo starts centred with
  no descriptions; the same photo keeps its focal point and descriptions. "Remove"
  leaves the Portal with no photo (`none`); "Use the property's photo" puts the group
  back to `inherit` and drops the own asset reference. A description is optional and an
  empty one means decorative. An own photo that is taken down reads as no photo on
  that Portal (it never falls back to the Property's), and the editor says "This
  portal's photo was taken down. Choose another or use the property's photo." The
  draft preview draws it through the same `resolvePropertyLookMedia`, given the
  Portal's own ids. Takedown itself is unchanged: Property-level, an Account Admin
  (runbooks §27 lists the Portals an image is the own photo or logo of).
- **A tile's photo** is chosen in the Linktree editor's "Icon or photo" picker: the
  dashed tile uploads to `POST /api/portal-media` (`purpose=link_image`, with the
  Portal and the rights confirmation) and then puts the returned asset id on the
  link with `updateLink`. A tile wears an icon or a photo, never both: choosing an
  icon saves `imageAssetId: null` in the same write, and the picker keeps the
  replaced photo on offer for the session (`updateLink` re-checks the asset, which
  stays active through the 24-hour GC grace), so a slip of an arrow key is not the
  end of it. The editor shows the photo from the same-origin media route, and
  `getPortalLinktree` hands it only a photo that is still servable: a taken-down
  asset leaves `portal_links.image_asset_id` in place but reads as no photo.
  A photo reaches guests only through a v3 publication (the working-copy reader
  carries `links[].imageAssetId` into the snapshot and leaves out an id that is
  no longer servable, as the guest page's `mediaUrls` filter does); v1 and v2
  snapshots have no tile photos.

`portal.upload` is `controlled_beta`. The owner removed the SAFE-01 completion
ceremony on 2026-09-30; the technical safeguards above stay in the build (ADR
0063, ADR 0032, `docs/obligations.md` §8).

## Print kit

The Share tab reads `getPortalPrintKit` and downloads through
`createPortalPrintFinal`. The read always carries the current kit, last-print
settings and saved wording, with no address. The browser preview stays instant;
the PDF and preview use the same measures and planners, checked with real fonts.

- Counter cards, tents and Small cards stay available upright or wide, in Paper
  and Immersive. Office sheets, quantities and spare pieces, print-shop files,
  crop marks and card backs keep their existing choices and refusals.
- Print languages, wording and look come from the live publication. Draft-only
  languages and Portals without a live version cannot print. The Property country
  sets the default paper; an explicit paper choice wins.
- The shared planner checks every ink and code box against all four live-area
  edges, including unbreakable words at the smallest headline. Preview and PDF
  keep the same refusal, including the optional back when selected. Rendered PDFs
  are independently rasterized and QR-decoded to the issued address in tests.
  Offer checks visit every occurrence; personal Portal
  wording and wordmarks keep staff names private, including a live print's look.
- Wording saves have their own actor and Organization write budgets. They never
  spend the address-download budgets; authorization still precedes either limit,
  and print files remain uncacheable even on refusal.
- `printing/print-download.server.ts` reads stored pictures within their recorded
  size and verifies their hash before the audited address reveal. Missing or
  changed bytes refuse the print without a disclosure. Taken-down media is omitted.
  `printing/contracts.ts` holds the file and download contracts; consumers import
  them directly rather than through the management contract entry.
- Verified QR and NFC print codes are always shown. Missing or mismatched hashes
  fall back to the issued long address and its original channel marker. Direct
  links retain the long address with no marker; every issued URL keeps resolving.
  `PORTAL_PRINT_ORIGIN` names the print host, which must remain attached for as
  long as printed material uses it. Codes and addresses never enter logs or facts.
- **Print code.** The 20-character Crockford credential a printed QR or an NFC
  tag carries instead of the long address (ADR 0069): 100 bits, one per access
  artifact channel (qr, nfc), derived from the code's long address and that
  artifact's id, and stored only as a keyed hash on `portal_tokens`
  (`qr_print_code_hash`, `nfc_print_code_hash`). It opens the public guest page
  and lets a visit be counted; it is a credential, never logged, evented or
  exported (invariant 9).
- **Print host.** The short host a print code is scanned on:
  `https://ap.up.railway.app`, named by `PORTAL_PRINT_ORIGIN` (optional; origin
  only, host at most 25 characters, https in production). A request middleware
  (`src/shared/security/print-host-middleware.ts`, global in `src/start.ts`, right
  after Sentry) answers there: `GET` and `HEAD` for `/p/*` are a 302 to the same
  path and query on the app origin (`BETTER_AUTH_URL`), and any other path or
  method is a 404 with no body. The guest page is not served there, because the
  guest `Origin` check is an exact match against the app origin, and a manager
  cannot sign in there either. Every other host is untouched, and so is every
  host where the variable is unset or names the app's own host. It must stay
  attached to the web service and keep its name for the life of the prints.
- `choosePrintFinalTile` enforces the existing module floor and refuses a dense
  address with the same Share-tab wording. The renderer checks real-font fit;
  unsupported wording and offers for a review retain their existing refusals.
- Successful downloads remember settings and safe wording; neither memory stores
  the code or address. The server makes the response uncacheable before a refusal,
  checks tenant scope and permissions, and spends the address rate limit.
- The PDF renderer loads lazily so processes that never print need not load fonts.
  Fonts, image readers, QR helpers and shared layout helpers remain shared with
  the preview. `portal-print-kit-how-to.ts` remains with its Immersive office and
  print-shop instructions.

There are no print-kit, print-code or own-look rollout switches. Own looks keep
all current options and authorization rules. Surviving server functions keep their
existing file paths and names.

## Runtime

`build.ts` is the sole composition root. Server adapters call Portal use cases;
public token resolution returns only the current open, digest-verified snapshot.
The codec's `digest()` answers for both address shapes, tagged by `kind`: a long
address by its three hash columns, a print code (in any case, `O` as 0, `I` and `L`
as 1) by its keyed hash. `resolveActiveByTokenDigest` is one statement for both: only
the address equalities differ, `(qr_print_code_hash = $h OR nfc_print_code_hash =
$h)` for a print code, under the same active-or-grace rule (the page opens through
the instant grace ends). The scan lookup (`resolvePublishedAccessArtifact`) reuses its
statement the same way: a print code names its artifact through the column that
matched, so its channel needs no marker, and a marker it claims must be that
artifact's, or the visit stays `direct`; a long address with no marker returns null
before any query, and the guest classifier refuses it before that
(`access_artifact_missing`). A counted scan needs the code strictly inside grace.
`isPrintCode` (shape only) is how the guest knows a marker is implied, and the page
read result carries `addressShape` (`long` or `short`, never the address) for the
guest request log.
Portal, Group, content, responsibility, and token commands use Portal-owned stores
that commit state, revisions, receipts, and identifier-only outbox facts together.

A server function that is addressed by a Portal, group, category or link resolves it to
its Organization and Property (`portal-scope.repository.ts`) before it asks the policy,
because the Property the policy decides on comes from that row: one lookup, or two where
a request names a pair that must match (a Portal and its category, a group and a
Portal). A request that names many rows does not read them all first.
`publishPortalsChanges` (at most 50 Portals) resolves them one at a time and asks the
policy on each one it finds, so a refusal ends it; `reorderLinks` asks the policy on the
Portal and the category, and reads the links it names (at most 100) only once the policy
has admitted the caller, answering `link_not_found` for one that sits elsewhere or names
no row. The request schemas take those ids as any
non-empty string, so the lookup answers "no such row" for one that is not a UUID, and
the caller gets the same 404 as for an unknown id; PostgreSQL is never asked to compare
it with a `uuid` column. Residual gap: any other id is not checked that way. That is a
`propertyId` (the functions addressed by a Property, such as `listPortals`,
`createPortal`, the group list and create and the Property look functions, do no scope
lookup and ask the policy on the id they were given), a destination id, or the
`portalIds` of a group to join. A malformed one from a caller the policy admits still
fails as a database error and a sanitized 500.

`publicApi.management` is Portal's request surface (`docs/standards.md` §3.1).
Its scope reads are the exceptions to that section's rules:

- Five members are reads of `portal-scope.repository.ts` published as they are, not
  application functions: `resolvePortalManagementScope`,
  `resolvePortalGroupManagementScope`, `resolvePortalCategoryManagementScope`,
  `resolvePortalLinkManagementScope` and `listPortalManagementPropertyIds`. They take no
  caller and decide nothing. The four `resolve…` reads answer for an id of any
  Organization, which is why `server/property-scope.ts` compares the Organization
  before it asks the policy; the list is scoped by the Organization it is given.

`worker.revalidateApprovedDestinations` is available only on the worker surface.
It takes its scope decision from its caller. It runs every 15 minutes and is due for every
website destination validated 10 minutes ago or earlier (never a phone number or email
address, which has nothing to check); the public edge serves an approval up
to 30 minutes old, which leaves room for a run that starts up to 10 minutes late
(`approved-destination-age.ts`, `approved-destination-age.test.ts`). That holds only
while a run can take everything that is due. See [Destination revalidation](#destination-revalidation)
for paging, retry scheduling and the lag alert.

`findDestinationApprovalNotificationFacts` (the Portal public API, read by Feed) is
what the notice that a site is waiting for an account admin needs: the site's state
and host, who first asked for it, the earliest live Portal (not deleted, not archived)
whose links open it and how many others do; when no link opens it yet, which is the
usual case because a refused tile saves no link, the Property's earliest live Portal;
`null` for the Portal when the Property has none, and `null` for a site that is not
there or belongs to another Organization. It returns no address, only the host.

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
row) for that language, the Portal's own override then taking the place of it, so an override
alone does not count (its wording is written by an account admin in the Property Brand
Profile). What a gap means is decided by publishing (`gapBlocksPublication`, which the
resolver and this read share): a gap in the primary language, including a primary-language
link label, is flagged `blocksPublish` and refuses publishing; a gap in any other language
is a warning, because the builder copies the primary language's text into it and guests
read that. A link with no primary text still reads its own legacy label, so a missing
primary link label happens only when the label itself is blank. Every
link in the tree is counted, approved destination or not, because its label is needed once the
destination is approved. The Linktree title, a link's line and the hero description are
optional, so they are never "missing". It carries
identifiers and kinds, plus the fallback-language label of a link with a gap so a manager can
tell which link it is, and nothing else; nothing is stored for it. Managers add only the
languages that are offered and have a generation 2 guest copy pack, and a language change
goes through the languages intent. The fallback language is never removed;
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
address is shown once, when a code is made, as before. The same reveal, for the
purpose `show`, backs the workspace header's "Open page", which opens the `direct`
address (the long `/p/<token>`, no scan marker or print code) in a new tab and is offered only for a live
portal with a recoverable live code (an address already held in the browser opens
with no reveal); otherwise it links to Share, and it is absent for a caller
without `portal.update` and `portal.write`, and on the Share tab itself. The token status
also carries `madeBy`, the display name of the person `issued_by` recorded for the
live code (an operator reads as the fixed label; null when unknown), which Share
words as "Made 12 Mar by …". Only `getPortal` resolves it.

Print codes (ADR 0069) are minted by issue and replace and checked by the same reveal.
Issue and replace derive both print codes from the new long address and the two new
artifact ids and store the keyed hashes on the new `portal_tokens` row in the command's
own transaction; a hash the unique index refuses is the typed `print_code_collision`
(HTTP 409, no retry, reported as `PrintCodeCollision`, and the transaction leaves
nothing behind). The reveal unseals the long address, derives the two print codes and
compares their hashes with the stored ones. A missing hash is filled by one idempotent
`UPDATE ... COALESCE` with the tenant predicates that answers what the row holds (a
derived value, so no revision fence); a mismatch, a derive that cannot be done or any
fill error returns the long form for that channel, reports a content-free error
(`PrintCodeDeriveMismatch`, `PrintCodeFillFailed` or `PrintCodeCollision`: the
reporter takes a name and nothing else) and never fails the reveal. The reveal, issue
and replace return `qr`, `nfc` and `direct` (`direct` is the long address with no
marker, for "Public address" and "Open page"), all three with
`Cache-Control: private, no-store` set before anything can fail. `qr` is the QR
address in capitals (`HTTPS://AP.UP.RAILWAY.APP/p/<code>`, version 3) and `nfc` keeps
a lowercase scheme and host so a tag gets the `https://` prefix byte (48 bytes, an
NTAG213 holds 144); verified print codes are always used, with the long address as the fallback.
The Share tab takes `direct` from the server and never works it out from `qr`: a
short address has no marker to strip, and a visit through it is a counted scan. A
planned replacement leaves the old code's print codes live through its grace; a
security replacement, stop and delete end them with it. A print render logs the
address shape and the symbol version, never the address.

`getPortalPreview` is the read behind the editor's live preview (A8): the guest page of one
Portal, per language, from the saved working copy (`draft`) or the active verified snapshot
(`live`). It is gated by `portal.read` in the Portal's Property, writes nothing and records
no session, rating or click. Its DTO carries no destination address at all: a tile whose
address is not approved is a placeholder (`awaiting_approval` for a pending request,
`not_approved` for a disabled, quarantined or unreviewed one), and an approved tile is only
words, an icon and a state. The draft is lenient where publishing is strict: a gap still shows,
filled the way the builder will fill it (the primary language copied in and tagged, except the
Linktree title, which reads its pack default per language). Live applies the guest edge's
approval cut-off (`APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS`, shared with token resolution)
but not its other admission facts (Portal Health, Property status, the public-read decision),
and a snapshot that fails verification reads as `not_published`. A live version from the earlier
page design is `unavailable` (`earlier_design`): publishing writes the new one since slice 19,
but versions published before it stay on the earlier page until they are published again; the
other reasons are `not_published` and `incomplete`.

`getPortalHistory` is the one merged, read-only timeline for a Portal: its
creation, each publish and restore, each change of health (from
`portal_health_intervals`), each public-address event and each page edit,
newest first, with the actor's display name where one was recorded. It merges
five independently ordered sources under one (instant, key) order and one
opaque cursor, and it resolves names through a bounded, Organization-fenced
directory that returns only `user.name`. Only the page edits are stored for it
(`portal_page_edits`, below); the rest derives from ledgers that already exist.
An address entry names who made it when `portal_tokens.issued_by` recorded that (null for a code
made before round 4), and each time a manager was handed an existing address is a
`code_downloaded` entry from `portal_address_downloads`.

The History tab also reads the Portal's versions. `getPortalVersions` lists every
published snapshot newest first (at most 200, with the 201st read only as the version the
oldest is compared with), each with who published it, whether it is the one guests see and
what it added over the version before it; beside them, what the draft is based on (always
the newest version: making an earlier one live never touches the working copy) and who
last edited it (the newest page edit made after the newest version). `getPortalVersion`
reads one version: what it shows guests in plain words and what making it live would
change, compared from the live version to that one. Both come from
`diffPublicationContent`, a pure comparison of two immutable configurations that reads
v1, v2 and v3 into one neutral view first, so a part a schema cannot tell (a v1 has no
brand name, a v2 no Linktree switch) is never reported as changed, and a move between the
legacy page and the Immersive Hub is one `design_changed`, not a list of colours. The
view carries what the guest renderer reads and nothing it does not: a tile's photo and icon,
the hero's focal point, a v2 page's hero of each language (never the brand's default hero),
the legacy category headings, and a v3 short description as link preview text only. The
changes name the manager's own words (a tile's label, a language) and are a read model for
the people who manage the Portal: nothing here is published as a fact. A snapshot that no
longer verifies is left out of the list, because it could not be served or made live again.

`getPortalVersionPreview` is what the History's "View" draws: the guest page of one published
version, whichever is live, from that version's verified snapshot. It is the live preview's
read with the same rules (`readPublishedPreviewInputs`: the guest edge's approval cut-off, none
when the Linktree is off, images only while servable), so it shows what guests would be served
if that version were made live now, and a tile whose address has since lapsed is left out. Its
preview says `source: 'version'` with the version number, so it cannot be mistaken for the live
page, and it carries no address, as the live one does not. A version from the earlier page
design is `unavailable` (`earlier_design`) and the History falls back to the words of
`getPortalVersion`; a version the Portal never had, or that no longer verifies, is refused
(`publication_snapshot_unavailable`). Gated by `portal.read`; it writes nothing. The
History's dialog says, under the phone, when the page draws fewer tiles than the version's
words list (a lapsed address leaves a tile out of the page, not out of the words).

`portal_page_edits` is the page-edit ledger: one row per change that can make a
Portal's working page differ from what guests see, written in the same
transaction as the write and its pending-change fence. `recordPortalContentChange`
is the only caller of the fence, so a change cannot open one without a ledger row
(an architecture test pins it). A row has the same six kinds as the fence
(`portal_configuration`, `portal_links`, `property_brand_profile`,
`property_brand_content`, `portal_localized_override`, `approved_destination`),
the actor (null for the system: an automatic display name, a destination that
failed its network check) and the instant. The fence key stays coarse (it only
says which input moved: every generic link or category command is
`portal_links`/`all`); the ledger key is its own and says which part changed and
what was done to it, so the History can read "renamed the Dinner menu":
`category:<id>:created|renamed|deleted`, `categories:reordered`,
`link:<id>:created|updated|deleted`, `links:<categoryId>:reordered`,
`link:<id>:text:<locale>`, `linktree:title:<locale>`, `linktree:enabled`,
`settings:<field>` (one row per page setting that actually changed), `look:<facet>`
(under `portal_configuration` a Portal's own look, `look:accent|field|wordmark|logo|photo`,
which is also its fence key and has the source version `look:v<n>`; under
`property_brand_profile` the Property's, with `look:text` and a legacy `look:images`),
`all` for the display name, a locale for welcome text and a Portal's own text,
`photo_alt:<locale>` (under `property_brand_content`) for the Property photo's
description in one language, and a destination id. `portalPageEditKey` writes these keys and `describePageEdit`
reads them back, falling back to the kind's general area for a key it does not
know and never to a wrong claim. A `portal_configuration` `look:<facet>` key reads
as the subject `portal_look` (an unknown facet as a look edit with no facet), so an
older server shows it as "Page settings" and loses nothing; `photo_alt:<locale>` reads
as the look's photo, while a row keyed by a bare locale still reads as welcome text.
The Property writers record `look:photo` and `look:logo` where they used to record the
single `look:images`, and the old key keeps reading as both. The fence key of a
description is still the bare locale, shared with welcome text. A change of wording also keeps the text before and
after in `previous_text` and `new_text` (clipped to 200 characters; the category
title, link label, link text per language, Linktree title, Portal name and
description, display name, welcome title and a Portal's own title). Only those keys
may carry wording: a CHECK (`portal_page_edits_text_scope`, mirrored by
`pageEditCarriesWording`) keeps looks, orders, switches and destinations text-free,
and the Organization export carries the columns. Events still carry identifiers
only (ADR 0030); the wording lives in this Portal-owned ledger, like
`portal_group_history`.

Saves of the same part by the same person fold into one row while they stay within
ten minutes of each other and no publication of that Portal (for a Property-wide
row, of any Portal in the Property) has happened since the row's last save. The
row keeps the wording it started from and the latest wording, moves `occurred_at`
to the latest save and counts them in `edit_count`, so an autosaving editor leaves
one entry per sitting and cannot push publishes off the first History page; an
edit made after a publish always starts a new row. A command that changes a
Portal's settings and publishes in the same transaction writes its ledger rows
(who made the change) but no fence. Unlike the fence the ledger is written for a
Portal that was never published, and the Property's look and welcome text get one
Property-wide row (`portal_id` null, tied to its Property by its own tenant foreign
key) that the History shows on every Portal of the Property made since that Portal
existed. A destination change writes one row per Portal that links it. History
starts at the deploy of migration 0050; earlier edits were never attributed and are
not reconstructed. Rows are updated only by the fold above and never deleted while
their Portal exists; a purge removes them first.

The pending-change fence (`portal_pending_content_changes`) also records who opened
each row (`changed_by`, migration 0051): the actor `recordPortalContentChange` was
given, null for the system and for rows from before the column. The first record of a
revision keeps its person (the row's unique key makes a second record a no-op). The
publication history read returns it as `pendingChanges[].changedBy`, and
`activatedBy` beside each activation, both as a person the directory can name or an
unnamed placeholder.

Review & publish reads through `getPortalReview` (`portal.read`, writes nothing). It
asks the questions `publishPortalChanges` asks, in the same words: the Property is
active, the Google destination is verified, someone is responsible, the address
works (any code that resolves, an older code made before access artifacts included:
guests open the page with it, only its scans are not counted, and Share offers to
replace it), and the resolver's blockers and warnings (`portal-review-rules.ts` turns them
into checks; a blocked check is exactly what publishing would refuse, a copied text
is a warning). The change list is the page-edit ledger since the live version was
published (the live one, which "Make live again" can make older than the newest; the
ledger never spans an activation, so rows after it start from the live wording), each
part folded into one change (first wording to last, put-back wording, a tile added then
removed, and edits to a tile that is removed are dropped; an added tile reads its newest
wording), plus any open fence kind the ledger has
no row for, a live version of the earlier design, and a Google address the Property
has since left; "unlisted" stands in when the draft differs and nothing nameable is
left, and "no_visible_change" when changes were recorded but the draft says what is live.
A Property-wide look row (`property_brand_profile` `look:<facet>`) or photo-description
row (`photo_alt:<locale>`) is left out of the list when the Portal owns every group it
names and so cannot show it (`facetReachesPortal` over the working copy's
`lookSources`; a legacy `look:images` row only when the Portal owns both its photo and
its name and logo). The filter runs after the "may be incomplete" flag is computed and
never touches a pending change, so `nothingToPublish` stays exactly the question
publish answers; History keeps those rows, worded "on the property look". A saved photo
description is listed as a change of the photo (its key maps to the `look` area, which
the put-back rule does not treat as wording that can be cleared), where a description
saved before `photo_alt:<locale>` existed was dropped as put back. A Portal's
own look edit is listed as "Look · changed this portal's photo", "…accent colour" and
so on.
`canPublish` also needs `portal.update` and the `portal.write` capability, so a reader
(Member) or a dark capability never gets a button the server would refuse. `nothingToPublish` is the question the publish use case answers `unchanged` to.
A Portal that is not live has no change list: it has no live version to differ from.

A content review (`completeContentReview`, a live Portal only) records three facts at
once. Its `reviewId` is the browser's idempotency key and becomes the facts'
`source_aggregate_id`; the request schema holds it, and the three event ids a correction
supersedes, to a UUID, so a fact never carries text of a caller's choosing. The configuration completeness counts five fields on the working copy Publish reads,
under the Portal lock (`portal-configuration-completeness.ts`): the Portal name; the
primary language's welcome line, link preview and link labels (what the `primary_text`
check asks); the Property look (a Brand Profile with a display name and an accent; a Portal's own
look does not change this field); a
Linktree link guests can open (the Linktree on and an approved link); and the Property's
verified Google review destination, which the use case looks up. The fact names the fields
it counted (`fieldSet: 'immersive_hub'`, event version 3). Every version 1 and 2 fact
counted the legacy settings (name, `portals.description`, the Portal theme's colour, link
categories, link addresses), which a v3 Portal cannot complete. Reporting does not project
these workflow facts into metric readings. The destination ratio counts every
link: one with a Property destination when that destination is approved, a raw legacy
address by the safe-link allowlist (ADR 0044). The facts retain the durable record and
idempotency of the editor’s link-check action.

The earlier issued-image implementation (presigned browser upload, issuance
table, background job) was removed and is not coming back. The nullable
`portals.hero_image_url` column and read path remain so published historical
rows still render, while the shared arbitrary-key storage stack remains live
for Identity avatar and organization-logo uploads through `container.assetStorage`.
The signed upload address carries no size bound, so Identity reads the stored
size (`inspectObject`) at its finalize step, and again where an avatar's address
is saved, and refuses and deletes an object over its 5 MB cap. The address stays
valid for an hour and can replace the object after that check, so the bound that
always holds is the read: Identity's image route asks `getObject` for at most
5 MB and serves nothing larger. Identity stores its own address for the image
(`/api/public/identity-assets/<key>`), never a provider URL.
Every call the adapter makes to the store has a 15-second deadline, which also
ends a read whose body stops arriving: the SDK sets none, and the anonymous
media route would otherwise wait on a bucket that accepts the connection and
goes quiet (`s3-storage.adapter.endpoints.test.ts`).

## Invariants

1. Portal slugs and Portal Group names are unique within a Property; one Portal
   belongs to at most one active group.
2. Private Feedback Threshold is an integer from 1 through 5.
3. A Portal may have no secondary links. It cannot enter `published` unless its Property has a verified, provider-derived Google review destination.
4. Publishing atomically creates and activates an immutable snapshot. Working-copy edits are prospective and cannot change the public response until another deliberate publication.
   A live Portal can be republished (`republishPortal`, "Publish changes"): in one commit the live activation closes with reason `replaced` and a new snapshot and activation open, under the same Property publication fence as a first publication. The Portal stays Published, and it is refused for a Portal that is not (publishing, not republishing, takes it live). It does nothing when nothing is pending, and it asks the same readiness questions as a first publication. Both compare the snapshot with the committed working copy under the Portal row, which every link, category and link-text command takes first, and lock no table: one Organization's publish never waits for another's link write, and a link edit of the same Portal waits for the publish and is then refused as stale (`portal-publication-commands.integration.test.ts`).
5. Rollback never rewrites history: it closes the current activation and appends a new activation to another valid snapshot of the same Portal, never the one already live. "Make live again" is that act, and it works in both directions (an earlier version, or a later one after an earlier was restored), so restoring a version never strands the ones after it. It does not touch the working copy or its pending changes.
6. If that destination later becomes stale, unavailable, or temporarily unreadable, the published private rating/feedback gateway remains available in a degraded state. No stale URI is serialized and Google selection is denied with gentle guest copy.
7. Public resolution fails closed when that Property destination is `awaiting_refresh` or `unavailable`; a stale URI is never rendered.
8. Soft-deleting a Portal revokes its live tokens; a deleted Portal never has a live
   token. Token issue, rotation, and revocation share the Portal revision fence.
9. The raw address and the print codes are request-local and never enter state, facts, logs, exports or Metric, with one exception: the sealed copy of an active code (ADR 0064). Print codes are derived from it and stored only as keyed hashes (ADR 0069). Replacing, stopping or deleting clears the sealed copy in the same statement, and a CHECK refuses a sealed address on any other code.
10. Portal lifecycle facts never copy Portal name, slug, description, theme, responsible-manager assignments, destination, or link content. Nor do they carry a Portal's own look: saving it emits no event (ADR 0070).
11. An image enters the Portal only through the server-side ingest, which stores a re-encoded WebP and never the upload; no Portal request issues a presigned upload or writes `portals.hero_image_url`, and a published Portal with a null value remains valid. A Portal's own photo and logo are such images: `portal_look_overrides` only references an ingested asset of the Portal's Property (ADR 0070).
12. The POR-01 report never copies names, localized content, raw URLs, token material, themes, or print-batch values and never infers creator, ownership, translation, brand, or destination provenance. Reported ambiguous Portal rows remain Disabled or Archived; raw secondary links are treated as quarantined and excluded from publication until a separately reviewed command resolves them.
13. Closing is a **stop, not a delete**, and it is reversible: the immutable publication snapshot survives and `portals.publication_state` keeps the tenant's own published/draft intent, so explicit reactivation re-points a new activation at the same snapshot rather than guessing what each Portal used to be. Ordinary closure cancellation does not itself reactivate Portals — see `docs/operations/organization-lifecycle.md`.
14. Linktree edits (link texts, the section title, the switch) take the Portal fence like any content command and record `portal_links` pending changes under structured keys: `link:<id>:text:<locale>`, `linktree:title:<locale>` and `linktree:enabled`. Only a value that actually changed records one, and their facts carry identifiers, never the wording.
15. A group's history starts at the deploy of migration 0046; earlier changes are not reconstructed, because earlier names were never kept. History rows are never updated or deleted while their group exists, and a purge removes them with the group.

## Verification

Portal server functions use the shared command handler for request headers,
tracing and safe error translation. `server/portal-command-errors.ts` owns the
Portal status mapping; the existing `server/portals.ts` export remains available.
Permission, capability and resource-scope checks stay in the server adapters.
Address and print handlers keep their early no-store headers and rate limits.

Unit tests stay beside domain rules, publication, token, responsibility, and server
contracts. PostgreSQL integration tests cover command atomicity, revision fences,
public resolution, lifecycle contributors, and the POR-01 read-only reconciliation.
The build and architecture tests pin public surfaces, worker reachability, and the
read-only repository boundary.

## Skip the private rating (2026-11-02)

A Portal's skipPrivateRating setting defaults to false, is copied with its
content, and is saved under portal.update above the Private note threshold.
It is a pending page-settings edit until Review & publish writes it into the
schema-3 review gateway only when true. Absence means false, so switched-off
publications keep their existing bytes and digest. Older schema-3 snapshots
read a missing field as false without changing their digest; versions 1 and 2 ignore it. Guest owns the
direct card and server admission, including the Google-unavailable fallback
and earlier responses' correction and withdrawal.

The overview says “Skips rating”, and Results keeps history with a quiet
explanation that no new ratings or notes are collected once the setting is
published. Goal readiness facts carry the setting to Reporting. Portal asks an injected rating-goal port before
turning it on and refuses while a running rating goal targets that Portal, or
when it is the last rating collector for a running Group or Property rating
goal (only published Portals count for the Property check);
it imports no Reporting implementation.

## Personal Portal foundation — 2026-11-01 (ADR 0076)

Portal kind is `place` or `personal`, set only at creation. A personal Portal keeps the person's name in `name` for managers and a fixed guest name in `public_name`; publication sources, guest data and print metadata use `public_name ?? name`. Its slug is always derived from its reserved id. The copy path supplies wording, links and look; a source with unpublished changes or an archived source is refused, and preflight names links the copy omits. Without a source it starts from the Property wording and public name. Address recovery must be configured. Code issuance precedes first publication, using the manager's own context.

`updatePersonalGuestPage` (R19) lets a person's page take over a published Portal's wording, links, look and opening print wording, keeping its code, results, Group, responsible managers and rating settings. `replacePersonalPortalContent` does that in one commit under the Property's publication fence and the same source fence as a copy at creation; going live is then the ordinary `publishPortalChanges`. Publishing's gates are asked before the replace; if publishing still refuses, the result is `not_live` and the new content waits as the draft. A link that keeps its destination keeps its id, so open pages and tap history survive. The replace is recorded through `recordPortalContentChange`. Rows the two paths share are written by `portal-copied-content.ts`.

Only Staff Remove archives a personal Portal, under `staff.remove`. The ordinary update refuses its rename, slug change, Archive and Restore; Disable remains available. The own-code read checks the session's personal assignment, uses the same sealed-address reader and ledger, and returns QR wording only. It records one `show` per user and token version and spends no Organization address budget. `Portal` and `PortalOverviewRow` carry kind; this foundation changes no list presentation.

## Manager staff presentation and scan-target fences

Personal Portals use their manager name in the workspace and a read-only Name
field; the quiet guest-name fact uses publicName. Rename, invitation management
and Remove are Identity commands. Personal rows never offer ordinary Archive,
Restore or Delete; completed removals leave list presentation while their facts
remain in totals.

Group membership and Goal definition commits share the staff-target Property
fence. A person cannot join a Group with a running rating goal ("End the goal
first"). A staff scan target requires every Portal in its subject to collect
private ratings. Membership changes and Skip private rating writes recheck this
under that fence, including a place Portal joining a Group that contains people.
The injected running-goal port also explains staff scan-target refusals before
commit; Portal never imports a Reporting implementation.

### Personal copies and print identification (2026-11-03)

The no-source personal-Portal preflight resolves the proposed Property wording
with resolvePortalPublication before Identity reserves a person. Missing title or
description is guest_wording_missing; missing language packs and invalid time
zones retain their own actionable codes. Name privacy is checked for the batch too.
Personal copies inherit eligible source managers, with the eligible creator as
fallback. Their safe opening print wording (saved, else last print) is written in
portal_print_wordings in the create transaction; a name-guard refusal skips only
that wording. Other copy behavior is unchanged.

Personal final-print downloads use a sanitized person-first filename and identify
the person only in available sheet/crop-mark margins. The guest face and public PDF
title keep the public name. A single piece without a margin identifies the person
only in its filename. Share says the saved opening line is also the phone's line.

### Destination revalidation

The worker fixes its due cutoff at the start of each run and takes pages of 50
pending or approved websites, oldest validation first, excluding visited ids.
Checks run in batches of at most five so slow failures leave time for later
pages. Each validation has one five-second deadline across DNS, address retries,
redirects and the HEAD-to-GET fallback. Expiry cancels its resolver or request;
the transport drains before its batch slot is released. Each active batch
settles before the page returns, including on error.
Each row is visited at most once per run; denied scopes get neither network
checks nor writes.
Transient failures retain the last successful validation time, persist
`next_attempt_at` and back off for 1, 2, 4, 8, then at most 15 minutes. Successful
validation or explicit approval clears the retry state. Contacts never enter
the network queue; unsafe websites still enter quarantine through the existing
publication lock, ledger and outbox path. Guest freshness remains 30 minutes.

The existing alert dispatcher sends `portal.destination-revalidation-lag` when
a run exhausts its 150-second paging budget or an authorized site's check is
still unavailable at the freshness limit. Alerts contain only elapsed times and
fixed descriptions. Check worker run summaries for unavailable, unauthorized
and stale counts, confirm provider/DNS availability and inspect worker capacity;
keep the public freshness cutoff and scope checks in place during recovery.
