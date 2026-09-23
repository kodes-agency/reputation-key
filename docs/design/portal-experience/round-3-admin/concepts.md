# Admin concepts and judging

Three independent concepts were written from different angles, then scored by three judges. This file keeps them for reference; the chosen design is in [README.md](README.md).

## Portal Workspace: Refined Sections, completed

A property manager who visits the portal admin now and then usually comes for one of four jobs: change what a place says, get a code onto a table, check that it is working, or fix something that broke. Each job gets one tab in a single workspace per portal: Experience, Share, Analytics, Activity. On the two tabs where the guest page matters, the real guest page sits beside the controls at true phone width. It is rendered by the same resolver guests hit and comes from either the draft or the live version.

The section editor the owner preferred stays as the backbone: flat rows in guest order that expand in place. It gains what Refined Sections lacked:

- a truthful draft and live preview covering every guest state, plus a view that puts 1 star and 5 stars side by side to prove Google is offered the same way;
- one autosaved draft with a single 'Review & publish' dock;
- a review step written in guest words that names who can fix each blocker;
- publishing while live, with an append-only restore ledger;
- a Share tab that ends in a print kit instead of a PNG.

Above the workspaces, the Portals overview is a quiet list of places. It shows health only when something is wrong, draft and live facts, and the five honest measures for each portal and each group. It tells the manager which place needs them and never ranks places. The property-wide look (composition, three colours, fallback wording, trusted destinations) is edited on one Account-admin page. That page shows which portals a change affects and never changes a live page silently.

Everything follows the inbox's visual language: neutral ink and hairlines, facts that look different from controls, purple only where you can click, one primary action per area, and a ledger of everything that happened.

**Editor model.** Refined Sections, made flat and tied to a truthful preview.

**Structure.**

- Six sections in two labelled groups:
  - on the guest page, in guest order: Look, Welcome, Rating and Google, Useful links;
  - behind the page: Languages, Place and group.
- One section is open at a time, and its fields open in place under a #e7e4ff header. No section has a box.
- Each row states its scope as a fact: 'This portal', 'Property-wide' or 'Always included'.

**Saving.**

- One shared draft per portal, autosaved per field after 800ms.
- Three save states in the dock: 'Saving…', 'Draft saved · 1 min ago', and 'Couldn't save · Retry'. A failed save keeps the local text and stops publishing until the save succeeds.
- Removing a link or turning off a language is a draft operation with Undo in the toast. There are no red buttons beside ordinary edits.

**Inheritance.** Each localized field is either 'Using property wording' (read-only text plus [Write for this portal]) or an override with a 'Use property wording' reset, which sets the override to null. When languages differ, the editor says so: 'English is custom; Bulgarian uses property wording'.

**Languages.** One EN/БГ switch drives both the fields and the preview. Native language names are used, never flags. Enabling a language never implies its wording is approved.

**Links.**

- Labels in EN and BG; icons from a curated iconKey set.
- Approval state is shown in place, and only when a link is not live-eligible. Today unapproved links are dropped silently.
- Drag plus Move up and Move down (WCAG 2.5.7).
- A soft cap of 4 visible links.
- 'Group under headings' is off by default. Folio uses the headings in its index.
- A Property manager can request a destination from the link row. Approval stays with the Account admin.

**Not editable, shown as read-only facts.** The question, buttons and receipts from language pack v2, and the display name.

**Preview.**

- The public renderer runs in an iframe, fed by a new 'working copy as guest DTO' read, or by the 'snapshot as guest DTO' read for Live and for older versions.
- It follows the same resolution rules as the guest page: localized title fallback, brand profile, composition fonts, approved-link filtering, and the degraded Google state.
- In edit mode it is inert: one tab stop, labelled 'Guest preview: Reception, draft, arrival, English'. It becomes interactive only in Try as guest.
- Section and region are bound both ways, as a pointer shortcut. The keyboard path is the section list.

**Concurrency.** Field-level last-write-wins. The dock names another editor who saved within 5 minutes ('Georgi edited 2 min ago'). A property look change arrives as a toast plus a pending change.

**Accessibility.** Targets are 32px on desktop and 36px on phone. Focus is never hidden under the dock (scroll-padding-bottom 72). Every icon-only button has a name.

**Publishing.** **States**, shown as facts, never as a toggle:

- Draft (never published);
- Live · version N;
- Paused (today's 'disabled');
- Archived.

The header always shows the live version and the number of changes that are not live yet. Today's 'Publish portal / Disable public page' toggle is removed.

**Publish changes.** A new snapshot plus an atomic activation swap while the portal is live. This is a new command, because published to published is a no-op today and forces disable-then-republish with an outage. Versions are numbered and only go up.

- Publishing always goes through the review step. The only multi-portal publish is the batch review after a property-wide change or a new guest wording pack.
- A language change and a publish are sequenced out of sight: the languages are saved first, then the portal is published.
- The existing content-review attestation stays separate, in Activity.

**Restore (rollback).**

- Uses the existing `rollbackPortalPublication`: only while live, and only to a lower version.
- It appends version N+1 as a copy and never rewrites history.
- It re-runs the checks on the target first, so lapsed link approvals or a broken Google link are shown before confirming.
- It leaves the draft alone, with the fact 'Your draft is based on version 6; live is version 7 (a copy of version 4)'.
- It offers Undo, which is another append.

**Pause, archive, restore.**

- 'Pause public page' sits in the header overflow. Its dialog shows the brand-free 'not available' page guests will get. The pause goes in the ledger, and codes stay valid.
- Archive makes the configuration read-only and keeps the codes.
- Restoring from the archive returns the portal as Paused. A separate publish is needed.

**Property-wide changes.**

- A look or fallback-wording save becomes a pending change on every affected draft ('Look changed · not live') and never mutates a live snapshot.
- The look page then offers a batch review that lists each portal's own diff and checks.
- A new guest wording pack works the same way: 'New guest wording' is pending on each live portal, and the review shows the EN and BG string diffs.

**Deferred.** Scheduled publishing. If it is added later, it schedules a reviewed snapshot and re-runs the checks when it fires.

**Analytics.** **Frozen vocabulary.** Each label has a dotted-underline definition.

- Qualified scans (`qualified_scans`): server-verified QR or NFC arrivals, deduplicated.
- Private ratings (`portal_rating_count`).
- Average private rating (`portal_rating_average`), always shown with its n.
- Guests who opened Google: Google selections only, filtered by `portal_destination_kind`.
- Private notes (volume), shown with a lock glyph and the word 'private'.
- Useful links opened: a secondary figure.

Never used: 'Reviews', 'Review clicks', 'Conversions', 'CTR'. Today's bounded-window 'Scans' actually counts operational `portal.scan` while All time counts qualified scans. Every admin figure moves to qualified scans, which needs a bounded-window qualified read.

**Portal scope (the Analytics tab).**

- A five-cell strip in guest order.
- A 'From scan to Google' funnel with real counts and % of scans, never clamped. Private notes appear beside it, not as a step.
- Weekly scans with the average-rating line, and version ticks so owners can line up changes with outcomes. No causal claims.
- Rating mix.
- The useful-links figure.
- Private notes link to Inbox Feedback filtered to the portal.

**Ranges.** The app-wide `?range=` model: 30 days · 90 days · 6 months · All time, default 90 days. This replaces the tab's own 7/60-day presets, its All-time default and its localStorage. The range is the same across the dashboard, the overview and the workspace.

**Comparison.**

- Deltas are shown only for bounded ranges, against the equal prior window.
- The average compares only when both periods have at least 10 ratings. Below that there is one sentence, one action, and n beside the value.
- Deltas use a sign and an arrow in text-grade positive or negative colour. A metric that is not ready gets the availability line. Provenance ('Data through', response integrity, reconciliation) sits in details, never above the numbers.

**Portfolio.**

- The Portals overview table is the property portfolio: per-portal columns, group rollup rows and an 'All portals' total.
- Group analytics reuses the Analytics layout at group scope.
- `/portals` rolls up by property.
- Rollups count issues ('1 of 4 needs attention') and never blend a status.
- Averages are rebuilt from counts, with n.
- These scopes need new reads. Scans, notes and Google opens can sum across portal-scope reads. The property and group average needs either a widened registry scope for `portal.rating` (a governance decision) or a wrapped `queryGoalMetric` (monthly only).

**Guardrails.**

- No rank numbers, medals or 'top/bottom' labels. The default sort is attention, then name.
- Google opens are never split by star.
- No staff, shift or server dimension. The staff-participation data is never read.
- No uptime or 'live' vanity counters.

**Later:**

- QR versus NFC split (needs a retention decision);
- per-link selections;
- a weekly digest to responsible managers with the same five measures and n;
- CSV export.

**Monitoring.** **Health in plain words.** The domain values `healthy`, `degraded` and `unavailable` become 'Working', 'Partly working' and 'Not reachable'. Each reason gets a sentence, an owner and one fix:

- `responsibility_needed`: 'No one is responsible for this portal'. Fixed by anyone with `portal.update`: Assign a manager.
- `google_destination_awaiting_refresh`: 'Google link is refreshing. Guests can rate; the Google action says it can't be opened from here'. Nothing to do. Account admin: Open Google connection.
- `google_destination_unavailable`: 'Guests can't open Google from this portal'. Account admin: Reconnect Google.
- `public_address_unavailable`: 'No active code'. Property manager: Create code.
- `property_unavailable`: 'Avela Resort is paused'. Account admin.
- `publication_snapshot_unavailable`: 'The live version couldn't be loaded'. Publish again, or contact support.

Draft, Paused and Archived are publication states, not incidents. They never count as 'needs attention'.

**Where health shows, by exception.**

- The overview's Status column stays quiet when a portal is healthy.
- It gets a second line in #a45f00 with a glyph and words when not.
- A 'Needs attention' strip cell filters the list.
- Group and property rows count issues.
- Property-wide causes, such as the Google link, are shown once above the table with the number of portals affected, instead of being repeated on every row.
- Dashboard › Overview gains one attention chip.
- The workspace header gets a health fact, and the Activity tab gets '· 1 issue'.
- The Activity tab lists every failing check, not just the domain's single top reason, by reusing the review checks.

**History.** Health transitions become ledger events ('Google link became unavailable · 14 Sep 09:12'; 'Working again · 11:40'), folded when routine. RepKey does not probe portals, so there is no uptime percentage.

**Ownership and notifications.**

- Responsible managers are the route. The Activity tab shows them, and 'Change' edits them.
- `portal.health_attention` gets a template that names the reason and the fix and deep-links to Activity.
- `portal.responsibility_needed` goes to Account admins.
- Private notes arrive through `feedback.created` in the Inbox, which gains a portal facet.
- Each person tunes their own notifications in the existing Settings › Notifications categories. `urgent_operational` stays unmutable in-app. There is no second alert threshold competing with the Private Feedback Threshold.
- A new 'Ask an Account admin' request, in the `workflow_collaboration` category, covers blockers only an Account admin can fix.

**To verify before trusting 'Working'.** There is no health reconciliation on token revoke or when a grace period expires. A proposed advisory check would cover approved destinations that lapse and are silently hidden.

**Later.** A careful silent-failure hint, 'No scans in 14 days at a portal that usually has some; check the card', that never becomes a target or a comparison.

**Risks.** **1. Preview drift destroys trust.** The whole concept rests on 'what you see is what guests get'. The admin preview must use the public renderer and resolver rules exactly, not a lookalike.

- Mitigation: one render path.
- Mitigation: visual regression that pins preview against /p for every state, composition and language.
- Mitigation: an admin-only 'hidden from guests' line, so filtering is visible rather than surprising.

**2. Hard dependency on publish-while-live.** Without the new command, 'Publish changes' would have to disable and republish, which causes the outage it promises to remove. Do not ship the workspace before the command exists.

**3. Measure mismatch.** Bounded-window 'Scans' today is operational `portal.scan`. Labelling it 'Qualified scans' would be dishonest. All admin figures need the bounded-window qualified read, and the fleet's scanCount must not be relabelled.

**4. A sortable portfolio can still be read as a ranking.**

- Mitigations: default attention-then-name sort, no rank numbers, medals or best/worst tint, and no cross-property 'top' copy.
- Accept: a user can still sort by average. That is an ordinary table affordance, not a leaderboard.

**5. Placement naming can leak staff attribution** ('Maria's tables'). Free text cannot be fully policed.

- Mitigations: a fixed place type, the helper 'Name a place, not a person', admin-only labels, and no per-person analytics dimension ever.

**6. Property-wide changes surprise managers who are editing.** Their preview changes under them. Mitigations: a toast in open workspaces, a ledger line, a pending-change fact, and the Live toggle to compare.

**7. Batch publish can feel like silent mass change.** Mitigation: per-portal diffs and checks with opt-out checkboxes. Otherwise fall back to one review per portal, which is a decision.

**8. Account-admin bottleneck in the beta.** Few Account admins own the look, the fallback wording, destinations and the Google connection. Mitigations: the needs_admin setup state, 'Ask an Account admin' requests naming the item, and the Waiting-for-you queue.

**9. Shown-once versus reprint.** Without a re-download decision, managers will rotate codes just to reprint, which breaks existing prints. Escalate the security decision early.

**10. Health can lie.** It may still say 'Working' after every code is revoked, if the reconciliation gap is real. Destinations that lapse vanish silently today. Verify both before health is marketed as monitoring.

**11. The workspace switch from standard page to icon rail may disorient occasional users.** It is consistent with the Inbox. Verify with 3 to 5 property managers on a moderated task: 'change the spa welcome line and republish', 'reprint the reception card'.

**12. Performance.** Composition fonts (about 95KB for Carved Stillness) inside an iframe, preview refreshes and a batched list projection must stay inside the app-page budget. Mitigations: debounce, keep the iframe alive across tabs, and cache the per-property font subsets.

**13. Scope creep.** Scheduling, per-link analytics, QR-versus-NFC splits and digests are deliberately deferred. The workspace must read as finished without them.

## Portal Desk: running portals like inbox cases

An operator's real job is not designing pages. It is keeping 10 to 200 live guest pages healthy across properties and changing one now and then. So portal administration becomes the inbox again, and each portal is a case.

- The rail answers two questions. "Where" is the property (or All properties), then a portal group. "What state" is one of the queues: Needs attention, Unpublished changes, Mine, Live, Drafts, Paused, Archived.
- The list uses fixed 78px rows that show exceptions first.
- The detail pane reads like an inbox case:
  - A facts toolbar: Live · version 4, Draft · 3 changes, codes, owners, group.
  - Attention lines, each naming one fix and who can do it.
  - A 30-day strip of vital figures.
  - A ledger of publications, restores, health changes, code events and brand events.
  - A draft dock at the bottom, the twin of the composer dock. It holds the pane's one primary action, Review & publish.

Three things happen outside the case. Editing is a mode you enter and leave: a focused studio (the owner's Refined Sections, made flatter) beside a device preview that shows exactly what guests see. Reading performance happens in one honest report written in the dashboard's grammar. Brand has its own Account Admin studio. Its changes wait in each live portal's draft, and the affected portals are listed.

Two guarantees hold throughout. Only a deliberate publish changes what guests see. Nothing in the admin can make Google depend on the score.

**Editor model.** The studio edits only what guests see. Operational things (managers, group, codes, pause and archive) stay on the case. Layout: a 480px column of sections on the left, a preview stage on the right, and one save state in the header.

Fields map honestly to what guests see:

- The wordmark is the property display name (property-wide).
- The h1 is the Welcome line: the portal's localized title override, or the property wording when the override is empty.
- The description is the short-description override.
- The question, stars, buttons, receipts and privacy line come from the immutable guest copy pack. They appear as read-only facts, with no invented editable question and no character counters.
- The portal name and description are internal, and the UI says so.

Scope is shown on every field:

- "This portal": autosaves to the working copy through the existing update commands.
- "Using property wording · Write your own", and its reverse reset "Use property wording" (null falls back to the property wording, as the model does). There is one reset per field, never two.
- Property-wide items (composition, colours, display name, fallback wording) are read-only here and open the Property brand studio. They never autosave, because they fan out to other portals.

Sections, in order:

1. Welcome.
2. Useful links:
   - localized EN/BG labels (new);
   - icons from a curated iconKey set (new);
   - approval status in place: Approved / Waiting for Account Admin / Lapsed, not shown to guests;
   - keyboard Move up / down next to drag;
   - a soft cap: "Guests see the first 4";
   - Tripadvisor and Booking only as plain "Find us on" rows, never styled as a review ask;
   - Remove is a draft edit with Undo.
3. Private note: "Offer a private note at N stars or below", with the tooltip "Google stays the same for every guest". There is no second alert threshold and no toggle for Google visibility.
4. Languages: primary EN or BG plus at most one more; per-locale completeness facts; the English original shown under Bulgarian fields; machine drafts marked "not reviewed"; native language names, no flags.
5. Look: read-only composition and colours.
6. Guest wording: read-only, with the pack version.
7. Internal: name, description, slug.

Preview:

- It renders the working copy, or any snapshot, through the real /p renderer as a guest DTO (a new read), in the property's composition and self-hosted fonts, at 390 or 320.
- It never recolours the admin.
- Compare Draft | Live v4.
- The state menu covers every guest state, including Google temporarily unavailable, code no longer active, paused, and the 1★ / 5★ pair.
- Clicking in the preview selects the matching section (a shared outline). It is not a WYSIWYG canvas, and keyboard users get the same selection from the section list.

Try as guest is a separate mode (screen 6). It writes nothing and never navigates to Google.

Save states: Saving… / Draft saved / "Couldn't save · Retry". A failure keeps local work and never leaves a way to publish that would look successful.

**Publishing.** Two plain facts are always visible on the case and in the studio:

- "Live · version 4 · published 12 Sep by Maria Petrova"
- "Draft · 3 changes not live" (or "Matches live version 4")
  The working copy autosaves. Guests only ever see immutable snapshots.

Publishing changes while live (new command):

- Moving from published to published builds snapshot N+1 from the working copy and swaps the activation atomically. There is no disable-and-republish outage, and the stable token keeps resolving to whatever is live.
- The success toast carries the guarantee: "Version 5 is live. Printed codes keep working."
- A digest guard refuses the publish if the draft changed after the review was opened.

Review before every publish (screen 7):

- A guest-worded diff per locale (a new field-level diff read).
- One checklist built from the domain preconditions (property active, verified Google link, responsible manager, codes, brand profile and content per locale) plus the new colour gate. Each item names who can fix it.
- Non-blocking items are stated, not hidden, for example "'Spa menu' is waiting for approval, so it publishes without it". Today unapproved links are dropped silently.
- An honest consequence of the current rules: while the Google link is unverified, no portal at that property can publish changes. The attention line and the review both say so. Whether to relax this is a product decision.

Restore, grounded in rollbackPortalPublication:

- Restoring re-activates an earlier snapshot. Version 3 stays version 3, with a new activation; nothing is renumbered or deleted.
- The ledger reads "Ivan Georgiev made version 3 live again · replaced version 4".
- The dialog re-checks the target: lapsed links, the Google link.
- The draft is untouched, so after a restore the dock shows v4's content as not live, with no surprise.
- "Undo" (making v4 live again) needs one rule change: today the target must be lower than the active version.

Taking a page offline is rare and lives in the ⋯ menu, never beside the primary:

- Pause public page shows a preview of the brand-free "not available" page. Resuming publishes the current live version again.
- Archive: codes stay valid and show "not available". Restore returns the portal as Paused.
- Discard draft changes (new) resets the working copy to the live version.

Property-wide changes:

- Brand, fallback wording and a new guest-copy pack become pending changes on every affected portal's draft.
- Never-published drafts pick them up at once. Live portals wait for a publish.
- The batch review (screen 11) publishes each portal as its own version, with its own checks. It warns when a portal's draft also carries local changes nobody has reviewed, because the working copy is all-or-nothing.

The content-review attestation stays its own concept: ⋯ "Record a content review…", with a ledger entry. It is never a score or a badge.

Ledger vocabulary (actor · verb · object · time; system events use sm indicators; runs of three or more fold):

- created
- published version N · what changed
- made version N live again · replaced version M
- paused / resumed
- archived / restored as Paused
- property brand changed · waiting here
- new guest wording available · not live
- Google link became unavailable / back to normal
- manager added / removed
- codes issued / replaced (old code works until …) / revoked (reason)
- print kit downloaded
- link approved / link lapsed, not shown to guests
- moved to group
- content review recorded
  The actor comes from the stored activatedBy, which the history read currently drops.

**Analytics.** Vocabulary, frozen and defined on demand (dotted-underline details open one-sentence definitions):

- Portal scans = qualified_scans (server-verified QR/NFC arrivals, deduplicated per session and portal over 24h).
- Private ratings = portal_rating_count.
- Average private rating = portal_rating_average, always printed with n ("4.6 from 180").
- Guests who opened Google = Google selections only. It is a click, never a review.
- Private notes = private feedback volume, deep-linked to the Inbox Feedback queue filtered by portal.
  Never used: Reviews, Review Clicks, Conversions, CTR, Scans for the unqualified portal.scan measure.

Where numbers appear:

- The case vital strip: fixed "Last 30 days", because it is a monitoring window.
- List rows: "412 scans · 4.6 from 180 · 30 days".
- Performance (screens 12 and 13): the chosen ?range= (30 days · 90 days · 6 months · All time), shared with the Dashboard so switching pages never changes the period silently. The default follows the Dashboard (90 days), so there is one contract. Portal analytics' own 7d/60d presets and the localStorage default are retired.

Funnel in guest order: Portal scans → Private ratings → Guests who opened Google.

- Bars show true widths and real counts, with "% of scans" (and "% of rated guests" for the last step). There is no clamping to make it look monotonic.
- Private notes sit beside the funnel as a count ("offered at 3★ or below"), never as a step.
- Google opens are never broken down by star, anywhere.

Comparison and small samples:

- Counts compare as absolute differences ("+38 vs prior 30 days"), never percentages. Portal-level numbers are small, and "+100%" on 3 → 6 is noise.
- Averages are withheld below 5 ratings: "3 private ratings so far, too few for an average".
- Averages compare only when both periods have 10 or more private ratings (the existing floor): "+0.1 vs prior (from 540)".
- Otherwise one sentence plus one action, "Too few ratings to compare periods. Widen the range." Never a dash, never a fake 0.

Portfolio vs portal:

- Property scope: a strip, the funnel, trends, the rating mix, and the portals table with group roll-up rows.
- Group scope: the same page with ?group=; the rail's group row is active.
- Portal scope: adds version rules on the trend and a Useful links selections table.
- Org scope: property rows with roll-ups.
- There is no ranking at any scope: no rank numbers, no top or bottom labels, the default sort is by name (grouped), and nothing is ever sliced by owner, manager, staff, shift or server.

Availability by exception: "Filling in · first scans are still being counted" appears only when evidence is not ready. Provenance (data through, completeness, response integrity) sits in a closing "About these numbers" details, never above the figures.

Gating: every portal number requires dashboard.use and is hidden (not locked) without it, matching the existing gate. Goals keep the same three measure names, and a portal with a Goal Program links to it from Performance. Progress bars never appear on the case.

**Monitoring.** Health by exception. Healthy portals are quiet: a neutral dot and no words. Anything else is a 13px fact that pairs a glyph with words, never colour alone. Engineering codes never reach the UI.

Each domain reason translates into a sentence, who can fix it, and one action:

- degraded · google_destination_unavailable → "Google link unavailable" · Account Admin · [Open Google connection]. It affects every portal at the property, so in All properties scope it is stated once on the property subheader. It blocks publishing.
- degraded · google_destination_awaiting_refresh → "Google link is being re-checked" · nobody (system) · no button. The detail "What guests see" opens the Google-unavailable preview state. It blocks publishing.
- degraded · responsibility_needed → "No one is responsible for this portal" · Account Admin or PM · [Choose manager]. It blocks publishing, and Account Admins are notified.
- unavailable · public_address_unavailable → "No active code; scans land on 'not available'" · Account Admin or PM · [Issue codes].
- unavailable · property_unavailable → "Avela Resort is paused, so its portals are offline" · Account Admin · [Open property].
- unavailable · publication_snapshot_unavailable → "The live version can't be shown" · Account Admin or PM · [Publish again].
- publication_draft, disabled and archived are intentions, not problems. They live in the Drafts, Paused and Archived queues and never in Needs attention.

Derived attention (not domain health, but guests are affected):

- A link on the live version lapsed or is waiting for approval: Account Admin [Review link]; a PM sees "Waiting for an Account Admin".
- A legacy code whose scans are not counted: [Replace code].
- An old code that stops within 7 days: a fact.

The domain returns one reason at a time, by precedence. The case therefore runs the full readiness checklist and lists every failing check as its own attention line. The rail count uses the server predicate.

Where health shows:

- the Needs attention queue (server counts);
- the row gutter glyph and the signal words on the row;
- attention lines on the case;
- a triangle on group rows in the rail;
- the Performance table's Health column;
- one attention chip on the Dashboard Overview;
- the Portals column on the All properties list.
  There are no stacked banners.

Ledger history: health transitions become sm events ("Google link became unavailable · 14 Sep, 09:12", "Back to normal · 15 Sep, 10:02"), read from the existing health intervals (listHistory has no caller today). Routine runs fold. There are no uptime percentages, because RepKey does not probe portals and the figure would be invented.

Owners and notifications:

- Responsible managers are the route. Each case shows owner discs as a control.
- portal.health_attention names the portal, the reason and who can fix it, for example "Spa reception: Google link unavailable. Only an Account Admin can reconnect Google." It deep-links to the case, not the old Settings tab.
- responsibility_needed keeps going to Account Admins.
- A new quiet in-app notification, "Spa reception is back to normal", folds in the bell.
- Settings › Notifications gets per-person presets for "Portals I'm responsible for": Health issues on/off, Private notes on/off.
- There is no per-rating alert and no second threshold. Private notes already follow the Private Feedback Threshold into the Inbox.

Needs verification first: health must reconcile on code revocation and grace expiry (today no consumer is known), or "quiet" becomes "silently wrong".

Later, as a soft hint only: "No scans in 14 days at a portal that usually has some · Check the card is still in place". It is never a target or a comparison between portals.

**Risks.** 1. The workspace can feel heavy for small properties. Most beta properties have 1 to 5 portals, and three panes for two rows can feel like overkill. Mitigation: with one portal, open its case directly; the list stays short and quiet; creation never starts in the workspace grid. 2. Monitoring depends on a new health read. If health is stale (for example, codes revoked without reconciliation), "quiet by exception" becomes "silently wrong". The batched projection, and reconciliation on revoke and grace expiry, must ship before the queues are trusted. The case detail should expose the "checked at" time. 3. Publish while live is a new domain transition, and batch publish multiplies it. It needs an ADR covering concurrency with property-wide fan-out, version numbering, and the reviewed-digest guard. 4. The working copy is all-or-nothing. A batch brand publish also ships any unreviewed local edits on that portal. The design surfaces them and forces a look. Staging per change would be a much larger model change. 5. A verified Google link is a publish precondition. While Google is unavailable at a property, no portal there can publish even an urgent wording fix. The design states this, but product may want to relax it. 6. Codes are shown once. Without a download-again decision, reprinting means rotation. Print kits at issue time soften this but do not solve lost files. 7. Honest analytics depends on new reads. Bounded-window "Scans" today is portal.scan, not qualified scans, and private ratings are portal-scope only in the analytics registry. If B6 and B7 slip, Performance must ship with monthly or lifetime figures only, or with an honest different label, never the old ones. Widening the registry is a governance decision. 8. Ranking creep. Sortable portfolio tables, deltas and owner discs on rows can be read as a leaderboard or as staff attribution. Guards: default name order, no rank numbers, counts as absolute differences, and never slicing metrics by owner. Reviewers must reject regressions. 9. Scope in the rail. Two rail sections (queues and groups) plus footer destinations (Performance, Property brand) are more than the inbox has, and some users may not understand that a group is scope while a queue is state. Test this with the scope line "Avela Resort › Spa ×". 10. One composition per property may not fit hotels with restaurant or pool-bar placements. A per-portal override is deferred and needs an Account Admin decision. 11. Permission mismatches (link removal, archive) must be resolved first, or PMs will hit 403s behind clean UI. 12. Delivery size: four new surfaces. Proposed phases: - P1: workspace, case, ledger, restore and checklist (mostly A reads plus B1–B3); - P2: publish while live, the studio with a faithful preview, try as guest; - P3: Brand studio, compositions, derived tokens, print kits, batch publish; - P4: Performance on the new bounded-window reads. 13. Test scans and notification noise. Admin test scans may inflate qualified scans. Health notifications for transient Google refreshes could train people to ignore the bell, so re-checking is not notified, only unavailability. 14. Mode confusion. Performance sits in the Portals area while the Dashboard also shows a portal line. Keep the Overview to one chip and one tile that link in, never a second analytics page.

## Brand and Journey Studio

Start with the property's guest identity, because that is where the owner's pride is and where Ratestar is weakest. An Account Admin sets the identity once per property. It is one of three curated compositions (Carved Stillness, Folio, Table Card), drawn live in the property's own three colours, and every derived colour role is checked and fixed before anyone can publish. Every portal inherits that identity and adds only what belongs to its place: a placement line, a description, useful links, languages and the private-note threshold.

Editing follows what guests actually see, one journey state at a time. The 1★ and 5★ after-rating screens always sit side by side, so the identical Google card is visible proof, not a promise. A change reaches guests only through a reviewed publish that shows every state in English and Bulgarian and names who can fix each failing check. Printed codes survive every change. Every portal ends in a print-ready kit drawn in the same composition, so the table tent and the page are one design.

The admin itself stays neutral and purple and follows the inbox: hairlines not cards, facts versus controls, one primary action per area, one ledger per portal, and silence when things are healthy. It is optimised for an Account Admin running several properties, and for a three-minute sales demo against Ratestar:

1. Paste the prospect's three colours and see three finished, readable pages.
2. Pick one; every portal inherits it.
3. Open After rating and show 1★ and 5★ with the same Google card. Ratestar's shipped code redirects 4 and 5★ ratings after 200 ms.
4. Switch to Bulgarian and show real Cyrillic type, where Ratestar's flag pill leaves mixed-language pages.
5. Download a true-size table tent.
6. Show a funnel that says "Guests who opened Google", not "reviews".

**Editor model.** The Journey Studio edits by guest state, not by form section. The states are Arrival · After rating · Private note · Done and links · Google unavailable · Page unavailable, plus an All states contact sheet.

**The board**

- It shows the real guest renderer inside neutral device outlines at 390 or 320.
- The renderer is the shared v2 component, isolated from app tokens and dark mode.
- Its fonts are lazy-loaded in the Studio only, to protect the app's bundle budget.

**The fairness pair**

- After rating always defaults to two frames, "Rated 1 of 5 · Poor" and "Rated 5 of 5 · Excellent".
- A dashed neutral guide crosses both frames at the identical Google card.
- The private-note card appears only in the low frame.
- Each frame's rating can be changed.
- Optional states are labelled by when they appear ("only when a guest adds a note").
- There are no arrows, branches or "if rating" rules anywhere, so the Studio can never read as a routing builder.

**The inspector** (360px) holds only what the state lets you change:

- Placement line and short description per locale, with a scope fact ("This portal" versus "Property-wide") and one "Use property wording" reset.
- The threshold, in the Private note state, labelled "Offer a private note at 3★ or below", with the helper "Google stays available to every guest".
- Links:
  - English and Bulgarian labels.
  - A curated icon.
  - Approval status in place.
  - Keyboard Move up / Move down.
  - At most 4 visible.
  - Undoable removal.

Fixed guest wording (question, buttons, receipts, the Google card) shows as read-only facts that name the wording-pack version. Identity items show as facts linking to Identity.

**Behaviour**

- Clicking a region in a frame selects its field, and the reverse.
- One language control drives both board and inspector. "Both" shows English and Bulgarian side by side, and missing Bulgarian strings become warn facts on the rail rows.
- Autosave reads Saving… / Saved / Couldn't save · Retry.
- "Try as guest" swaps in one interactive frame. It records nothing, notifies no one, never counts a scan, and replaces the Google hand-off with an in-frame card. It can also simulate a failed send.

Managers, group, code, name and slug are operations, so they live on Portal home, not in the Studio.

**Publishing.** Each portal has one autosaved working copy (the draft) and at most one live activation of an immutable snapshot.

**Facts in every header**

- "● Live · v4 · 12 Sep, Maria Ivanova".
- "3 changes not live", a detail that lists the changes by kind and author (from pendingChanges).

**The only way to guests**

- Review and publish, then "Publish changes".
- This builds a new snapshot and swaps the activation atomically while the portal stays live. It is a new command: today published→published is a no-op, and admins disable and republish, which causes a short outage.
- The toast carries the guarantee: "Version 5 is live. Printed codes keep working."
- Checks gate publishing, and each check names its fixer.

**Property-wide changes** (identity, property wording, a new guest-wording pack, destination changes)

- They never touch live pages.
- They become pending changes on every affected portal.
- They reach guests through the Identity impact review (a batch with per-row opt-out that discloses other editors' pending work) or through each portal's own review.

**Rollback**

- While the portal is live, every earlier version in the ledger has "Restore".
- The dialog compares the target with live and re-runs the target's checks (lapsed links, Google destination).
- It then appends a rollback activation: "Ivan Kolev restored version 3".
- Nothing is deleted, and the draft keeps its changes.

**Pause, resume, archive**

- Pause (disable) sits in the overflow menu, with a preview of the brand-free unavailable page.
- Resume is a publish with checks.
- Archive can be restored later, and a restored portal comes back as Paused.

**Content confirmation.** The existing attestation stays its own concept: a ledger event plus a quiet fact.

**Pinned versions.** Snapshots pin the guest-wording pack and the colour-engine version, so neither shifts a live page until someone republishes. "Republish to adopt the new wording" is offered by exception.

**Analytics.** **Frozen vocabulary.** Every label has a one-sentence definition on a dotted-underline detail.

- **Portal scans** = qualified_scans in every range. This fixes today's "Scans", which means portal.scan in bounded ranges and qualified scans in All time.
- **Private ratings** = portal_rating_count.
- **Average private rating** = portal_rating_average. Always printed with n, shown only at n ≥ 5.
- **Guests who opened Google** = Google selections only. Never "reviews", "Review Clicks" or "conversions".
- **Private feedback** = notes.

**Funnel**, in guest order, with real, unclamped widths: Portal scans → Private ratings → Guests who opened Google.

- Percentages are "of scans", with the counts beside them.
- Private feedback sits beside the funnel, not as a step, with "Open in Inbox" filtered to the scope.
- Google opens are never broken down by star rating.

**Comparison** against the equal prior window:

- The average compares only when both periods have at least 10 ratings.
- Counts show a percentage when the prior period has at least 10, otherwise an absolute difference.
- Below the floor: one sentence plus one action ("Too few ratings last period to compare. Try 90 days."), never a dash.

**Scopes**

- Property (the default) and Portal group (rollup rows).
- Portal: adds useful-link opens per link, and QR versus NFC later.
- The org portfolio reuses the same columns with property rows.

**No ranking.** No ranks, medals, top/bottom labels, or staff, shift or server dimension. The default order is group then name; at org scope, attention then name. Column sorting stays an ordinary affordance.

**Range.** The dashboard's presets and `?range=` (30 days, 90 days, 6 months, All time), defaulting to 30 days on portal pages.

**Provenance** is on demand. Availability lines ("Filling in · data through 19 Sep, 14:00") appear only when a measure isn't ready.

**Later.** A weekly digest to responsible managers with the same five measures, with n.

**Monitoring.** **Health by exception everywhere.** Healthy portals show nothing. Draft, paused and archived are statuses, not alerts. Each domain reason becomes words, an owner and one fix:

- **responsibility_needed** → "Degraded · No responsible manager". Account Admin or PM: Assign manager.
- **google_destination_awaiting_refresh** → "Degraded · Google link is refreshing". No action; shows since when.
- **google_destination_unavailable** → "Degraded · Google can't be opened". Account Admin: Reconnect Google. The Studio's Google unavailable state shows "Live now", so admins see exactly what guests get.
- **public_address_unavailable** → "Unavailable · No active code". Issue a code, then the print kit.
- **property_unavailable** → "Unavailable · Property is paused". Account Admin.
- **publication_snapshot_unavailable** → "Unavailable · Live version can't be loaded". Publish again, then contact support.

Degraded uses #a45f00, unavailable uses #d00021, and both always carry words.

**Where health appears**

- The overview's attention column and strip filter.
- Group rows, counted rather than blended ("1 of 2 degraded").
- The org portfolio, per property.
- One line on the property Overview.
- Portal home, which lists every failing check (reusing the review checks), not only the domain's single reason.

**Softer facts, by exception**

- A link hidden because its destination lapsed.
- An old code whose grace ends in 5 days.
- Responses under review.

**History.** Health transitions are ledger events. No uptime percentages.

**Notifications**

- portal.health_attention reaches responsible managers with the reason and the fix in the text (today's template is generic) and deep-links to the attention row.
- Account Admins get responsibility_needed and a new "identity needed" notice.
- Each person controls this through the existing per-property preferences, in a new Portals group (Health problems · Private notes; in-app / email).
- No second alert threshold beside the Private Feedback Threshold.

**Later, carefully.** A hint such as "No Portal scans in 14 days at a portal that usually has some. Check the card." It must never become a target.

**Risks.** 1. **Scope of the model change.** Composition plus an alternate on the Brand Profile, a colour engine, snapshot v3 and three renderers is the largest change here. Ship Carved Stillness and Folio first; keep Table Card behind its readiness flag. 2. **Batch identity publish** can publish other editors' pending work. Per-row disclosure and opt-out help, but product must choose batch or per-portal publishing. 3. **The fairness pair could be misread** as a routing builder, or invite "show Google opens by star". Mitigation: no arrows or rules in the Studio, and no star breakdown anywhere. 4. **Preview fidelity.** If the Studio doesn't use the real guest component with pinned packs and fonts, it misrepresents the guest page again, which is today's defect. Studio fonts must stay out of the main bundle budget. 5. **Unresolved security decisions** (kit or token re-download, the draft-on-phone link) block the smoothest distribution. Without them, step 4 must stay "shown once". 6. **Staff test scans** inflate Portal scans unless signed-in sessions are excluded. 7. **Measures need new reads.** Rolling-window qualified scans, and property- and group-scope private ratings, need new reads plus a registry-widening governance decision. Until then, property scope must say "monthly" or wait. 8. **Identity-first can stall PMs.** The neutral default identity, "Waiting for an Account Admin" and needs_admin in setup mitigate this. 9. **Health may stay "healthy"** after every code is revoked, because nothing reconciles on revocation. Verify before relying on it. 10. **Demo bias.** Optimising for the Ratestar demo must not slow the daily PM path; fixing attention and publishing a change both stay two clicks from the overview. 11. **Workspace width.** At 1280 the Studio fits one frame plus the inspector; below 1200 the inspector becomes a sheet and the pair is shown smaller. 12. **Localisation.** Bulgarian print and guest copy ("Rate your visit, privately…") needs native review before any kit ships. 13. **QA surface.** 3 compositions × EN/BG × 320/390 × 7 states × 6 print formats needs generated visual-regression coverage, not manual checks.

## Judging

### Property manager

| Concept        | Score | Strengths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Weaknesses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace      | 8     | Best match for a manager who comes in a few times a month. - **Built from pages they already know.** The overview is a standard page (PageHeader plus the property-list table). The five measures sit on each portal row, so checking results takes one look, with no Analytics trip. - **One tab per job.** The workspace tabs are Experience, Share, Analytics and Activity, one for each thing the manager comes to do. The notification link lands on the failing check. - **Clearest scope of the three.** Every section row states 'This portal', 'Property-wide' or 'Always included'. Each localized field shows 'Using property wording' with a one-click reset. The editor says so when English is custom and Bulgarian inherits. - **Saving and publishing are simple.** One autosaved draft, one dock and one 'Review & publish'. The review is written in guest words. - **Never stuck behind a blocked button.** The primary label is always the next step, e.g. 'Assign a manager' or 'Ask an Account admin'. The 'Ask an Account admin' request, the needs_admin setup state and the 'An Account admin needs to finish the property look… You can still prepare drafts' sentence mean a Property manager is never told to do something they cannot finish. - **Starting a portal takes little thought.** The Place step asks only what it needs: a place card, the prefilled name and an optional group. Slug, theme and threshold are never asked. - **Built for the phone.** The dock is sticky. The preview opens as a full sheet with no device frame. Review is a full-screen step. The print kit goes out through Web Share. - **Fairness has a proof.** The 1★ and 5★ compare view shows the Google action is the same, and the 'Why can't Google be hidden?' detail explains it. - **Nothing live changes silently.** A property look change becomes a pending change plus a toast in an open workspace. | - **The mode switch.** Opening a portal collapses the sidebar to the icon rail. The concept flags this risk itself, and occasional users may feel lost. - **A crowded second header row.** Draft/Live, a state select, EN/БГ and Try as guest all sit over the stage. That is a lot to parse to change one welcome line. Six sections in two labelled groups is more structure than a 2–5 portal hotel needs. - **Restore numbering is confusing and partly wrong.** 'Guests will see version 4 again, as version 7' and 'Undo republishes 6 as version 8' do not match the existing rollbackPortalPublication, which appends a rollback activation of the target version and only to a lower version. Undo also needs an unflagged new command. - **The landing tab changes.** The same name link opens Activity when the portal needs attention and Experience otherwise, which can surprise someone who came to edit. - **Percentage deltas mislead on small numbers.** '↑ 12% vs the 90 days before' reads as a big move at a 60-room hotel with small counts. - **Results are split in two.** Checking results means the overview row for the figures and a separate Activity tab for health and history. There is no single 'how is this portal doing' screen. - **Shown-once codes remain a trap.** Until the security decision is made, the manager may still rotate a code just to reprint ('Replace code to reprint'). |
| inbox-mirror   | 6.5   | - **Already familiar.** The geometry is the Inbox the manager uses daily for reviews: queues, 78px rows, a case pane, and a draft dock that mirrors the composer dock. - **The case is the best single 'is it working, what do I do' screen of the three.** It holds: - attention lines, each naming one fix and who can do it; - a 30-day vital strip; - the ledger; - up to three pending changes in guest words right in the dock, beside Review & publish. - **Small properties are handled.** With one portal, its case opens on arrival. - **Restore is honest.** 'Make version 3 live again' keeps version 3 as version 3, matching rollbackPortalPublication, and it flags that Undo needs a rule change. - **Small numbers are handled well.** - Counts compare as absolute differences ('+38 vs prior 30 days'), with the explicit reason that '+100%' on 3 → 6 is noise. - The average is withheld below 5 ratings. - **Useful safety nets.** - 'Discard draft changes' resets the working copy to live. - A digest guard ('Changed since you reviewed · Review again') protects against a colleague's edits. - A 'Mine' queue. - **Considered notifications.** - Per-person presets for the portals someone is responsible for. - No notification for a Google re-check. - A quiet 'back to normal' notice. - **Clean studio.** Editing is limited to guest-visible fields, each with a scope fact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | - **Too much for this hotel.** A three-pane triage workspace with 7 state queues, a groups section, rail footer destinations and j/k shortcuts is built for an operator with 200 portals, not a 60-room hotel with 2–5. The concept admits it. - **Two places to learn.** Content lives in the studio, while managers, group, codes, pause and archive live on the case. - **Scope versus state in one rail.** Groups are scope and queues are state. The concept flags this confusion itself. - **Results live in three places.** - The case strip is fixed at 30 days. - List rows show 30 days. - Performance, hidden in the rail footer, uses the shared ?range= with a 90-day default. The same portal can show two different periods. - **Always in workspace mode.** The sidebar is collapsed on every Portals page, even for a quick look. - **Phone noise.** The queue pill strip carries 8 pills for 3 portals. - **Creation feels like editing.** The step list runs inside the studio frame, so first-time creation looks like editing and adds a step header to learn. - **Heavy delivery.** Four new surfaces, plus a queue-count server read, are required before the everyday edit is better.                                                                                                                                                                                                                    |
| journey-studio | 5.5   | - **Strongest proof of fairness.** The 1★ and 5★ pair is always shown, with a dashed guide at the identical Google card. - **Most confidence before publishing.** The review contact sheet shows every guest state in English and Bulgarian, with changed regions marked. - **Portal home is a good standard page.** It holds the attention rows with owner and fix, a 30-day strip, the History ledger with Restore, and facts such as 'old code works until 30 Sep'. - **The Property manager is never blocked by the look.** A neutral hospitality default identity is created at property setup, so a missing look from an Account admin never blocks a Property manager's first publish. This is the best answer to the Account admin bottleneck. - **Print is well thought through.** - A property Print kits page with 'Download all kits (ZIP)' and 'Last downloaded'. - A 'Link only' placement that skips print. - A prompt on leaving the distribute step without downloading, which protects the shown-once code. - **A clear creation target.** A new portal should be live and printable in under 3 minutes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | - **Built for someone else.** It is explicitly optimised for the Account admin and a Ratestar sales demo, not the occasional Property manager. The overview even leads with the identity band, which the manager can only read. - **Editing by state means hunting.** The manager must map a change to a guest state: - the welcome line is in Arrival; - links are in 'Done and links'; - the private-note threshold is in the 'Private note' state. - **A technical studio.** A 224 rail, a board and a 360 inspector take the most learning, get cramped at 1280, and push the inspector into a sheet on phone. - **More places to learn.** A four-item sidebar sub-list plus five places per portal: home, studio, review, print, performance. - **Scope gets fuzzier.** A per-portal choice among 'allowed compositions' adds a scope decision for the manager. - **The range contract breaks.** Portal pages default to 30 days while the rest of the app shares ?range= with a 90-day default. - **Too heavy on a phone.** The 14-frame contact sheet (7 states × EN/BG at 0.36 scale) is too much to review and publish on a phone, even as a pager. - **Largest model change.** Composition plus alternate, snapshot v3, three renderers and batch identity publish mean the manager's daily path waits longest.                                                                                                        |

Winner: **workspace**.

Grafts:

- From inbox-mirror: open a lone portal directly. When a property has exactly one portal, go straight to its workspace. Otherwise, a 60-room hotel with 1–2 portals has to click through the overview every visit.
- From inbox-mirror: fix the restore wording to match rollbackPortalPublication. Use 'Make version 4 live again · replaces version 6'. Version 4 stays version 4, with a new activation and no 'as version 7' renumbering. Flag that Undo, which needs reactivating a higher version, is a rule change rather than a free 'republish 6 as version 8'.
- From inbox-mirror: compare counts as absolute differences at portal scope, e.g. '+38 vs the 90 days before', not '↑ 12%'. Keep percentages for property or group totals at most. Small hotel numbers make percentages noise.
- From inbox-mirror: show up to three pending changes in guest words directly in the Experience dock, above 'Review & publish', instead of only behind the '3 changes not live' detail. This makes the scope of what will publish visible without opening anything.
- From inbox-mirror: add 'Discard draft changes' to the header ⋯. It resets the working copy to the live version, so a manager who fiddled can back out without undoing field by field.
- From inbox-mirror: add a digest guard at publish ('Changed since you reviewed · Review again'), so a colleague's autosaved edit is never published unseen.
- From inbox-mirror: add a 'Mine' (portals I'm responsible for) option to the overview's Show filter and phone Show select.
- From inbox-mirror: tune notifications per person for 'Portals I'm responsible for' (health issues, private notes). Do not notify on google_destination_awaiting_refresh. Send one quiet 'back to normal' notice, so the bell stays trustworthy for an occasional visitor.
- From inbox-mirror: put the case pattern at the top of Activity. Stack the attention lines (sentence · who can fix · one fix), then a compact 30-day five-cell vital strip, then the ledger. 'Is it working and what do I do' then answers on one screen, especially on a phone, without opening Analytics.
- From journey-studio: create the neutral hospitality default identity (Folio, #1E1C1A / #F6F2EA / #7A5C3E) at property setup. A missing Account-admin look then never blocks a Property manager's first publish. Pair it with a default fallback wording decision so 'An Account admin needs to finish the property look' becomes rare.
- From journey-studio: open the stage on the 1★ and 5★ compare view by default when the Rating and Google section is expanded, rather than behind a link. The proof sits where the threshold is set.
- From journey-studio: on a first publish, the review shows Arrival and After rating (1★ and 5★) for each enabled language as small frames. Later publishes keep the lighter change-row list. On phone, the frames become a short pager after the checks.
- From journey-studio: add a 'Link only (email, website, messages)' place type that ends on Copy link, QR (SVG) and Share… instead of a print kit.
- From journey-studio: prompt once when the manager leaves the first-publish Share screen without downloading the kit or copying the address, while the shown-once rule stands.
- From journey-studio: a property-level 'Print kits' list with 'Last downloaded · by · when' and 'Download all kits (ZIP)', reachable from the overview header ⋯, for the annual reprint job. It depends on the re-download security decision.
- Winner-internal simplification for this lens: on first use, collapse the stage toolbar to [Draft | Live] plus 'Try as guest'. Move the state select and EN/БГ into a 'More views' menu until a second language is enabled. This lowers the learning load of row 2.

**Lens:** the property manager, occasional and often on a phone. The winner is Workspace (8), then Portal Desk (inbox-mirror, 6.5), then the Brand and Journey Studio (journey-studio, 5.5).

**Why Workspace wins.** It maps the manager's four jobs straight onto four tabs, and it states the scope on every section and field. Its review names who can fix each blocker, and its primary label is always the next step, so a Property manager blocked by an Account admin still has something to do. It uses the most pages the manager already knows: a standard overview with the measures on each row.

**Portal Desk.** Its case pane and its handling of small numbers are the best ideas in the set. As a whole, though, it is a 200-portal operator console: 7 queues, groups and keyboard triage. It also splits editing (studio) from operations (case), and results across 30-day and ?range= views.

**Journey Studio.** It is openly built for the Account admin and the sales demo. Editing by guest state makes a Property manager hunt for fields: the threshold lives in the 'Private note' state. It also breaks the shared 90-day range default.

**Three factual checks against the capability map:**

1. Workspace's restore copy ('as version 7') contradicts rollbackPortalPublication, which appends a rollback activation of the lower target version.
2. Both Workspace's Undo and Portal Desk's Undo need a new rule or command. Only Portal Desk says so.
3. All three depend on publish changes while live (C1) and a batched health and list read (B1/B2). A Property manager gains nothing until C1 ships.

**Grounding files:**

- capability-map.md
- app-shell-spec.md
- docs/design/portal-experience/admin-round-2.md

### Account admin and buyer

| Concept        | Score | Strengths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Weaknesses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| journey-studio | 8.5   | Best brand governance for a group of 6 to 40 properties. The org portfolio has an Identities tab that shows each property's live look as a real Arrival thumbnail rendered from the snapshot. Each row carries a readability verdict, a 'Default colours' warning and 'N live portals on the previous identity', which is the brand-drift view a group brand lead actually needs. 'Copy identity to…' opens the target property's impact review, so brand rollout across properties works in the beta without an org-level brand model. The only other concept with a cross-property brand action defers it. The optional allowed alternate composition (Table Card for restaurant and bar portals) solves the hotel-with-restaurant case that the other two push to 'later'. The Identity studio draws all three compositions live in the property's own colours, with 'Paste colours' and derived roles shown as Ready or Adjusted. The impact review has per-portal opt-out, shows other editors' pending work, and makes clear that nothing live changes silently. It is the most differentiated and desirable concept: an explicit three-minute demo aimed at Ratestar's documented weak points. Those are score-based redirect after 200 ms, flag-pill mixed-language pages and generic QR frames. The demo shows the 1★/5★ pair with a dashed guide at the identical Google card, real Cyrillic type, a true-size table tent in the composition and an honestly labelled funnel. 'Download all kits (ZIP)' makes a new property's print run one action. The analytics are honest: the 10-rating comparison floor, the average only at n≥5, the weekly rating line only for weeks with at least 5 ratings, and no Google opens split by star. Health is shown by exception, with every failing check and who can fix it. | Cross-property operations are only a table. There are no queues with server counts, no 'Mine', no keyboard triage and no bulk actions (choose manager, pause, move group) beyond the identity batch. An operator of 40 properties with 10 degraded portals has to click through. Measure honesty slips in two places. The proposed Property Overview tile reads 'Portal scans and Private ratings from the existing kpis.scans and kpis.feedback', but kpis.scans is operational portal.scan (not qualified) and kpis.feedback is private-note volume (not ratings). The All-properties 'Portal scans' column also comes from fleet scanCount, which is portal.scan too. Renaming qualified_scans to 'Portal scans' collides with the existing operational measure of that name and diverges from Goals' 'Qualified scans'. The default range of 30 days on portal pages breaks the shared ?range= contract (the dashboard default is 90). Editing (Studio, mode B) and operations (Portal home, mode A) are split across two pages, and the sidebar grows a Portals sub-list. It carries the largest model change: composition plus alternate on the brand profile, the colour engine, snapshot v3 and three renderers. Identity-first can stall PMs unless the neutral default identity decision lands. Named placements per table or room are deferred ('12 copies share one code'), so there is no answer yet to Ratestar's 'reviews per card'. |
| inbox-mirror   | 7.8   | Strongest portfolio-scale operations. It is designed for 1 to 200 properties and more than 1,000 portals. There is one searchable scope select, queues (Needs attention, Unpublished changes, Mine, Live, Drafts, Paused, Archived) with server-side counts using the getInboxQueueCounts pattern, fixed 78px virtualised rows and j/k keyboard triage. Sticky property subheaders state a property-wide cause once ('Google link unavailable · affects all 4 portals'). Cross-property bulk actions cover choose manager, pause and 'Review & publish n' (one batch per property). The portal case is the best monitoring surface: attention lines each name one fix and its owner, then a 30-day vital strip, a full ledger and a draft dock. It adds a quiet 'back to normal' notification and deliberately does not notify transient Google re-checks. Performance is a dedicated dashboard-grammar page at org, property, group and portal scope. It has a funnel with both '% of scans' and '% of rated guests', and it compares counts as absolute differences, not percentages, which is correct for small portal samples. The Brand studio shows 128×180 live composition thumbnails, 'Current / New' preview and 'Affects 7 portals: 5 live will wait, 2 drafts update now'. It has a digest guard ('Changed since you reviewed'), a Discard draft command and a phased delivery plan (P1 to P4). It is also the most literal reuse of inbox geometry, so the product reads as one tool.                                                                                                                                                                                                                                                                                                                             | In a demo against Ratestar it looks like a ticket queue for web pages. It is operationally impressive but not desirable: nothing in the portfolio view shows what guests actually see across properties, and brand appears only as a rail footer link. It is heavy for the typical beta property with 1 to 5 portals (three panes for two rows), and the rail mixes scope (groups) with state (queues) plus two footer destinations. There is no org-level brand overview and no cross-property brand copy ('later'), and no alternate composition for restaurants inside hotels. The 1★/5★ fairness proof is buried as one preview state instead of being a showpiece. Restore re-activates the old version number, and Undo depends on a rule change. It inherits the 'Portal scans' label for qualified_scans, which collides with the operational measure name. Named placements are deferred. The metrics on the case use a fixed 30-day window while Performance defaults to 90.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| workspace      | 7.4   | The most complete and best-grounded concept, and the most careful about measure honesty. It keeps 'Qualified scans' consistent with Goals, warns explicitly that fleet scanCount must never be relabelled, and requires a bounded-window qualified read before any figure ships. The org /portals view is exception-first and grouped by property with rollups ('5 portals · 1 needs attention'). When there are more than 5 properties, healthy ones start collapsed (remembered per viewer). Its strip adds two real Account Admin queues: 'Waiting for you' (blockers only an Account Admin can fix) and 'New guest wording available', which runs a cross-portal batch review. The property overview table doubles as the portfolio, with group rollup rows, an 'All portals' total and averages rebuilt from counts with n. A property-wide cause line appears once above the table. The Property look page is sound governance: derived roles with a one-click fix, 'Used by 5 portals · 3 live', a pre-save impact sentence and a batch review with opt-out. Portal analytics adds version ticks on the trend. The fairness compare view marks the private-note card with a dashed amber 'your setting' bracket. The 'Ask an Account admin' request and the needs_admin setup state are well handled. It offers named placements in V1 ('Name a place, not a person'), which is the only near-term answer to Ratestar's per-card reporting.                                                                                                                                                                                                                                                                                                                                                                             | For the buyer it reads as a well-executed standard admin rather than something to want. Composition choice is 64px thumbnails with no side-by-side live rendering in the property's colours, and there is no demo narrative. Brand governance stops at the property: 'Apply this look to other properties' is later, there is no org-wide view of which properties run which look or default colours, and there is one look per property with no restaurant alternate. Portfolio analytics exist only as table columns. There is no org-scope funnel or Performance page, and group analytics is the only rollup view. Monitoring across properties has no keyboard triage and no bulk actions (manager, pause, publish) except the wording batch. Collapsing the sidebar into the icon rail for every portal workspace may disorient occasional users, as the concept itself admits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Winner: **journey-studio**.

Grafts:

- From inbox-mirror: add queue-based cross-property triage to the org portfolio's 'Health and measures' tab. The queues are Needs attention · Changes not live · Mine · Drafts · Paused, with server-side counts (the getInboxQueueCounts pattern), j/k keyboard navigation and a 'Mine' filter for responsible managers.
- From inbox-mirror: bulk actions from a selection header in the org and property tables: Choose manager, Pause…, Move to group (disabled with a reason when the selection spans properties), and Review & publish n (one batch per property).
- From inbox-mirror: sticky property subheader rows that state a property-wide cause once ('Google link unavailable · affects all 4 portals') instead of repeating it on every portal row.
- From inbox-mirror: compare counts as absolute differences ('+38 vs prior 30 days') rather than percentages at portal scope, and show '% of rated guests' alongside '% of scans' on the Google step of the funnel.
- From inbox-mirror: the reviewed-digest guard ('Changed since you reviewed · Review again'), the Discard draft command, the quiet 'back to normal' notification, and not notifying transient google_destination_awaiting_refresh.
- From inbox-mirror: the P1–P4 phasing, so the portfolio monitoring surfaces (health read, list projection, ledger, restore) ship before the composition and colour-engine model change.
- From workspace: 'Waiting for you' (Account-Admin-only blockers) and 'New guest wording available' (a batch review across portals) as summary-strip cells on the org portfolio.
- From workspace: collapse properties with nothing needing attention when there are more than 5 properties (remembered per viewer), and add a final 'All properties' / 'All portals' totals row with averages rebuilt from counts and shown with n.
- From workspace: keep the label 'Qualified scans' (consistent with Goals), and never feed kpis.scans or fleet scanCount (operational portal.scan) or kpis.feedback (note volume) into a tile labelled scans or private ratings. Fix Journey Studio's proposed Overview tile and All-properties columns accordingly.
- From workspace: named placements in V1 (name the existing QR and NFC artifacts, with the helper 'Name a place, not a person'). This is the honest answer to Ratestar's 'reviews per card' without any staff dimension.
- From workspace: version ticks on the Over-time chart at portal scope, plus the dashed amber 'Added at 3★ or below · your setting' marker on the private-note card in the 1★/5★ pair.
- From workspace: align the portal pages' default range with the shared ?range= contract (90 days, like the dashboard) instead of a portal-specific 30-day default.

Lens: an Account Admin and buyer running 6 to 40 properties and comparing with Ratestar in a demo.

Journey Studio wins because it is the only concept that treats brand as a governed portfolio asset. It has an org-wide Identities view with live snapshot thumbnails and drift facts, cross-property 'Copy identity to…' and an allowed alternate composition for restaurants. It also has a demo narrative built on grounded Ratestar weaknesses from research.md: the redirect after 200 ms, the flag-pill language switch and emoji-starred CTAs.

Its main gap is portfolio operations. Inbox-mirror's queues, server counts, keyboard triage and bulk actions should be grafted onto the org 'Health and measures' tab.

A concrete honesty bug must be fixed before adoption. Journey Studio proposes an Overview tile labelled 'Portal scans / Private ratings' fed from kpis.scans and kpis.feedback. Per the capability map (section 11 and the measures table), those are operational portal.scan and private-note volume, not qualified_scans and portal_rating_count. The same applies to the fleet scanCount column. Workspace is the only concept that flags this explicitly.

For context on the Ratestar comparison, from research.json: Ratestar sells a multi-location table with 30-day deltas, per-card reviews, per-block clicks and email digests with AI summaries. All three concepts defer digests. A weekly digest to responsible managers, with the five measures and n, is worth pulling forward for the buyer demo.

Grounding read:

- capability-map.md
- app-shell-spec.md
- docs/design/portal-experience/round-3-guest/research.md
- docs/design/portal-experience/round-3-guest/research.json

### Product truth, feasibility and inbox consistency

| Concept        | Score | Strengths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Weaknesses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace      | 8     | Most faithful to the product rules and the codebase. - **Honest vocabulary.** It uses the exact names from the shell spec (§18): Qualified scans, Private ratings, Average private rating, Guests who opened Google, Private notes. It also recognises the D2 trap: bounded-window 'Scans' is operational portal.scan, so every figure waits for a bounded qualified read, and the fleet scanCount must not be relabelled. - **Google equality.** The 1★/5★ compare view has the Google card at the same y. The threshold is the only control, with the helper 'Google stays the same'. - **Publishing.** Publish-while-live is a hard dependency (risk 2: do not ship the workspace without C1). Pause, archive and restore map correctly: archive → disabled, then a separate publish. - **Roles.** Account-Admin-only controls render as facts that name the admin, never as disabled buttons. The review primary's label is always the next step ('Assign a manager', 'Ask an Account admin'), so a blocker never becomes a dead disabled button. The permission mismatches in D1 have interim behaviour. - **Feasibility.** Most of it maps onto existing commands: - createPortal plus the override; - issue then publish in sequence; - rollbackPortalPublication; - responsible managers; - health getCurrent/listHistory. The new work is listed against the map IDs, and publish-while-live is correctly marked as the one hard dependency. - **Continuity.** It keeps the owner's preferred Refined Sections as the everyday editor. Sections are flat and scoped, with one shared draft, inheritance plus a 'Use property wording' reset, and a two-way bound preview. The preview uses the real /p renderer in an iframe, with an admin-only 'Hidden from guests' line that addresses today's silent link drop. - **Inbox language.** - The workspace reuses the Inbox's mode B (48 rail, 56 header, 48 row 2, dock at the foot of the column). - The overview reuses PageHeader, the summary strip and the property-list table. For 1–5 portals, a quiet table fits better than a queue. - The ledger covers publishing, codes, health, responsibility and look fan-out. - A property-wide cause is stated once above the table, not repeated on every row. - **Accessibility.** - WCAG 2.5.7 move controls. - The preview is one labelled tab stop. - scroll-padding keeps focus clear of the dock. - Esc returns focus to the opener. - Stories at 320/390/1440, a geometry gate and axe checks. | - **Restore is described wrongly for the domain.** rollbackPortalPublication re-activates the target snapshot at its own version and appends a 'rollback' activation. It refuses when target.version >= active.version. So: - 'Guests will see version 4 again, as version 7' is wrong; - 'Version 7 is live (a copy of version 4)' is wrong; - 'Undo republishes 6 as version 8' is wrong, and Undo is impossible without a rule change. The ledger and dialog copy would lie, and the Undo toast would fail. - **Re-download recommendation.** It recommends storing the token envelope-encrypted so kits can be downloaded again. That weakens the hash-only invariant (CONTEXT Invariant 9) as a default, where it should be a flagged option. - **Deltas.** They are always percentages ('↑ 12%') on portal-sized counts, where 3 → 6 reads as +100%. - **Concurrency.** Field-level last-write-wins with a 'Georgi edited 2 min ago' notice. There is no reviewed-digest guard, so a publish can include edits made after the review opened. - **Early model change.** Named placements are pulled into the Share tab even though they need a new model field. - **Try as guest** is a 720px sheet, outside the 384 sheet spec (justifiable, but new). - **Group analytics and the /portals rollups** depend on the B7 governance decision, which is not stated as a gate on those screens. - **Label drift.** 'Average private rating' differs slightly from Goals' 'Private rating average'.                                                                                                                                                                                                                                                                                                                                         |
| inbox-mirror   | 7.5   | The most literal and disciplined use of the inbox language: - the queue rail with a scope select (#582 pattern) and a server-side queue-count read, the getInboxQueueCounts mirror; - fixed 78px rows with signals first; - a case with a fact/control toolbar; - attention lines, each naming who can fix it and one fix; - a draft dock that is the composer dock's twin, with one primary; - j/k and the ? legend; - URL queue state per ADR 0057. **Best domain accuracy on the history.** - Restore keeps version 3 as version 3 with a new activation. - Undo is correctly flagged as needing a rule change (target must be lower than active today). - After a restore, the draft shows v4's content as not live, which is correct given the working-copy digest comparison. - It states honestly that a non-verified Google link, including awaiting_refresh, blocks every publish at the property. update-portal requires state === 'verified'. - Notification policy matches the actionable-reason list: no alert for refresh, plus a quiet 'back to normal'. **Best build planning.** - Every capability is classified A, B or C against the map. - The phases are P1–P4, with P1 built mostly from A reads plus B1–B3. - New commands are called out explicitly: a reviewed-digest guard on publish and 'Discard draft changes'. - The most conservative security stance: keep shown-once for the beta, bind the kit to the issue and replace moments, and note that storing PDFs is equivalent to storing the token. **Accessibility.** Accessible row names include the signals. Nothing is swipe-only, glyphs have sr-only counts, and 2.5.7 moves are provided.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | - **Resume is described wrongly.** 'Resuming publishes the current live version again' is false. disabled → published builds a new snapshot from the working copy (update-portal buildPortalPublicationSnapshot), so resume would ship pending draft changes without the review this concept requires elsewhere. - **'Portal scans' label.** It uses 'Portal scans' for qualified_scans. That re-creates the D2 ambiguity with the operational portal.scan measure, and it contradicts the concept's own claim that Goals keep the same names (Goals says 'Qualified scans'). - **Overbuilt for the beta.** A three-pane queue workspace is a lot for properties with 1–5 portals (its own risk 1). - **Crowded rail.** The rail mixes scope (groups), state (queues) and footer destinations (Performance, Property brand), which is more than the inbox carries. Analytics is only discoverable through a rail footer row. - **Disabled primary.** A blocked review disables 'Publish version 5' (described by 'Fix 2 items') instead of relabelling it to the next step. - **Passed checks** are listed in green rather than folded, which is weaker availability-by-exception. - **Editing and case split.** Editing lives in a separate studio frame, so the owner's section editor is kept but split from the case. Managers, group and codes are deliberately absent from the studio, which adds context switches for occasional users.                                                                                                                                                                                                                                                                                                                                                                                               |
| journey-studio | 6     | **The strongest fairness proof and identity story.** - After rating defaults to a 1★/5★ pair, with a dashed guide across both frames at the Google card's top edge. - The Studio has no arrows or conditional rules, so it cannot read as a routing builder. - Review includes a contact sheet of every guest state in EN and BG, with changed regions marked. **Useful ideas for the other concepts:** - the best comparison rule: percentages only when the prior period has 10 or more, otherwise absolute differences; - a neutral default identity created at property setup, removing one Account-Admin-only publish blocker (flagged as a decision); - 'Paste colours'; - 'Copy identity to…' across properties; - an 'allowed alternate composition' as a concrete answer to the hotel pool-bar case; - pinning the colour-engine version in snapshots, so derivation changes never shift live pages. **Domain facts it gets right.** - Restore semantics: 'Live · version 3 (restored)', a rollback activation, and the draft kept. - Resume is a publish with checks. - The identity impact review discloses other editors' pending work, with opt-outs for each row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Honesty slips on measures.** - It defines Portal scans as qualified_scans, then feeds the Overview tile from the existing kpis.scans, which is operational portal.scan. - It labels kpis.feedback as 'Private ratings', but that is private feedback volume. - The fleet 'Portal scans' column comes from scanCount, which is also portal.scan. This is exactly the D2/A4 relabelling the map forbids. **Largest model change of the three.** - A composition plus an allowed alternate. - A portal-level choice among compositions. - Snapshot schema v3 with engine-version pinning. - A batch identity publish. - Identity-first sequencing, which can stall PMs. **Print kits depend on an unmade security decision.** The property Print kits page offers 'Download all kits (ZIP)' and 'Last downloaded', but codes are shown once. Without that decision the page is mostly infeasible. **Unsaved identity edits live 'on this device'.** They are held in browser storage until the impact review. That is state that matters, and it is invisible to other Account Admins, which goes against the storage rule and the server pending-change model. **Framing departs from the owner's direction.** - The thesis is optimised for a competitor sales demo rather than the occasional property manager. - It departs from the owner's preferred Refined Sections toward the Guest Journey model that round 2 cautioned about. **Smaller issues.** - It uses engineering status words as UI labels ('Degraded', 'Unavailable'). - Publish changes and Review impact use disabled primaries. - Portal pages default to a 30-day range, which breaks the shared ?range= default of 90 days. - There are many surfaces: a four-item sidebar sub-list, Identity, impact review, Print kits, Performance, and an org view with two tabs. |

Winner: **workspace**.

Grafts:

- From inbox-mirror: correct restore semantics. 'Make version 4 live again' re-activates the same snapshot version through a rollback activation. The ledger reads 'Elena Petrova made version 4 live again · replaced version 6'. Drop 'as version 7' and 'a copy of version 4'. Offer Undo only if product approves the rule change that allows a higher target (today rollbackPortalPublication refuses target.version >= active.version); otherwise remove Undo from the toast.
- From journey-studio: resume from Pause is a publish that goes through Review, because disabled → published snapshots the working copy and would otherwise ship pending draft changes unseen. State this in the Pause dialog and on the header fact for a paused portal.
- From inbox-mirror: A/B/C classification of every new capability against the capability map, and the P1–P4 delivery phasing. Combine it with the workspace's own gate: the Experience/Review workspace does not ship before publish-while-live (C1).
- From inbox-mirror: a reviewed-digest guard on publish ('Changed since you reviewed · Review again') to replace the field-level last-write-wins as the publish safety net, plus a 'Discard draft changes…' command in the header overflow.
- From inbox-mirror: the conservative code stance for the beta. Keep the address shown once, and bind the print kit to the issue and replace moments. Record that storing generated PDFs is equivalent to storing the token. Present envelope-encrypted retrieval only as a post-beta security decision, not as the recommendation.
- From inbox-mirror: say plainly that a non-verified Google link, including awaiting_refresh, blocks every publish at the property. Show it in the property cause line and in Review. Adopt its notification policy: no alert for refresh, a quiet 'back to normal', and the reason plus who can fix it in portal.health_attention.
- From inbox-mirror: server-side count predicates for the overview strip (the getInboxQueueCounts mirror, never counting loaded rows); a 'Mine' (portals I am responsible for) option in the Show filter; j/k plus a '?' legend on the overview table; and a 'checked at' time on health facts to guard against stale health after a revoke or grace expiry.
- From journey-studio: the comparison rule. Show percentage deltas only when the prior period has 10 or more; otherwise use absolute differences ('+38 vs prior 90 days'). Keep the existing 10-rating floor for average comparisons.
- From journey-studio: make the 1★/5★ fairness pair the default rendering of the After-rating preview state, not a separate menu item. Add a dashed neutral guide across both frames at the Google card's top edge, labelled 'Google card · identical'.
- From journey-studio: in Review & publish, add a collapsed 'See every guest state' contact sheet: Arrival, After 1★, After 5★, Private note, Done, Google unavailable and Page unavailable, in each enabled language, with changed regions marked.
- From journey-studio: a neutral default brand profile (#1E1C1A / #F6F2EA / #7A5C3E, Folio) created at property setup, as a product decision, so a missing look is not an Account-Admin-only publish blocker. Add 'Paste colours' (three hex values at once) on Property look.
- From journey-studio: pin the colour-engine version (alongside the language pack) in each snapshot, so derivation changes never shift a live page. Record 'allowed alternate composition per property, chosen per portal' as the concrete option for the deferred per-portal composition decision, and 'Copy look to another property' for multi-property Account Admins (later).

Lens: product truth, feasibility and inbox consistency. I checked the concepts against capability-map.md, app-shell-spec.md and shared-rules.md. I also checked the code at the repository.

**Code facts that decided points:**

- src/contexts/portal/application/use-cases/rollback-portal-publication.ts re-activates the target snapshot at its own version with a 'rollback' activation. It refuses target.version >= active.version. The workspace concept's 'version 7, a copy of version 4' is therefore wrong, and Undo needs a rule change; inbox-mirror is right on both.
- src/contexts/portal/application/use-cases/update-portal.ts builds a new snapshot from the working copy on any non-published → published move. Resume from Pause therefore ships draft changes, so inbox-mirror's 'resume publishes the live version again' is wrong. The same file requires Google state === 'verified', so awaiting_refresh also blocks publishing.
- kpis.scans and fleet scanCount are operational portal.scan, and kpis.feedback is private feedback volume. That makes journey-studio's Overview and fleet labels ('Portal scans', 'Private ratings') dishonest.

**Why workspace wins:**

- It keeps the owner's preferred Refined Sections as the everyday editor and ties it to a preview that uses the real /p renderer.
- It uses the honest metric names from the shell spec and matches Goals.
- It never shows a dead control: a blocked primary is relabelled to the next step, and Account-Admin-only items are facts that name the admin.
- Its overview is a quiet table built from the property-list pattern, which fits properties with 1–5 portals.
- Most of it maps onto existing commands, and publish-while-live is correctly the hard gate.

**What to fix and graft:**

- Its restore copy is the main factual fix.
- Its token re-download recommendation should drop to a post-beta option.
- The inbox-mirror grafts are:
  - its build discipline: A/B/C classification and P1–P4 phasing;
  - its correct history semantics;
  - a digest guard and 'Discard draft changes';
  - server-side queue counts.
- The journey-studio grafts are:
  - its fairness pair and every-state contact sheet;
  - its comparison rule: a percentage only when the prior period has at least 10;
  - a neutral default look at property setup.
