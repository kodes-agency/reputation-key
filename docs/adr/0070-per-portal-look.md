---
status: accepted
date: 2026-10-26
---

# 0070 — A Portal's own look

Amends [ADR 0061](0061-guest-languages-and-publication-v3.md) (decision 7) and
[ADR 0063](0063-portal-media.md) (decisions 5, 7 and 8, the garbage collection
section and the 200-image cap), and the Portal CONTEXT section "Property look and a
Portal's own look", each by a dated note that points here. It knowingly reverses the
"one look per property" scope rule of the round-3 admin proposal
([round-3-admin](../design/portal-experience/round-3-admin/README.md)).

## Context

A Portal has no look of its own. The only source of a look is the Property Brand
Profile (`property_portal_brand_profiles`, one row per Property) and, for the photo's
description, the Property's wording rows (`property_portal_brand_contents.hero_alt_text`).
A hotel with a reception, a spa and a restaurant gets one photo, one set of colours
and one name-and-logo for all three.

The gap is on the source side only. Each Portal already publishes its own immutable
v3 snapshot whose `brandProfile` is a flat set of resolved values, and the guest page,
`og:image` and the print kit read only that snapshot. So storage, the working-copy
reader, the writers and the admin screens are what change; the guest side is not.

"One look per property" was never an owner decision. It came from the round-3
proposal, which says of itself that nothing in it is an approved product decision
(`round-3-admin/README.md`, line 5), and round 4 lists "a photo for one portal only"
as not designed. On 2026-10-26 the owner asked for per-portal looks and took
decisions D1 to D14 at the recommended defaults. This record is that decision and its
design.

Five things bind the answer:

- **Snapshots are immutable and strict.** ADR 0061 fixed the v3 shape in full; the
  digest is recomputed over the zod-parsed object, so a field the reader does not name
  is stripped and the Portal turns unavailable. A new guest-visible field would need a
  v4 and its own reader-first release. Nothing here may need one.
- **A look edit fences every Portal of the Property that has a snapshot**, and a
  Property-wide ledger row (`property_brand_profile`) must keep `portal_id` NULL (a
  CHECK). A Portal that has its own colours must not show a pending change when the
  Property's accent moves.
- **Hero and logo uploads are Account Admin only** (ADR 0063 decision 7), so the
  right to change a Portal's look must be the same: nobody may be able to change a
  Portal's colours while every upload of its photo is refused.
- **Publish and the draft preview must agree.** What a Portal's working copy resolves
  to is what publish, the in-transaction re-check, Review and History's pending test
  compare, and the draft preview shows it, so they must share one rule.
- **Existing Portals must not move.** Every Portal that has not been given a look of
  its own must resolve to byte-identical content, digest and look version.

## Owner decisions (2026-10-26)

| #   | Decision                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | A Portal may have its own photo, colours, and name and logo. The public display name, default languages and Property wording stay property-wide. |
| D2  | Follow or own is chosen per group, not for the whole look.                                                                                       |
| D3  | Only Account Admins edit a Portal's look (`portal.admin` plus `portal.write`). Property Managers see facts.                                      |
| D4  | The own-look controls are hidden while the Property has fewer than two non-archived Portals, unless the Portal already has an override.          |
| D5  | "Start from another portal" copies the source's own look, also when a Property Manager creates the Portal.                                       |
| D6  | An own photo that is taken down shows no photo, and the editor says so.                                                                          |
| D7  | No per-Portal text colour, light page or fonts (these would need a v4 snapshot).                                                                 |
| D8  | No named looks and no group looks in this release.                                                                                               |
| D9  | No print-mismatch warning for colours or logo in this release.                                                                                   |
| D10 | A photo's description is optional; empty means decorative, and the editor says so.                                                               |
| D11 | Dark launch behind `PORTAL_OWN_LOOK_ENABLED` (default false), switched on for web the same day, after web and worker both run the reader.        |
| D12 | An archived Portal keeps its own photo and logo references (nothing is nulled on archive).                                                       |
| D13 | The cap of 200 stored images per Property stays.                                                                                                 |
| D14 | The page keeps the name "Property look", described as the look every Portal starts with.                                                         |

## Decision

1. **Three groups, each with its own mode.** A Portal's look is three groups:
   **photo** (the hero, its focal point and a description per language),
   **colours** (the accent and the background together, because contrast is judged on
   the pair) and **name and logo** (the wordmark and the logo). Colours and name and
   logo are `inherit` or `own`; the photo is `inherit`, `own` or `none` ("No photo on
   this portal", which is not a way of following). Each group is independent: a spa
   with its own photo keeps following the hotel's colours and logo, so a later hotel
   edit still reaches it. The public display name, default languages and Property
   wording are never a Portal's, and AI reply drafts keep fencing on the Property's
   `display_name` and `version` only. The text colour is never a Portal's (D7).
2. **One sparse 1:1 table.** `portal_look_overrides` (migration 0074, in a new schema
   file because `portal.schema.ts` is close to its length limit) holds at most one row per
   Portal, made by the first save of an own group and deleted by nothing but an
   Organization purge, which is what keeps `look_version` monotone. No row means "follows
   everything": there is no backfill, and no existing table, column or CHECK changes.
   Each group has a mode column; a group that follows holds no values, so switching a
   group back to `inherit` nulls its columns and no dormant asset reference keeps an
   image counted against the cap. Switching a group to `own` copies the Property's
   current values, so nothing visible moves until the admin edits. The own photo's
   descriptions live as jsonb on the same row, so **a description always travels with
   its photo** and is only ever used with it. The row is tied to its Portal and to its
   two possible assets by composite RESTRICT foreign keys on (organization, property, id),
   as the Brand Profile's are, so a Portal or an image of another Property cannot be
   referenced. The database cannot tie a reference to an asset's purpose, so every
   writer checks the slot (`brand_hero`, `brand_logo`) in code (ADR 0063 decision 5).
   Jsonb keys are filtered with `isGuestLocale` on read and blank values are refused on
   write. The Property Brand Profile, its `version`, `updated_by` and every legacy
   column (`portals.theme`, `portals.hero_image_url`, `portal_localized_overrides.hero_image_url`,
   the profile's `logo_url`, `default_hero_image_url` and `text_color`) are untouched.
3. **The inheritance rule.** It is resolved where a working copy is read: at publish,
   at the in-transaction re-check, in Review, in History's pending test, in the
   completeness fact, in the print kit's legacy path and in the draft preview. It is
   never resolved when a guest opens a page. With P the Property's Brand Profile and
   O the Portal's row (or none):
   - **No profile.** The effective look is the existing default look and any O is
     ignored. Writers refuse with `brand_profile_missing`, so an O cannot exist
     without a P.
   - **Always the Property's.** Display name, default languages and the Property's
     wording (a Portal's own title, short description and Linktree title still
     override wording per language, as before).
   - **Colours.** If O's colours are `own`, O's accent, background mode and
     background colour; otherwise P's. The field colour is the background colour when
     the mode is manual and derived from the accent when it is auto.
   - **Name and logo.** If O's identity is `own`, O's wordmark and logo; a null
     wordmark shows the display name and a null logo shows none. Otherwise P's.
   - **Photo.** `own`: O's hero and focal point. `none`: no hero. `inherit`: P's. A hero
     or logo is used only while its asset is active, belongs to the Portal's Property
     and fits the slot (`brand_hero`, `brand_logo`); the working-copy reader checks the
     purpose as the draft preview already does. **A taken-down own photo therefore
     resolves to no photo, never to the Property's photo** (D6).
   - **Description.** `own`: O's text for the language, or none; the Property's
     description of a different photo is never used. `inherit`: the Property's. `none`:
     there is no hero, so no description. The existing publish rule then applies:
     a description is published only when the primary language has one, the primary
     fills the other languages, and empty means decorative (D10).
   - **Scope.** Overrides never cross Properties, and a Portal group carries no look (D8).
4. **The effective look version.** `lookVersion` is the override's `look_version` when
   the Portal has a row, otherwise the Property's. A Portal with no row is therefore
   byte-identical to what it was. A row moves by +1 on every Portal save that changes
   what the Portal shows, and by +1 on every Property save that changes a group the
   row marks as `inherit`, **once per save and not once per facet**, in the same
   transaction under the Property lock. The first row starts at the Property's version
   when the save changed nothing visible (the common case: "Set colours for this
   portal", prefilled with the Property's values) and one above it when it did. A first
   row that started above the Property's version without a visible change would make
   the working copy differ from the snapshot (`lookVersion` is part of the match) with
   nothing for Review to list. The version is only ever compared for equality; what
   matters is that it moves exactly when what this Portal shows of the look moves.
5. **Materialised at publish, with no v4.** The snapshot stays schema v3 with no new
   field. The effective values are written into `configuration.brandProfile` (wordmark,
   logo, hero and focal point, accent colour, field colour, look version) and into
   `localizedContent[locale].heroAlt`; `displayName` stays the Property's, and the
   mirrored `brand_profile_version` column holds the effective look version, which is
   equal by construction. The verifier, the zod schema, the digest and the v1, v2 and v3
   goldens do not change. Two pure functions in `domain/portal-look.ts`,
   `applyPortalLook` (over the Brand Profile) and `withPortalHeroAlt` (over the
   Property's content rows), return their input's shape with the Portal's own groups
   swapped in, and run at the inputs of today's resolvers, inside the working-copy
   reader and inside the draft-preview use case; with no override they return their
   input unchanged. `fieldColourOf` is `brandProfileOf`'s own expression extracted
   unchanged (no case normalisation), so stored values resolve exactly as before and
   the preview uses the same one. The draft preview and publish are two callers of the
   same rule, held together by a parity test on content (brand and localized `heroAlt`)
   with an explicit allow-list for the differences that already existed. Which groups a
   Portal owns (`lookSources`) is returned beside the working copy
   (`loadWorkingCopyWithLook`) and is not a field of the publication source, so it can
   never reach a snapshot or a digest. This amends ADR 0061 decision 7.
6. **Lock order: the Property, then the Portal.** A Portal's look save takes the
   Property's publication advisory lock first, then the Portal row `FOR UPDATE`, the
   order publish takes them in, so the two cannot deadlock and a look save and a
   publish on the same Portal serialise. Property look writers take the same lock they
   already took and now also bump the followers' versions under it. Every statement on
   the new table carries the organization and the Property (the tenant-predicate
   baseline gains nothing).
7. **The ledger and the fence.** A Portal's own look edits use the existing
   Portal-scoped kind `portal_configuration`, with the key `look:accent`,
   `look:field`, `look:wordmark`, `look:logo` or `look:photo` for the ledger row and
   the fence alike, and the source version `look:v<n>`. No ledger CHECK changes: an
   older server reads such a row as "Page settings" rather than dropping it, and
   restating a CHECK on those tables would run inside the migration transaction.
   The writer compares the effective look before and after and records nothing when
   nothing guests see has moved; autosaves by the same person fold into one row as
   before. **The `images` facet is split** into `photo` and `logo` for new rows, so the
   Property look writers now record `look:photo` and `look:logo`; an old `look:images`
   row keeps reading, as a change to both the photo and the name and logo. A Property
   photo's description is recorded under `property_brand_content` with the ledger key
   `photo_alt:<locale>` (the fence key stays the bare locale, shared with welcome text),
   which reads as part of the look; an old row keyed by a bare locale keeps reading as
   welcome text. The page-edit ledger reads a `portal_configuration` `look:<facet>` key
   as a new subject, `portal_look`.
   **A Property-wide look edit opens a pending change only on the Portals it reaches**,
   those that follow at least one changed group: the Property-wide ledger row is still
   written once, and the fence opens on followers that have a snapshot. With no override
   rows this is exactly today's fence set. Review hides the Property-wide look and
   description rows that cannot reach the Portal; it never masks a pending row, so
   `nothingToPublish` is still exactly the question publish asks, and it masks after the
   page's "changes may be incomplete" flag is computed. History keeps them, reworded
   "on the property look". In the Property look batch a Portal's own look edit counts
   as another draft edit and leaves its row unticked (publishing that row publishes those
   edits too); Portals that own the edited group show "Already up to date". "Make live again" is unchanged: it reactivates the frozen
   look and leaves the override and the pending rows alone.
8. **Account Admins only, behind one constant.** `PORTAL_LOOK_EDIT_PERMISSION` is
   `portal.admin`, matching ADR 0063 decision 7. Each use case loads the Portal under
   `portal.update`, refuses an archived Portal (`portal_inactive`), checks the
   constant, checks Property access, checks that the Portal belongs to the Property in
   the request and refuses while the flag is off (`feature_unavailable`, HTTP 409). Each
   server function asks `requireExecutionAllowed` for `portal.update` under the
   `portal.write` capability; reading the override needs `portal.read`. Uploads are
   unchanged (`POST /api/portal-media`, purpose `hero` or `logo`, Account Admin with
   `portal.upload`). Publishing is unchanged: a Property Manager can publish what an
   Account Admin prepared. Takedown stays an Account Admin act at Property level. If
   the owner later lets a Portal's Property Manager change its look, set the constant
   to `portal.update` on that Portal, make the upload permission depend on purpose and
   Portal, and amend ADR 0063 decision 7; relaxing is a local change, tightening after
   managers used it would not be.
9. **Disclosure.** Nothing new appears for a Property with one Portal. The controls
   show only when the flag is on, the viewer is an Account Admin with `portal.write`,
   the Portal is not archived, and the Property has two or more non-archived Portals or
   the Portal already has an override (so it can still be undone after the others are
   archived). Editing happens in the portal editor's Look section, next to the live
   preview, with the per-Portal autosave. The Property look page keeps its name and
   becomes the look every Portal starts with; its rail shows which Portals own which
   groups and links to each one's Look section. A Property Manager sees the facts and
   the name of who can change them, never a disabled control. "Start from another
   portal" copies the source's own look row in the same commit as the new Portal (the
   same Property's asset references, descriptions filtered to the new Portal's languages,
   look version one above the Property's, no fence because a new Portal has no snapshot).
   The copy does not depend on the flag: a row that exists is read and published whatever
   the flag says, so a copy shows what its source shows.
10. **Media.** The new references join the Brand Profile's and a link's as reference
    sites of ADR 0063 decision 5: `portal_look_overrides.hero_asset_id` and
    `logo_asset_id`, written only after `findReferencableMediaAsset` against the
    Portal's own Property. The hourly sweep's unreferenced check gains the override
    clause (correlated on organization and Property); the RESTRICT keys stay as the
    backstop. The 200-image cap is now shared by the Property look and its Portals'
    own photos and logos. A takedown is unchanged and still Property-level: an own photo
    that is taken down reads as no photo, and the runbook lists the Portals it affects.
11. **Tenant lifecycle.** The table has a data-fate row (`erasable_source_content`,
    POR-01/LIF-01), an Organization export collection (`portalLookOverrides`, explicit
    columns, descriptions as text) and a place in the purge plan and the scrub: after
    `portal_localized_overrides` and before the brand contents, profiles, media assets and
    Portals, in foreign-key order. It is a child of Portals, so the lifecycle count (which
    counts root tables only) does not name it. Integration suites that seed override
    rows list the table ahead of `portal_media_assets` and `portals`.
12. **Dark launch and the kill switch.** `PORTAL_OWN_LOOK_ENABLED` (`true` or `false`,
    default `false`, any other spelling refuses boot) is read by web. The reader ships
    live and applies rows that exist; the writers refuse with `feature_unavailable` and
    the Look section shows today's read-only view until the flag is on. It is switched
    on once web and worker both run the release, so no server that ignores overrides can
    ever meet an override row; the worker reads the working copy for the completeness fact
    and the legacy republish and needs no switch. Turning it off again is a kill switch:
    existing rows keep being read, previewed and published correctly. **Never roll the
    code back past the reader while override rows exist:** an old reader would publish
    the Property look for those Portals on their next publish. Recovery is forward-only
    anyway (runbooks §28); if a code rollback were ever unavoidable, switch the flag off
    first and accept that. Live snapshots are immutable and unaffected, and the table is
    inert for old code. The migration is purely additive and is never reverted.

## Consequences

- A Portal that owns a group never shows a pending change for a Property edit to that
  group. Before this decision a look edit fenced every Portal that had a snapshot, so
  the overview's pending counts shrink as Portals take ownership.
- Property look writers do a little more work per save (a follower query and one bulk
  update of the followers' versions), under a lock they already held; with no override
  rows it is the same fence set as before.
- A Portal's print is its live look, so two Portals of one Property print different
  palettes, photos and logos with no code change. There is no warning that a changed
  colour or logo makes the last print differ (D9); "Last printed" already compares the
  effective photo.
- A legacy v1 or v2 page picks up an own look only after the Portal is republished as v3.
- Archived Portals keep their rows (D12), so an archived or deleted Portal's own photo
  and logo stay referenced, are never swept, and count toward the 200-image cap until
  an Organization purge. This is accepted at beta scale; a later release can null the
  references on archive.
- `og:image` stays a root-relative address, as it was.
- A Portal's own look edit is published from that Portal's own Review & publish, where
  its lines read "Look · changed this portal's photo". In the Property look batch it is
  one more draft edit, not part of the look being adopted.
- The flag is the one release control, and its rollback rule is the reader rule above.
- Out of scope, each an owner decision or follow-up: named looks and group looks (D8), a
  text colour, a light page or fonts (these need a v4 snapshot, D7), a per-Portal display
  name, a picker to reuse photos already uploaded, and a print warning for a changed
  colour or logo (D9).

## Rejected alternatives

- **One switch for the whole look (detach).** A Portal would give up the Property's
  colours the moment it chose its own photo. Per-group ownership keeps later edits
  flowing to the groups it did not choose (D2).
- **A v4 snapshot with per-Portal look fields.** It would need a reader-first release,
  a new digest shape and a legacy renderer decision, to carry values the v3 `brandProfile`
  already holds. Materialising the effective look at publish keeps every guest path,
  the verifier and the goldens as they are.
- **Resolving the look when a guest opens the page.** A snapshot is immutable evidence
  of what a guest was shown; resolving at read time would let a later edit change an
  old page.
- **Columns on `portals` or on `portal_localized_overrides`.** `portals` already carries
  unused legacy look columns (`theme`, `hero_image_url`) and `portal_localized_overrides`
  is per-language wording; neither is a place for a Portal-wide look. A new 1:1 table
  leaves every existing table, row and CHECK alone and is inert for old code.
- **A second Brand Profile row per Portal.** It would duplicate the display name and
  `version` that AI reply drafts fence on, which must stay one authority.
- **A new ledger kind such as `portal_look`.** It would restate the CHECKs of the
  page-edit and pending-change tables inside the migration transaction, and an older
  server would drop the row it did not know. `portal_configuration` with `look:<facet>`
  keys degrades to "Page settings".
- **Backfilling a row for every Portal.** It changes nothing a guest sees and would put
  every Portal at risk of a version, digest or pending-change difference; "no row" is the
  follow-everything state.
- **Fencing every Portal on a Property look edit, as before.** A Portal that owns the
  group would be asked to republish a change it cannot show.
- **Nulling a Portal's own photo and logo when it is archived.** An archived Portal
  could not be restored with its look, and the references are cheap (D12).
- **Property Managers editing their Portal's look.** Uploading the photo and logo is
  Account Admin only; a manager could change colours while every upload failed.
  Tightening later would take away what managers had used.
