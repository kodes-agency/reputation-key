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
Publishing writes schema version 3 (the Immersive Hub) only, from a publication
source that `resolvePortalPublication` turns into the snapshot's content: the
one function that decides what a gap means (a primary-language gap blocks, any
other language is copied from the primary and tagged `fallbackFrom`, the
Linktree title falls back to its pack default and is never copied), shared by
the builder, the publish transaction's comparison and the history read. Version
1 and 2 snapshots stay servable and verify forever, on the legacy renderer.
Activations are append-only effective-dated routes from a stable token to one
snapshot; publish, republish and rollback append activations, while disable/archive
close one. Groups remain Property-scoped, and one Portal has at most one active group.

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
primary's text starts from it where none exists. Rolling back to a release before
this one is not safe for links edited since: that code treated a link label newer
than its text as a rename, so it would read the empty column as the wording. A Portal carries at most four links, counted under the
Portal fence on create; a Portal that already has more keeps them. Icons come
from a closed catalogue (`src/shared/domain/portal-link-icon.ts`, 27 keys, every
icon the round-4 editor offers), enforced by a CHECK and refused in the link
constructor.

The **Property look** is the part of the Property Brand Profile a guest sees:
accent colour, background (`background_mode` `auto` derives the dark page field
from the accent with `src/shared/domain/portal-field-colour.ts`, `manual` uses
`background_color`), wordmark, logo and photo (uploaded assets, see Media), plus
the per-language hero alt text on the brand content. The profile keeps two versions
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

The look is edited on one page, `/properties/:propertyId/portals/look` (board 9
of the round-4 admin), by an Account Admin; everyone who may read portals can
open it. `savePropertyLook` writes the accent, the background mode (and the
colour when it is manual) and the wordmark through the repository's own look
writer, which reads and writes the profile inside the Property's publication
lock and touches only those columns and the look version: the display name, the
images, the text colour and `updated_by` stay as they are, so a look save never
confirms an automatic public display name, and a name or image write beside it
is never put back (the actor is recorded in the page-edit ledger only). It
refuses a colour that is not `#rrggbb` and a manual background light text cannot
be read on (AAA on the field). It does not refuse an accent that is hard to see
on its field, because the default palette every Property starts with is one and
the guest resolver draws the text colour in its place; the page's readout says
so (`src/shared/domain/portal-look-readout.ts`, built on the same arithmetic the
guest resolver uses). A Property with no Brand Profile is asked to set its
public display name first. The page autosaves, so an edit is a draft until each
live Portal is published again; the portal
editor's Look section only shows the look and links there.

A new Portal (`createPortal`, the New portal dialog) commits in one transaction
with its group membership (the group is fenced like a membership change and the
`portal_group.portal_added` fact is recorded), its responsible managers and, when
it starts from another Portal, a copy of that Portal's settings, wording per
language, Linktree title, approved links with their categories and link texts.
It starts from the Property's own wording by default. Languages default to the
Property's, or to those of the Portal being copied; only languages with a reviewed
pack may be chosen. A copy never takes codes and their artifacts, publication
snapshots or activations, responsible managers, health or history, and leaves
behind photos (a hero image is a server-owned upload derivative) and every link
whose destination is not approved now (disabled, quarantined or pending
approval, or a legacy URL with no destination), which take no slot of the
four-link limit. An archived Portal cannot be a starting point
(`portal_inactive`, HTTP 410). A name whose derived address is taken at the
Property gets the next free numbered address; a name that gives no address (no
Latin letters or digits, as in Cyrillic) is addressed from the start of the new
Portal's own id (`portal-<first 8 hex>`, a longer slice if that is held), so it
never walks a counter; an address the manager typed must be free. There are no
place types: the dialog asks for a name, a group, languages and what to start
from.

The editor no longer shows categories. `getPortalLinktree` reads the whole
section (switch, written titles, and each link in guest order with its texts,
icon and the approval of its destination), and a link is created without a
category: it joins the Portal's last category, and the first link starts one,
which no guest sees (publishing flattens categories). It has a fixed neutral
title, because a category row needs one. The category is built only after the link's label, icon, cap and destination have
passed and is committed in the link's own transaction (`startCategory` on the
create command), so a refused link leaves neither it nor its fact behind. Re-ordering still saves one category's order, so the
editor moves a tile only among those of its own (older) category. The category
management commands (create, rename, delete, reorder) are retired: nothing calls
them, and a category is only ever the one a first link starts. Categories made
before round 4 stay in the working copy (the editor moves a tile within its own
category); the v3 builder flattens them.

The eligible creator is the initial Portal Responsible Manager (by default; the
dialog may name other eligible managers, or nobody). Multiple eligible
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
  Organization and Property. `updateLink` takes an `imageAssetId` (or null) and
  checks it with `canReferencePortalMediaAsset('link_image', asset)` against the
  Portal's own Property; `savePropertyHero` and `savePropertyLogo` do the same
  for `brand_hero` and `brand_logo` (an Account Admin, `portal.write`, the
  Property's own asset; any other id is `media_not_found`). The database does
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
  moves: `look_version`, a `look:images` pending change for each live Portal
  and the profile fact (a description is a `property_brand_content` change for
  its language); the display name and `updated_by` are not touched.
  `savePropertyLogo` is the same for `logo_asset_id`. Both answer with the media as
  a page draws it (`resolvePropertyLookMedia`: size, focal point and the media
  route's address, for an asset of this Property that may still be served; a
  taken-down image reads as none), which the experience read carries as `media`.
  The draft preview draws only those assets, so a photograph that is only an
  address on the profile or in an override (which a v3 publication drops) is not
  previewed; a tile's uploaded photo and the live version's photograph and logo
  are drawn too. The browser checks a chosen file against the same size rules as
  the policy (`PORTAL_MEDIA_SIZE_RULES` in `src/shared/domain/portal-media.ts`)
  before sending it. Only raster logos are accepted: no SVG.
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
`settings:<field>` (one row per page setting that actually changed), `look:<facet>`,
`all` for the display name, a locale for welcome text and a Portal's own text, and
a destination id. `portalPageEditKey` writes these keys and `describePageEdit`
reads them back, falling back to the kind's general area for a key it does not
know and never to a wrong claim. A change of wording also keeps the text before and
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
works, and the resolver's blockers and warnings (`portal-review-rules.ts` turns them
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
`canPublish` also needs `portal.update` and the `portal.write` capability, so a reader
(Member) or a dark capability never gets a button the server would refuse. `nothingToPublish` is the question the publish use case answers `unchanged` to.
A Portal that is not live has no change list: it has no live version to differ from.

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
   A live Portal can be republished (`republishPortal`, "Publish changes"): in one commit the live activation closes with reason `replaced` and a new snapshot and activation open, under the same Property publication fence as a first publication. The Portal stays Published, and it is refused for a Portal that is not (publishing, not republishing, takes it live). It does nothing when nothing is pending, and it asks the same readiness questions as a first publication.
   An operator can republish every live v1/v2 Portal as v3 (`pnpm ops republish-legacy-portals`, run through `portalMaintenanceRuntime`): it selects by the open activation's snapshot schema version, 1 or 2 (never by history, so a draft, disabled, archived or deleted Portal is not touched), runs this same use case per Portal as the actor `ops:<operator>`, and skips a Portal that is not ready with the gate's reason. A Portal whose manager has unpublished edits is skipped too (`pending_edits`), because the upgrade would put those drafts live; `--include-pending-edits` is the operator's explicit opt-in. The operator actor is filed as an `operator` in the Operational Action History and shown to managers as "Reputation Key", never by its id.
5. Rollback never rewrites history: it closes the current activation and appends a new activation to another valid snapshot of the same Portal, never the one already live. "Make live again" is that act, and it works in both directions (an earlier version, or a later one after an earlier was restored), so restoring a version never strands the ones after it. It does not touch the working copy or its pending changes.
6. If that destination later becomes stale, unavailable, or temporarily unreadable, the published private rating/feedback gateway remains available in a degraded state. No stale URI is serialized and Google selection is denied with gentle guest copy.
7. Public resolution fails closed when that Property destination is `awaiting_refresh` or `unavailable`; a stale URI is never rendered.
8. Soft-deleting a Portal revokes its live tokens; a deleted Portal never has a live
   token. Token issue, rotation, and revocation share the Portal revision fence.
9. The raw address is request-local and never enters state, facts, logs, exports or Metric, with one exception: the sealed copy of an active code (ADR 0064). Replacing, stopping or deleting clears it in the same statement, and a CHECK refuses a sealed address on any other code.
10. Portal lifecycle facts never copy Portal name, slug, description, theme, responsible-manager assignments, destination, or link content.
11. An image enters the Portal only through the server-side ingest, which stores a re-encoded WebP and never the upload; no Portal request issues a presigned upload or writes `portals.hero_image_url`, and a published Portal with a null value remains valid.
12. The POR-01 report never copies names, localized content, raw URLs, token material, themes, or print-batch values and never infers creator, ownership, translation, brand, or destination provenance. Reported ambiguous Portal rows remain Disabled or Archived; raw secondary links are treated as quarantined and excluded from publication until a separately reviewed command resolves them.
13. Closing is a **stop, not a delete**, and it is reversible: the immutable publication snapshot survives and `portals.publication_state` keeps the tenant's own published/draft intent, so explicit reactivation re-points a new activation at the same snapshot rather than guessing what each Portal used to be. Ordinary closure cancellation does not itself reactivate Portals — see `docs/operations/organization-lifecycle.md`.
14. `portal_group_members` is purged as a **row delete only**. It is a physical-drop-blocked compatibility mirror that nothing reads or writes any more (membership is `portal_group_memberships`, and the Organization Export no longer carries the mirror): the rows are tenant content and must go, the table must not. No phase issues a DROP or TRUNCATE; dropping the table is a separate expand/backfill/contract decision.
15. Linktree edits (link texts, the section title, the switch) take the Portal fence like any content command and record `portal_links` pending changes under structured keys: `link:<id>:text:<locale>`, `linktree:title:<locale>` and `linktree:enabled`. Only a value that actually changed records one, and their facts carry identifiers, never the wording.
16. A group's history starts at the deploy of migration 0046; earlier changes are not reconstructed, because earlier names were never kept. History rows are never updated or deleted while their group exists, and a purge removes them with the group.

## Verification

Unit tests stay beside domain rules, publication, token, responsibility, and server
contracts. PostgreSQL integration tests cover command atomicity, revision fences,
public resolution, lifecycle contributors, and the POR-01 read-only reconciliation.
The build and architecture tests pin public surfaces, worker reachability, and the
read-only repository boundary.
