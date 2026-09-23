# Board specs

The build spec for each admin board, as written by the design director. Boards are on the [Portal Admin Redesign canvas](https://claude.ai/artifact/L3WgLyLtEC6GP5Sa9uSHhM), which is private to its owner; open `boards/src/<board>.dc.html` instead, or the rendered `boards/<board>.png`.

## ADM01-portals-overview — Portals overview (property)

1440×1024 · group g1

**Purpose.** The property’s home for portals: which place needs me, what is live, what is waiting to go live, and whether guests use each place, with groups and the portfolio figures in one quiet table. It also defines the shared shell every other desktop board reuses.

**What exists and what is new.** Exists: listPortals for one property, portal groups (list, rename, archive), responsible managers, publication state, pending changes per portal (through the publication history), createPortal. New: one batched list projection per property with health, live version, pending-change count, group, managers, code status and range measures (B1, B2); qualified scans, Google opens and ratings in bounded windows (B6); the property-level pending-change read behind the look line (B5); an Inbox Feedback portal facet for ‘Private notes waiting’ (B9); place type (C4, small). UI only: retire the theme swatch, the purple Published badge and paging; ?show, ?group and ?range in the URL (A8, A10).

**Spec.**

MODE A standard page, dashboard tier. Viewer: Elena Petrova (Account admin). Today 19 Sep 2026. <title>Portals — Avela Resort</title>. Fonts: the guide’s css2 link and Satoshi blobs only; no guest fonts on this board.

SHARED SHELL (this foundation board defines it; every desktop board reuses these names and numbers):
• SIDEBAR (expanded, property scope; the app is 256 wide — the guide’s 240 is outdated): <nav aria-label ‘Primary navigation’> x0–256, full board height, bg #f7f8fa, border-right 1px #dcdee2, flex column. Header padding 8: property switcher <button> 48 tall, padding 8, gap 8, radius 6: a 32×32 tile, radius 8, bg #e7e4ff, ‘AR’ 12px 500 #512da6; text column ‘Avela Resort’ 14/500 over ‘avela-resort’ 12/16 #5b5d63; chevrons-up-down 16 #512da6 at the right. Nav <ul> padding 8, gap 4. Rows are <a> 32 tall, padding 8, gap 8, radius 6, 14/20 #101115, 16px icons ALL #512da6: Dashboard (layout-dashboard; a category row with padding-right 32 and a 20×20 chevron-right button at top 6, right 4), Reviews (message-square; count pill ‘3’ at right 4, top 6: 20 tall, min-width 20, padding 0 6, radius 9999, #df202e, 12px 500 #fff), People (users), Portals (globe) SELECTED = bg #e7e4ff and weight 500, label stays #101115, aria-current page, Goals (target), Property settings (sliders-horizontal). Footer padding 8: Settings (settings).
• TOPBAR: <header> y0–52 right of the sidebar, border-bottom 1px #dcdee2, padding 0 16, gap 8, bg #f7f8fa: ghost 28×28 ‘Toggle sidebar’ (panel-left 16, margin-left -4); flex spacer; ghost 32 ‘Feedback’ (message-square-plus 16 plus 14/500 label); ghost 32×32 ‘Notifications’ (bell 16) with a 16px #512da6 circle ‘2’ (9px 700 #feffff) at top -2, right -2; account button 32, round, holding a 28px #512da6 circle ‘EP’ 10px 500 #feffff.
• MAIN: padding 32 24, blocks 32 apart; dashboard tier content is 1136 wide at x280–1416.
• PAGEHEADER: breadcrumb <nav aria-label ‘Breadcrumb’> 14/20 #5b5d63, links #512da6 with no underline, chevron-right 14 separators, current crumb #101115. 12 below, the title row: h1 24/32 700, letter-spacing -0.6px; optional description 14/20 #5b5d63, 4 below; actions at the right, gap 8, 36 tall, at most one primary.
• BUTTONS: primary 36 (#512da6, label #feffff 14/500, radius 6, padding 0 12 with a 16px icon, hover #6242ae). Outline (bg #f7f8fa, 1px #dcdee2, shadow 0 1px 2px rgba(0,0,0,.05), #101115) at 36 or sm 32 (padding 0 10, gap 6). xs 24 (12px text, 12px icon). Ghost is transparent. Outline and ghost hover #e7e4ff. A menu trigger ends with chevron-down 14.
• FACT: 13/20 text, no box, led by a 7px dot (#101115 = live or working; a hollow 7px ring, 1.5px #b5b7bd = draft; #b5b7bd = paused or past) or a 12–14px glyph. DETAIL: the same inside a <button> with text-decoration underline dotted currentColor, underline-offset 4, cursor help; it opens a popover (popovers are not drawn open unless a board says so). Attention = #a45f00 ink plus triangle-alert plus words. Positive #007a3a and negative #d00021 appear only with a sign or an arrow.
• STRIP: a <dl> grid of equal cells with 1px gaps over #dcdee2, 1px #dcdee2 border, radius 8, overflow hidden; cells #feffff, padding 12 16, column gap 4: dt 12/16 500 #5b5d63; value 18/28 700 tabular #101115; detail 12/16 #5b5d63. A filtering cell is a <button aria-pressed> (hover and pressed #f0f2f5).
• TABLE (property-list pattern): #feffff, 1px #dcdee2, radius 8, overflow hidden, 14/20. Header cells hold a sort <button> 12/16 500 #5b5d63 plus arrow-up-down 14 at opacity .4; numeric columns are right aligned; labels may wrap. Body cell padding 12 16 (numeric cells 12 12, right aligned, tabular). Row hover #f9fafb. The portal name is the row’s ONE link: 14/500 #512da6, with a meta line 12/16 #5b5d63 2 below. An average reads ‘4.4’ 500, then a filled star 14 #da950b, then sr-only ‘stars’ (written ‘4.4★’ below). Owner disc: a 20px circle #dcdee2 with 10px 500 #101115 initials, overlapping by -4. Actions: ghost 32 ellipsis #5b5d63 with aria-label ‘Actions for {name}’.

LAYOUT: SIDEBAR x0–256 | column x257–1440 holding TOPBAR and MAIN.

TOP TO BOTTOM (MAIN):

1. PAGEHEADER y84–172. Breadcrumb: Properties › Avela Resort › Portals. h1 ‘Portals’. Description ‘Pages guests reach from codes around Avela Resort · Look: Carved Stillness’. Actions: outline 36 ‘Analytics’ (chart-column 16); outline 36 ‘Property look’ (palette 16); primary 36 ‘New portal’ (plus 16), the page’s one primary.
2. PROPERTY-WIDE LINE y204–224, shown only because a property-wide change is pending, no box: pencil 14 #5b5d63, then 14/20 #101115 ‘Elena Petrova changed the property look on 17 Sep. It isn’t live on 4 portals yet.’, 8px, then a link 14/500 ‘Review & publish 4 portals’.
3. STRIP y248–340, 4 cells: [button] ‘Needs attention’ · triangle-alert 14 #a45f00 + ‘1’ · ‘Spa & thermal pools’; [button] ‘Live’ · ‘4 of 5’ · ‘1 draft’; [button] ‘Changes not live’ · ‘4’ · ‘The new look is waiting on each’; [link] ‘Private notes waiting’ · lock 14 + ‘3’ · ‘Open in Inbox’ (#512da6 with arrow-right 12).
4. TOOLBAR y364–400, gap 8: search input 288×36 (search 16 #5b5d63 at left 12, text at left 36, placeholder ‘Search portals’); outline sm ‘Show: All’ (list-filter); outline sm ‘Group by: Group’ (layers); flex spacer; outline sm ‘Last 90 days’ (calendar).
5. TABLE y416–958. Columns (1136): Portal 264 · Status 200 · Qualified scans 104 · Private ratings 104 · Average private rating 104 · Guests who opened Google 120 · Private notes 104 (lock 12 before the label) · Responsible 80 · actions 56. Header row 48. No column shows an active sort; the default order is ‘needs attention, then name’, groups with attention first and ‘Not in a group’ last.
   Group header rows 44: bg #f7f8fa, 13/20 500 #101115; the first cell spans Portal and Status; sums are 13/20 500 tabular, right aligned; a ghost ⋯ ‘Actions for group {name}’. Portal rows 62. Rows in order:
   • GROUP ‘Wellness · 1 portal · ’ then ‘1 needs attention’ (12/16 500 #a45f00 with triangle-alert 12) | 286 | 91 | 4.6★ | 52 | 4
   • Spa & thermal pools — meta ‘Spa or wellness · QR and NFC · EN, БГ’ — Status: fact ‘● Live · v3’; second line a DETAIL, 12/16 500 #a45f00 with triangle-alert 12: ‘Partly working · no one responsible’ (popover: the reason, ‘Who can fix: a Property manager or Account admin’, primary sm ‘Assign a manager’ and a link ‘Open Activity’) — 286 | 91 | 4.6★ | 52 | 4 — Responsible: ‘No one’ 12/16 500 #a45f00 — ⋯
   • GROUP ‘Dining · 2 portals’ | 351 | 97 | 4.2★ | 41 | 11
   • Olive Terrace restaurant — ‘Restaurant or bar table · QR and NFC · EN, БГ’ — ‘● Live · v4’, second line 12/16 #5b5d63 with pencil 12 ‘1 change not live’ — 351 | 97 | 4.2★ | 41 | 11 — GI — ⋯
   • Pool bar — ‘Restaurant or bar table · No code yet · EN, БГ’ — hollow ring ‘Draft · not published’, second line 12/16 #5b5d63 ‘Created yesterday by Elena Petrova’ — the five figure cells merged into one cell, 13/20 #5b5d63, left aligned: ‘Not published yet’ — EP — ⋯
   • GROUP ‘Not in a group · 2 portals’ | 450 | 122 | 4.4★ | 66 | 9
   • Guest rooms — ‘Guest room · QR and NFC · EN, БГ’ — ‘● Live · v2’, ‘1 change not live’ — 38 | 4 | DETAIL ‘Too few’ 13/20 #5b5d63 (popover ‘An average needs 5 private ratings. 4 so far.’) | 2 | 0 — EP — ⋯
   • Reception — ‘Reception desk · QR and NFC · EN, БГ’ — ‘● Live · v5’, ‘4 changes not live’ — 412 | 118 | 4.4★ | 64 | 9 — GI and EP — ⋯
   • TOTAL row 52, border-top 1px #b5b7bd, weight 500: ‘All portals · 5’ | 1,087 | 310 | 4.4★ | 159 | 24
6. BASIS LINE 12 below the table, 14/20 #5b5d63: ‘Last 90 days, Europe/Sofia time · An average needs 5 private ratings · Sorted by what needs attention, then name.’

STATES SHOWN: unfiltered list; one portal needing attention; a draft; a portal under the average floor; a pending property-wide change. No guest preview on this board.
INTERACTIVE (working in the mock): the three strip buttons toggle aria-pressed and filter the table through state (‘Needs attention’ shows only the Wellness group; ‘Changes not live’ shows the four live portals); ‘New portal’ is an <a> to ADM03-new-portal-place.dc.html styled as the primary; the ‘Reception’ name is an <a> to ADM06-workspace-links.dc.html. Drawn only: menus. Row ⋯ menu: Open · Try as guest · Download print kit · Move to group… · Pause public page… · Archive…. Group ⋯: Rename · Group analytics · Archive group (Account admin). Show menu: All · Needs attention · Changes not live · Mine · Drafts · Paused · Archived.
BEHAVIOUR: a name always opens the workspace on Experience; the attention detail offers the fix and ‘Open Activity’. Not drawn: the empty state ‘No portals yet’ (dashed EmptyState, 40px circle with globe 16, ‘A portal is the page guests reach from a code at a place such as reception or a table.’, New portal) and the search empty state ‘No portals match “spa”’.
A11Y: <table> with <th scope col>; each group row starts with a <th scope rowgroup>; strip buttons carry aria-pressed; the attention detail’s accessible name includes the portal name.

## ADM02-all-properties-portals — All properties · Portals (org scope)

1440×1200 · group g1

**Purpose.** One exception-first view across properties for an Account admin (or a Property manager with several properties): property-wide causes stated once, who can fix them, and the same honest figures, without comparing properties.

**What exists and what is new.** Exists: listPortals without propertyId (org-wide, D6-001 scoped) — no route uses it yet; fleet per-property data, but its scanCount is operational portal.scan and must not be relabelled ‘Qualified scans’. New: the /portals route and view (A5); batched health and list projection per property (B1, B2); qualified scans in bounded windows (B6); property- and org-scope private-rating count and average (B7, a governance decision); ‘Waiting for you’ from the checklist’s who-can-fix model (A2, C8); guest-wording pack adoption across portals (C6); per-viewer collapse memory.

**Spec.**

MODE A standard page, dashboard tier. The board is 1440×1200 because the full cross-property list is the point. Viewer Elena Petrova (Account admin). <title>Portals — All properties</title>. SIDEBAR, TOPBAR, MAIN, PAGEHEADER, BUTTONS, FACT, STRIP and TABLE as defined in ADM01.

SIDEBAR IN ORG SCOPE (the same component in its org state): the switcher tile is a 32×32 tile, bg #e7e4f2, with building-2 16 #512da6, ‘Select property’ 14/500 over ‘No property selected’ 12/16 #5b5d63, chevrons-up-down 16. Dashboard, People, Goals and Property settings are inert (<span aria-disabled true>, opacity .5); Reviews is a link to /inbox with the count pill ‘7’; Portals is SELECTED (#e7e4ff, 500). Footer: Settings. The sidebar runs the full 1200 height.

TOP TO BOTTOM (content 1136 at x280–1416):

1. PAGEHEADER y84–140, no breadcrumb: h1 ‘Portals’; description ‘All 3 properties in Avela Hospitality’. Actions: primary 36 ‘New portal’ (plus 16; its Place step then asks for the property).
2. STRIP y172–264, 4 cells: [button] ‘Needs attention’ · triangle-alert 14 #a45f00 + ‘5’ · ‘At 2 properties’; [button] ‘Live’ · ‘12 of 14’ · ‘1 draft · 1 paused’; [button] ‘Waiting for you’ · ‘2’ · ‘Only an Account admin can fix these’; [button] ‘New guest wording’ · ‘12’ · ‘Live portals still use wording v1’.
3. TOOLBAR y288–324, gap 8: outline sm scope select ‘All properties’ (building-2 16 #5b5d63, 13/500 text, chevrons-up-down 14 at opacity .5; the Inbox scope-select pattern); search 288×36 ‘Search portals or properties’; outline sm ‘Show: All’ (list-filter); flex spacer; outline sm ‘Last 90 days’ (calendar).
4. TABLE y340–1124. Columns (1136): Portal 280 · Status 144 · Needs attention 216 · Qualified scans 88 · Private ratings 88 · Average private rating 88 · Guests who opened Google 88 · Private notes 88 · actions 56. Header row 56 (labels wrap up to 3 lines).
   Property header rows 52: bg #f7f8fa; an expand <button aria-expanded> 24×24 with chevron-down 16 (chevron-right when collapsed); the property name link 14/500 #512da6; then 12/16 #5b5d63 ‘ · {look} · {n} portals’; the Needs attention cell; sums 13/20 500 tabular; ghost ⋯ (Open property portals · Property look · Analytics).
   Portal rows 52, single line: name link 14/500 plus 12/16 #5b5d63 ‘ · {place type}’; a Status fact; Needs attention (left blank when healthy — availability by exception, never a dash); figures 14/20 tabular.
   Rows in order (attention first, then property name; inside a property, attention first, then name):
   • THE HARBOR HOTEL header: ‘The Harbor Hotel · Folio · 4 portals’ | Needs attention: ‘4 of 4’ (13/20 500 #a45f00, triangle-alert 12) then ‘ · Google link unavailable’ (12/16 #a45f00) | 604 | 171 | 4.5★ | 83 | 14
   • CAUSE ROW, stated once for the property (spans all columns, 56 tall, #feffff, padding 12 16, border-b): triangle-alert 16 #a45f00; 13/20 #101115 ‘Guests can rate privately but can’t open Google from any Harbor Hotel portal since 14 Sep, 09:12. Publishing changes there is blocked until it’s fixed.’; under it 12/16 #5b5d63 ‘Who can fix: Account admin (you)’; at the right, outline sm ‘Reconnect Google’.
   • Breakfast room · Restaurant or bar table | ‘● Live · v2’ | ‘Partly working’ (12/16 500 #a45f00) + ‘ · property Google link’ (12/16 #5b5d63) | 131 | 36 | 4.5★ | 17 | 3
   • Front desk · Reception desk | ‘● Live · v6’ | same attention | 212 | 64 | 4.6★ | 31 | 4
   • Room card · Guest room | ‘● Live · v4’ | same | 73 | 18 | 4.3★ | 9 | 1
   • Terrace · Restaurant or bar table | ‘● Live · v3’ | same | 188 | 53 | 4.4★ | 26 | 6
   • AVELA RESORT header: ‘Avela Resort · Carved Stillness · 5 portals’ | ‘1 of 5’ + ‘ · no one responsible’ | 1,087 | 310 | 4.4★ | 159 | 24
   • Spa & thermal pools · Spa or wellness | ‘● Live · v3’ | ‘Partly working’ + ‘ · no one responsible’ | 286 | 91 | 4.6★ | 52 | 4
   • Guest rooms · Guest room | ‘● Live · v2’ | (blank) | 38 | 4 | DETAIL ‘Too few’ #5b5d63 | 2 | 0
   • Olive Terrace restaurant · Restaurant or bar table | ‘● Live · v4’ | (blank) | 351 | 97 | 4.2★ | 41 | 11
   • Pool bar · Restaurant or bar table | hollow ring ‘Draft’ | (blank) | the five figure cells merged: ‘Not published yet’ 13/20 #5b5d63
   • Reception · Reception desk | ‘● Live · v5’ | (blank) | 412 | 118 | 4.4★ | 64 | 9
   • FORMA KITCHEN header, COLLAPSED (chevron-right, aria-expanded false): ‘Forma Kitchen · Table Card · 5 portals’ | ‘Nothing needs attention’ 12/16 #5b5d63 | 1,512 | 402 | 4.3★ | 171 | 37
   • FOOTER row 52, border-top 1px #b5b7bd, weight 500: ‘All properties · 14 portals’ | (blank) | (blank) | 3,203 | 883 | 4.4★ | 413 | 75
5. BASIS LINE 12 below, 14/20 #5b5d63: ‘Last 90 days, each property’s local time · Averages are rebuilt from counts · Properties with nothing needing attention start collapsed.’

FORMA KITCHEN rows, drawn only if the builder implements expand through state: Bar counter · Restaurant or bar table | ‘● Live · v5’ | 402 | 97 | 4.2★ | 38 | 11; Private dining room · Somewhere else | ‘Paused’ (#b5b7bd dot) | 64 | 21 | 4.5★ | 9 | 2; Tables inside · Restaurant or bar table | ‘● Live · v7’ | 611 | 158 | 4.3★ | 70 | 14; Terrace tables · Restaurant or bar table | ‘● Live · v4’ | 293 | 81 | 4.4★ | 36 | 6; Website link · Link only | ‘● Live · v3’ | 142 | 45 | 4.1★ | 18 | 4.
No guest preview. No ranking, medals or ‘top property’ copy; the default order is attention, then name.
STATES: org scope; a property-wide cause stated once with its owner and fix; one collapsed healthy property; a draft; an average under the floor.
INTERACTIVE (mock): expand and collapse on the property headers (state; remembered per viewer in the product); the four strip buttons toggle aria-pressed. Drawn only: menus, ‘Reconnect Google’, search.
BEHAVIOUR: a row checkbox appears on hover or focus; with rows selected the toolbar becomes a bulk bar ‘2 selected · Choose manager · Move to group · Pause…’ (Move to group is refused, with a reason, across properties). ‘New guest wording’ opens a batch review of the wording change on each live portal, with opt-out checkboxes and one primary ‘Publish 12 portals’. Property managers see only their assigned properties, and the cell reads ‘Waiting for an Account admin’.

## ADM03-new-portal-place — New portal · Place (step 1 of 4)

1440×1024 · group g1

**Purpose.** Start a portal from where guests meet it, not from a name, slug and theme. The step asks only what it needs.

**What exists and what is new.** Exists: createPortal (name; slug derived; threshold 3 by default; the creator becomes the responsible manager if eligible), add portal to group, portal localized override. New: a place type stored on the portal (C4, small model change); ‘A copy of another portal’ = a duplicate command (C5); Link-only behaviour (print skipped). UI only: slug, description and theme leave the creation form; the step list.

**Spec.**

MODE A standard page, narrow tier (content 768 at x464–1232). Viewer Elena Petrova. Creation step 1 of 4 for what becomes the Pool bar portal. <title>New portal — Avela Resort</title>. SIDEBAR (Portals selected), TOPBAR, MAIN, PAGEHEADER, BUTTONS and FACT as ADM01. FIELD rule: label 14/14 500; 12 below, an input 36 (transparent, 1px #dcdee2, radius 6, padding 4 12, shadow-xs, placeholder #5b5d63); helper 14/20 #5b5d63 12 below; fields 28 apart.

TOP TO BOTTOM:

1. Breadcrumb y84–104: Properties › Avela Resort › Portals › New portal.
2. STEP LIST y116–136: <ol aria-label ‘New portal steps’>, 13/20, gap 24: ‘1 Place’ (500 #101115, aria-current step), ‘2 Experience’, ‘3 Review’, ‘4 Publish and share’ (#5b5d63).
3. h1 y148–180 ‘Where will guests find it?’ (24/32 700). No description and no header actions.
4. PLACE TYPES y212–404: a <fieldset> with an sr-only legend ‘Place type’; a grid of 3 columns × 2 rows of choice cards, each 240×88, column gap 24, row gap 16. A card is a <label>: radius 6, 1px #dcdee2, padding 16, transparent bg; inside, a 16px icon #5b5d63 at the top-left, a 16px radio at the top-right (1px #b5b7bd circle; checked = #512da6 ring with a 6px #512da6 dot), the title 14/20 500 #101115 8 below the icon, and the example 13/18 #5b5d63. The checked card has border #512da6 and bg #f6f5fb.
   • Reception desk (concierge-bell) — ‘A card or stand at the front desk’
   • Restaurant or bar table (utensils) — ‘Table tents and menus’ — CHECKED
   • Spa or wellness (waves) — ‘Treatment rooms and pools’
   • Guest room (bed-double) — ‘A card in the room’
   • Link only (link-2) — ‘Email, website or messages. Nothing to print.’
   • Somewhere else (map-pin) — ‘Any other place guests pass’
5. FIELDS from y436:
   • ‘Name’ — input 768 wide, value ‘Pool bar’ — helper ‘Only your team sees this name. Guests see the welcome line you write next.’
   • ‘Group’ plus 12/16 #5b5d63 ‘optional’ — select 36×360, value ‘Dining’ (chevron-down 16 at .5; menu not drawn: None · Dining · Wellness · New group…) — helper ‘Groups keep related places together in lists and analytics.’
   • ‘Start from’ — a radio group, options 12 apart, 14/20: (●) ‘Avela Resort’s wording’ with 12/16 #5b5d63 ‘Guests see the property’s welcome line and description until you write your own.’; (○) ‘A copy of another portal’ with 12/16 #5b5d63 ‘Copies wording, links, the private-note setting and languages. Never codes or history.’
6. FACTS y822–866, 8 apart, 13/20 #5b5d63, each led by a 14px glyph: palette + ‘Look: Carved Stillness, set for all of Avela Resort · ’ + DETAIL ‘Why not here?’ (popover ‘Every portal at a property shares one look so guests recognise it. An Account admin changes it in Property look.’); user-round-check + ‘You’ll be responsible for this portal · ’ + ghost xs ‘Change’.
7. FOOTER y898–958: border-top 1px #dcdee2, padding-top 24, justify end, gap 8: outline 36 ‘Cancel’; primary 36 ‘Create draft’.
   Nothing asks for a slug, description, theme or threshold: the slug is derived and hidden, and the private note defaults to 3★ or below.
   No guest preview on this board.
   STATES: a place chosen, the name typed, a group chosen, the default start.
   INTERACTIVE (mock): the six cards are a working radio group (state moves the checked styling); ‘Create draft’ is an <a> to ADM05-new-portal-experience.dc.html styled as the primary; ‘Cancel’ is an <a> to ADM01-portals-overview.dc.html styled as the outline button.
   BEHAVIOUR: choosing a card prefills the name (still editable), prepares an English and Bulgarian welcome-line suggestion for step 2, and preselects the print piece (table tent for tables, reception card for desks, NFC card for rooms; Link only skips print). At org scope a ‘Property’ select comes first. ‘Create draft’ creates the portal and opens the workspace in creation mode with Welcome open.

## ADM04-phone-portals — Phone · Portals list with attention

390×844 · group g1

**Purpose.** The manager on a phone: see which place needs attention and open it straight at the fix, with the same honest figures in one line per portal.

**What exists and what is new.** Same data as ADM01: the batched list projection with health and range measures (B1, B2, B6) is new; the phone layout is UI only.

**Spec.**

PHONE 390×844, the overview as a standard page on a phone. Viewer Elena Petrova. <title>Portals — Avela Resort (phone)</title>. No sidebar (it opens as a sheet from the top bar). Controls are 44 tall on this standard page; gutters 16; blocks 20 apart; nothing scrolls horizontally, and everything still fits at 320.
• TOPBAR-PHONE y0–52: border-b 1px #dcdee2, padding 0 8, bg #f7f8fa: ghost 44×44 ‘Open navigation’ (panel-left 20); flex spacer; ghost 44×44 ‘Notifications’ (bell 20 with the 16px #512da6 ‘2’ dot); account button 44 holding the 28px ‘EP’ circle.
• y72–92 breadcrumb 14/20: ‘Avela Resort’ (link #512da6) › ‘Portals’ (#101115).
• y100–144 title row: h1 ‘Portals’ 24/32 700, -0.6px; at the right primary 44 ‘New portal’ (plus 16, padding 0 14).
• y160–200 PROPERTY-WIDE LINE (13/20, wraps to 2 lines): pencil 14 #5b5d63 + ‘The new look isn’t live on 4 portals yet.’ + link 13/20 500 ‘Review’.
• y216–358 STRIP 2×2 (as ADM01 STRIP; cells padding 10 12, no detail lines): [button] ‘Needs attention’ · triangle-alert 14 #a45f00 + ‘1’; [button] ‘Live’ · ‘4 of 5’; [button] ‘Changes not live’ · ‘4’; [link] ‘Private notes waiting’ · lock 14 + ‘3’.
• y374–418 toolbar, gap 8: outline 44 select ‘Show: All’ (list-filter 16, chevron-down 14, flex 1); outline icon button 44 ‘Search portals’ (search 16).
• y434 onward, the LIST (no table). Group labels 13/20 500 #5b5d63, padding 12 0 4. Each portal is ONE <a> row (padding 12 0, border-b 1px #dcdee2), three lines: line 1 = name 14/20 500 #512da6 at the left and the status fact 13/20 at the right; line 2 (only when needed) 12/16; line 3 12/16 #5b5d63, tabular, the 90-day figures.
‘Wellness’ → Spa & thermal pools | ‘● Live · v3’ | 12/16 500 #a45f00 triangle-alert 12 ‘Partly working · no one responsible’ | ‘286 qualified scans · 4.6 from 91 · 52 guests opened Google’
‘Dining’ → Olive Terrace restaurant | ‘● Live · v4’ | pencil 12 #5b5d63 ‘1 change not live’ | ‘351 qualified scans · 4.2 from 97 · 41 guests opened Google’; Pool bar | hollow ring ‘Draft’ | (no line 2) | ‘Not published yet’
‘Not in a group’ → Guest rooms | ‘● Live · v2’ | ‘1 change not live’ | ‘38 qualified scans · 4 ratings, too few for an average · 2 guests opened Google’; Reception (cut by the board edge) | ‘● Live · v5’ | ‘4 changes not live’ | ‘412 qualified scans · 4.4 from 118 · 64 guests opened Google’.
No guest preview.
STATES: the ADM01 fixture at phone width; one portal needing attention.
INTERACTIVE (mock): the Spa & thermal pools row is an <a> to ADM12-phone-portal-health.dc.html. On the phone a row that needs attention opens its Activity tab with the fix first; other rows open Experience. Drawn only: Show select, search, New portal.

## ADM05-new-portal-experience — New portal · Experience (step 2, workspace in creation mode)

1440×1024 · group g2

**Purpose.** Step 2 of creation: write what this place says while the real guest page updates beside it. It also defines the workspace parts, the dock, the device outline and the Carved Stillness preview reused across the workspace boards.

**What exists and what is new.** Exists: the property content read, the portal localized override (save, and reset with null = property wording), threshold, locales, groups. New: the working copy rendered as a guest DTO through the /p renderer for a faithful preview (B4), in the property’s composition (C2); per-field autosave over the existing update commands (A7); place-type welcome suggestions (small, new); the creation-mode step list (UI); ‘Try as guest’, a simulation that writes nothing (C9).

**Spec.**

MODE B workspace (the Inbox’s geometry), creation step 2 of 4 for the new Pool bar portal. Viewer Elena Petrova. <title>New portal: Pool bar — Experience</title>. Fonts: the guide link with Cormorant Garamond (ital,wght 0,600;1,500) and Ysabeau Office (wght 400;600) added to the same css2 URL.

WORKSPACE PARTS (defined here; ADM06–ADM11 and ADM14 reuse them):
• RAIL (the ADM01 SIDEBAR, collapsed): x0–48, full height, bg #f7f8fa, border-right 1px #dcdee2, padding 8. Top: a 32×32 switcher tile, radius 8, bg #e7e4ff, ‘AR’ 12px 500 #512da6 (aria-label ‘Avela Resort, switch property’). From y56, icon links 32×32 (radius 6, 16px icons #512da6, 4 apart, each with an aria-label): Dashboard, Reviews, People, Portals SELECTED (#e7e4ff, aria-current), Goals, Property settings; Settings pinned at the bottom (y984). No labels, badges or tooltips drawn.
• TOPBAR-B: y0–52 across x49–1440; the ADM01 TOPBAR without the sidebar toggle.
• WS-HEADER y52–108: border-b 1px #dcdee2, padding 0 24, gap 12, items centred: a ghost sm <a> ‘Portals’ with arrow-left 16 (back to the overview); a 1×24 divider #dcdee2; the title stack (portal name 14/20 500 #101115 over ‘Avela Resort’ 12/16 #5b5d63); a fact group (13/20, gap 16); flex spacer; ghost 32 icon ‘Portal actions’ (ellipsis 16).
• ROW2 y108–156, border-b. The left segment x49–689 (640, its border-right is the column hairline), padding 0 24, holds line tabs (triggers 14/20 500, #6a6b6f inactive, #101115 active with a 2px #101115 bar on the bottom edge, gap 24) or the creation step list. The right segment x690–1440, padding 0 16, gap 8, holds the preview controls. COMPACT TABS are the composer mode-tab form: list padding 2, radius 6, bg #f0f2f5, gap 2; triggers 26 tall, padding 0 10, radius 4, 13px #5b5d63; active #f7f8fa, 500, #101115.
• EDITOR x49–689, y156–1024: bg #f7f8fa, border-right 1px #dcdee2, scrolls; the DOCK is pinned to its bottom. STAGE x690–1440, y156–1024: bg #f0f2f5.
• SECTIONS: a group label 12/16 500 #5b5d63, padding 16 24 8. A section row is a <button aria-expanded> 56 tall, padding 0 24, gap 12, border-b 1px #dcdee2: icon 16 #5b5d63; title 14/20 500 #101115 over a summary 13/18 #5b5d63 (one line, ellipsis); at the right the scope fact 12/16 #5b5d63 and chevron-down 16 #5b5d63 (chevron-up when open). One section is open at a time: its row fills #e7e4ff and its fields sit directly below on #f7f8fa, padding 16 24 24, fields 28 apart, then a border-b. No boxes around sections.
• FIELD: as ADM03 (label 14/14 500, input 36, helper 14/20 #5b5d63, or 12/16 in dense rows).
• DOCK: a region with border-top 1px #dcdee2, padding 12 24, bg #f7f8fa, holding a dock with radius 12, 1px #dcdee2, bg #feffff: MODE ROW (min 40, padding 0 12, border-b) with the change fact at the left and the save state at the right (12/16 500 #5b5d63 with check 12); optional CHANGE LINES (padding 8 12, gap 4, 13/20 #5b5d63, the section name 500 #101115); FOOT ROW (border-top, padding 6, gap 6) with the primary sm at the far right.
• DEVICE: the guest page is a fixed 390×844 box scaled with transform scale(s), transform-origin top left, inside a wrapper sized 390s×844s with 1px solid #b5b7bd, radius 32s, overflow hidden, bg #121614. No notch and no phone chrome. Default s = 0.9 (351×760), centred horizontally in the stage.
• SELECTION: in edit mode the region of the open section gets a 2px solid #7b65d1 outline 4px outside it (radius 4), with a tag at its top-left just outside the outline: 12/16 500 #feffff on #512da6, padding 2 6, radius 4. It is drawn in admin space as an overlay above the wrapper, not inside the scaled page.
• ADMIN LINE: 13/20 #5b5d63, centred, 12 above the device: facts about what is shown, or ‘Hidden from guests: …’ only when something is hidden.
• GUEST-A — Carved Stillness for Avela Resort, drawn from build/brief-A.json (A1 arrival, A2/A3 after-rating geometry) and build/shared-rules.md, English unless a board says otherwise. NO PHOTO, because uploads are blocked in the beta (do not use any photo blob): the band 0–232 is radial-gradient(120% 90% at 50% 38%, #26302B 0%, #121614 72%) with the shared grain snippet at 5% overlay, and the carved initial ‘A’ (Cormorant Garamond 600 176px #1E2622, text-shadow 0 -1px 0 rgba(0,0,0,.55), 0 1px 0 rgba(238,241,238,.08), centred, baseline y196, aria-hidden). Strip 0–56: ‘AVELA RESORT’ (Cormorant 600 14px, .28em, #F2ECE1) at x24; ‘EN’ (current, 1px #CDAE78 underline 6 below) | ‘БГ’ (#D6CFC3) at the right. h1 248–264 = the portal’s welcome line in uppercase, Ysabeau Office 600 12/16 .18em #D9BE8C, centred. ARRIVAL (A1): legend ‘How was your experience?’ Cormorant 600 32/38 #F2ECE1 at 276–314; five 56px star labels with 40px stars (shared star path, idle stroke #8D8C85) at 334–390; ‘Poor’ and ‘Excellent’ Ysabeau 13/18 #9D968A at 396–414; empty caption slot 420–446; submit 342×52 #D4B57E radius 4 ‘Send privately’ Ysabeau 600 17 #121614 at 462–514; privacy line (lock) ‘Shared privately with Avela Resort.’ Ysabeau 14 #B8B0A3 at 526–546; hairline at 578 and the notice ‘This page counts visits for Avela Resort. No ads or third-party trackers.’ 13/19 #9D968A with ‘Privacy notice’ and ‘Got it’ (#D9BE8C) to 680; description 704–782 ‘Stone, olive shade and water that keeps the last of the light. Thank you for spending part of your day with us.’ Ysabeau 17/26 #D6CFC3 centred; footer 800–844. AFTER RATING (A2/A3): ‘Thank you.’ at 276–314; receipt row 326–370 (16px mini stars filled #CDAE78 or outlined #8D8C85, ‘{word} · sent privately’ 15 #B8B0A3, ‘Change’ 15/600 #D9BE8C underlined); the Google card 394–658, identical for every score (#1A1F1C, 1px #363835, radius 4, padding 24: ‘Share your experience on Google’ Cormorant 600 24/30 #F2ECE1; ‘If you’d like, you can also leave a public review on Google.’ 16/24 #B8B0A3; button 294×52 #D4B57E ‘Continue to Google’ Ysabeau 600 17 #121614 with external-arrow 16; ‘Opens Google · you may need to sign in’ 13 #9D968A centred); the private card 674–866 only at 3★ or below (transparent, 1px #363835, radius 4, padding 24: ‘Add a private note for the team’ Cormorant 600 22/28 #F2ECE1; ‘Optional. Shared privately with Avela Resort.’ 15/22 #B8B0A3; a 48px outline button, 1px #CDAE78, ‘Write a private note’ 16/600 #D9BE8C with pencil); ‘Your response’ row 56; description; the ‘ALSO USEFUL’ label (Ysabeau 600 12/16 .18em #D9BE8C) and 56px link rows (label Ysabeau 600 17/24 #F2ECE1, arrow-up-right 16 #CDAE78, hairlines #363835); footer (‘Privacy notice’ 13/600 #D9BE8C, ‘Made with Reputation Key’ 12 #9D968A). Page bg #121614. In edit mode the scaled page is aria-hidden and inert; the wrapper is one tab stop with role img and an aria-label such as ‘Guest preview: Pool bar, draft, arrival, English’. The admin never takes the guest brand’s colours.

THIS BOARD:
WS-HEADER: ‘Pool bar’ over ‘Avela Resort’; fact: hollow ring ‘Draft · not published’; ⋯.
ROW2 left — STEP LIST (creation mode shows steps instead of tabs until the first publish): <ol aria-label ‘New portal steps’>, 13/20, gap 24: ‘1 Place’ (check 12 #5b5d63, text #5b5d63), ‘2 Experience’ (current: 500 #101115, aria-current step, the 2px #101115 bar), ‘3 Review’, ‘4 Publish and share’ (#5b5d63).
ROW2 right: fact ‘Draft’ (13/20 with the hollow ring; no Draft/Live switch because nothing is live); outline sm select ‘Arrival’ (chevron-down 14); COMPACT TABS ‘EN’ (active) | ‘БГ’; flex spacer; outline sm ‘Try as guest’ (smartphone 16).
EDITOR, top to bottom:
• group label ‘On the guest page’
• Look — palette — ‘Carved Stillness · Avela colours’ — scope ‘Property-wide’
• Welcome — message-square-text — OPEN — ‘Pool bar · Bulgarian uses property wording’ — ‘This portal’. Fields (English, because EN is active):
– ‘Welcome line’: input value ‘Pool bar’; helper ‘Guests see this at the top of the page. Name the place, never a person.’; right-aligned under the helper, a ghost xs ‘Use property wording’ (rotate-ccw 12).
– ‘Short description’: no input yet; 12/16 500 #5b5d63 ‘Using property wording’, then 14/20 #5b5d63 ‘Stone, olive shade and water that keeps the last of the light. Thank you for spending part of your day with us.’, then an outline xs ‘Write for this portal’ (pencil 12).
– Language line (a hairline above, padding-top 16): languages 14 #5b5d63 + 13/20 #101115 ‘English is custom. Bulgarian guests see the property wording ’ + ‘Добре дошли в Avela Resort’ (lang bg) + ‘.’; below it 12/16 #5b5d63 ‘Suggested for a bar: ’ + ‘Бар на басейна’ (lang bg) + ghost xs ‘Use suggestion’.
• Rating and Google — star — ‘Private note at 3★ or below · Google for every guest’ — ‘Always included’
• Useful links — link-2 — ‘No links yet · optional’ — ‘This portal’
• group label ‘Behind the page’
• Languages — languages — ‘English, Български’
• Place and group — map-pin — ‘Restaurant or bar table · Dining’
DOCK (no change lines): MODE ROW left, the fact with a hollow ring ‘Draft · not published’; right ‘Draft saved · just now’. FOOT ROW right: primary sm ‘Review & publish’ (the editor area’s one primary).
STAGE: ADMIN LINE ‘Draft · Arrival · English’ at y180–200; DEVICE at s 0.9, y212–972, centred (x≈890–1241). PREVIEW: GUEST-A Arrival (A1 geometry) with the h1 ‘POOL BAR’. SELECTION around the h1 (guest y240–272) with the tag ‘Welcome’.

STATES: creation mode; never published; English custom and Bulgarian inherited; saved.
INTERACTIVE (mock): section rows toggle open through state (one open at a time); optional: the EN/БГ tabs switch the preview h1 between ‘POOL BAR’ and ‘ДОБРЕ ДОШЛИ В AVELA RESORT’. Drawn only: Try as guest, Use suggestion, Review & publish, menus.
BEHAVIOUR (not drawn): autosave per field 800 ms after typing (‘Saving…’, ‘Draft saved · just now’, ‘Couldn’t save · Retry’, keeping the local text); the preview refreshes 300 ms after typing stops; clicking a region of the preview opens its section. ‘Try as guest’ opens a sheet with one interactive 390 frame and the fact ‘Draft · English · nothing is recorded’ (no rating stored, no scan counted, no one notified, Google never opens: an in-frame card ‘Google would open here’) and a ‘Make the next send fail’ switch.

## ADM06-workspace-links — Portal workspace · Experience with useful links (Property manager)

1440×1024 · group g2

**Purpose.** The everyday editor on a live portal: links with English and Bulgarian labels, curated icons and approval state shown in place, the pending changes in guest words in the dock, and the draft guest page beside it. Drawn as the Property manager sees it.

**What exists and what is new.** Exists: link create, edit and reorder; categories; destination request (Property manager) and approval (Account admin only); iconKey stored but never rendered; the pendingChanges list; a draft/live boolean comparison. New: localized EN/BG labels and a curated icon set (C3); approval state shown in place by joining links to destinations (A3, UI only); change lines in guest words from a field-level diff (A6, B4); the Live preview from the published snapshot (B4); link-removal permission for Property managers (D1, decision).

**Spec.**

MODE B workspace, the Experience tab of the live Reception portal with 4 changes not live. Viewer: Georgi Ivanov, Property manager (TOPBAR-B avatar ‘GI’). This board shows the Property-manager variant: Account-admin items are facts that name Elena Petrova, never disabled buttons. <title>Reception — Experience</title>. Fonts as ADM05. RAIL, TOPBAR-B, WS-HEADER, ROW2, COMPACT TABS, EDITOR and STAGE (640 | 750), SECTIONS, FIELD, DOCK, DEVICE (s 0.9), SELECTION, ADMIN LINE and GUEST-A exactly as defined in ADM05.

WS-HEADER: ‘Reception’ over ‘Avela Resort’; facts: DETAIL ‘● Live · version 5’ (popover ‘Published 12 Sep by Elena Petrova. Codes open this version.’); DETAIL with pencil 14 ‘4 changes not live’ (popover lists all four in guest words with a link ‘Review changes’); ⋯ (menu not drawn: Rename · Duplicate · Discard draft changes… · Pause public page… · Archive… · Portal details).
ROW2 left: line tabs ‘Experience’ (active) · ‘Share’ · ‘Analytics’ · ‘Activity’. ROW2 right: COMPACT TABS ‘Draft’ (active) | ‘Live v5’; outline sm select ‘After rating · 5★’; COMPACT TABS ‘EN’ (active) | ‘БГ’; flex spacer; outline sm ‘Try as guest’ (smartphone 16).
EDITOR (scrolled to the top; the ‘Behind the page’ group sits below the fold and is not visible):
• group label ‘On the guest page’
• Look — palette — ‘Carved Stillness · set by an Account admin’ — ‘Property-wide’
• Welcome — message-square-text — ‘Reception & lobby · Рецепция и лоби’ — ‘This portal’
• Rating and Google — star — ‘Private note at 3★ or below · Google for every guest’ — ‘Always included’
• Useful links — link-2 — OPEN — ‘4 links · 1 hidden from guests’ — ‘This portal’. Inside: link rows 44 tall separated by hairlines. Each row: a grip button 24×32 (grip-vertical 16 #5b5d63, aria-label ‘Reorder {label}’); an icon button 28×28 (outline, radius 6) holding the link’s icon 16 #101115 (aria-label ‘Icon for {label}: {icon}, change’); the label stack — English 14/20 500 #101115 over Bulgarian 12/16 #5b5d63 (lang bg); at the right a status fact, only when the link is not shown to guests; a ghost 32 ⋯ (aria-label ‘Actions for {label}’; menu not drawn: Edit · Move up · Move down · Remove).

1. map-pin · ‘Getting here’ / ‘Как да стигнете’
2. waves · ‘Spa & treatments’ / ‘Спа и процедури’
3. utensils · ‘Dinner at Olive Terrace’ / ‘Вечеря в Маслинова тераса’
4. book-open · ‘Spa menu’ / ‘Bulgarian label missing’ (12/16 500 #a45f00 with circle-alert 12) · status fact 12/16 #a45f00 with clock-3 12 ‘Waiting for an Account admin · hidden from guests’ · ⋯. This row is EXPANDED for editing; its fields sit below it, indented to the label column (padding 12 0 16 64), 16 apart:
   – two fields side by side (gap 16, 240 each): ‘Label · English’ with value ‘Spa menu’; ‘Label · Български’ empty with placeholder ‘Етикет на български’ (lang bg) and helper 12/16 #5b5d63 ‘Bulgarian guests see ‘Spa menu’ until you add one.’
   – ‘Address’: input 496 wide, value ‘https://spa.avela.bg/menu’; helper 12/16 #5b5d63 led by clock-3 12 #a45f00: ‘spa.avela.bg is new for Avela Resort. Elena Petrova (Account admin) was asked to approve it yesterday.’
   – a ghost sm ‘Done’, right aligned.
   After the rows: outline sm ‘Add link’ (plus 16) and, on the same line, 12/16 #5b5d63 ‘Guests see up to 4 links.’
   DOCK: MODE ROW left pencil 14 + DETAIL 13/20 500 ‘4 changes not live’; right ‘Draft saved · 1 min ago’. CHANGE LINES (the first three): ‘Welcome line · ‘Reception’ → ‘Reception & lobby’’; ‘Useful links · added ‘Spa menu’ (hidden until approved)’; ‘Useful links · ‘Getting here’ moved to the top’. FOOT ROW right: primary sm ‘Review & publish’.
   STAGE: ADMIN LINE ‘Hidden from guests: ’ then, in #a45f00 with clock-3 12, ‘Spa menu · waiting for an Account admin’. DEVICE at s 0.9. PREVIEW: GUEST-A after rating at 5★ Excellent (A3 geometry) with the DRAFT content: h1 ‘RECEPTION & LOBBY’; receipt with 5 filled mini stars and ‘Excellent · sent privately’; no private card; links in draft order ‘Getting here’, ‘Spa & treatments’, ‘Dinner at Olive Terrace’ (Spa menu is hidden). The page inside the frame is scrolled with translateY(-312px), so the frame shows guest y312–1156: the Google card near the top, then Your response, the description, ‘ALSO USEFUL’ with the three links, and the footer. SELECTION around the ‘ALSO USEFUL’ label and the three link rows (guest y872–1080) with the tag ‘Useful links’.

STATES: live portal with a pending draft; a link hidden while its address waits for approval; a missing Bulgarian label; saved.
INTERACTIVE (mock): ‘Done’ collapses row 4 (state); ‘Review & publish’ is an <a> to ADM07-review-and-publish.dc.html styled as the primary; optional: ‘Draft | Live v5’ switches the preview to the live version (h1 ‘RECEPTION’, links ‘Spa & treatments’, ‘Dinner at Olive Terrace’, ‘Getting here’). Drawn only: menus, icon pickers, Add link, Try as guest.
BEHAVIOUR: Remove is a draft operation with ‘Undo’ in the toast, never a red button beside the fields. While the server still requires portal.delete, a Property manager sees ‘Ask an Account admin to remove’ in the menu instead (decision D1). Tripadvisor and Booking addresses are labelled ‘Find us on …’ automatically. Keyboard ‘Move up’ and ‘Move down’ sit beside drag (WCAG 2.5.7). Opening the Rating and Google section switches the stage to the 1★/5★ pair (as drawn in ADM07).

## ADM07-review-and-publish — Review & publish (with the 1★/5★ fairness pair)

1440×1024 · group g2

**Purpose.** One decision point: what guests will see change, every check with who can fix it, language completeness, other portals waiting on a property-wide change, and proof that the Google action is the same after 1★ and 5★.

**What exists and what is new.** Exists: the publish preconditions (property active, verified Google link, responsible manager, token, brand profile and content for each locale), destination approval (Account admin), pendingChanges, the separate content-review attestation. New: publish changes while live, an atomic swap (C1 — the hard gate for the whole workspace); the checklist with who-can-fix built from existing reads (A2); the field-level diff in guest words (B4); snapshot and working copy as guest DTOs for the 1★/5★ pair (B4); the accent contrast gate (C2); the reviewed-digest guard (new); batch publish for property-wide changes (decision).

**Spec.**

MODE B workspace, Review & publish for Reception (route …/review). Viewer Elena Petrova (Account admin). <title>Review changes — Reception</title>. Fonts as ADM05. WORKSPACE PARTS and GUEST-A as ADM05; the REVIEW COLUMN replaces the editor (same 640 | 750 split).

WS-HEADER as ADM06 (‘Reception’, DETAIL ‘● Live · version 5’, DETAIL ‘4 changes not live’, ⋯), with the avatar ‘EP’.
ROW2 left: ghost sm <a> ‘Back to editing’ (arrow-left 16), then 14/20 500 ‘Review changes to Reception’. ROW2 right: COMPACT TABS ‘Live v5’ | ‘After publishing’ (active); outline sm select ‘Compare 1★ and 5★’; COMPACT TABS ‘EN’ (active) | ‘БГ’.
REVIEW COLUMN (padding 24, blocks 24 apart, h2 16/24 500):

1. h2 ‘What guests will see change’ + 12/16 #5b5d63 ‘4’. Rows: padding 10 0, border-b, grid 1fr auto, gap 12. Line 1, 13/20: the section name 500 #101115, then ‘ · ’ and the change in #5b5d63. Line 2, 12/16 #5b5d63: who and when. At the right a ghost xs ‘Show’ (eye 12).
   a) ‘Welcome line’ · ‘‘Reception’ → ‘Reception & lobby’ · Български: ‘Рецепция’ → ‘Рецепция и лоби’’ — ‘Georgi Ivanov · yesterday’
   b) ‘Useful links’ · ‘‘Getting here’ moved to the top’ — ‘Georgi Ivanov · yesterday’
   c) ‘Useful links’ · ‘added ‘Spa menu’, hidden until spa.avela.bg is approved’ — ‘Georgi Ivanov · yesterday’
   d) ‘Look (property-wide)’ · ‘accent #C2A26B → #CDAE78 on buttons and stars’ — ‘Elena Petrova · 17 Sep’
2. h2 ‘Checks’. Only the items that need attention are listed. Rows: padding 12 0, border-b, grid 20px 1fr auto, gap 12: a glyph 16; a sentence 14/20 #101115 with 12/16 #5b5d63 ‘Who can fix: …’ under it; one outline sm control at the right.
   a) languages 16 #a45f00 — ‘Bulgarian · 1 field missing. Bulgarian guests would see the English label ‘Spa menu’.’ — ‘Who can fix: you or Georgi Ivanov’ — ‘Add Bulgarian label’
   b) clock-3 16 #a45f00 — ‘Guests won’t see ‘Spa menu’ until spa.avela.bg is approved. You can publish without it.’ — ‘Who can fix: Account admin (you)’ — ‘Approve spa.avela.bg’
   Then a row 32 tall: check 14 #5b5d63 + DETAIL 13/20 ‘7 checks passed’ (popover not drawn: Public code active, opens version 5 · Responsible: Georgi Ivanov, Elena Petrova · Google link verified · Look complete: Carved Stillness · Colours readable on every screen · English complete · Property wording in both languages).
3. h2 ‘Also waiting on other portals’: 13/20 #5b5d63 ‘The look change is also not live on Spa & thermal pools, Olive Terrace restaurant and Guest rooms.’ + a link 13/20 500 ‘Review & publish all 4’.
4. A closed <details>: summary min 44, 14/20 500 #101115 with chevron-right 16, ‘See every guest state’, then 12/16 #5b5d63 ‘7 states in English and Български’.
   DOCK: one row inside the radius-12 dock (padding 8 12): at the left 13/20 #101115 ‘Publishes as version 6’; at the right outline sm ‘Back to editing’ and primary sm ‘Publish changes’ (the area’s one primary; its label is always the next step).
   STAGE — THE FAIRNESS PAIR: padding 20 31. A legend, centred, 12/16 #5b5d63: a 24px sample of a 1px dashed #5b5d63 line + ‘Google card · identical’. Captions 13/20 above each frame: ‘1★ Poor’ 500 + ‘ · after publishing’ #5b5d63; ‘5★ Excellent’ + ‘ · after publishing’. Two DEVICE frames at s 0.85 (332×718, radius 27), gap 24, centred. PREVIEW: GUEST-A after rating, English, after-publishing content (h1 ‘RECEPTION & LOBBY’). Left = 1★ (A2 geometry: 1 filled mini star, ‘Poor · sent privately’, the Google card at 394–658, the private-note card from 674, cut by the frame at 844). Right = 5★ (A3 geometry: 5 filled, ‘Excellent · sent privately’, the Google card at 394–658, Your response at 682–738, the description from 770). OVERLAYS in admin space: (1) one horizontal 1px dashed #5b5d63 line from the left frame’s left edge to the right frame’s right edge at guest y394 (335px below the frames’ top), crossing the gap; (2) on the left frame, a 1px dashed #edcb85 rectangle (radius 4) around the private-note card’s visible part, with a tag inside its top-right corner: 12/16 500 #a45f00 on #fff6dd, padding 2 6, radius 4, ‘Added at 3★ or below · your setting’. Under the frames, a centred figcaption 14/20 #5b5d63: ‘Same Google action for every rating.’

STATES: a live portal with 4 changes, no blockers, two fixable items, a property-wide change fanned out.
INTERACTIVE (mock): ‘Live v5 | After publishing’ switches the h1 in both frames between ‘RECEPTION’ and ‘RECEPTION & LOBBY’ (state); ‘Back to editing’ (both) are <a> to ADM06-workspace-links.dc.html. Drawn only: Show, the two fixes, Publish changes, the details.
BEHAVIOUR (not drawn): ‘Show’ moves the stage to that state and region. ‘Publish changes’ swaps the live version atomically (no outage), toasts ‘Version 6 is live. Printed codes keep working.’ and returns to Experience with the ledger entry written. If the draft changed after this page opened, publishing refuses with ‘Changed since you opened this review · Review again’. A server refusal keeps the page and translates the reason (‘The Google link stopped working a moment ago. Try again when it’s back.’). With an Account-admin-only blocker, a Property manager’s primary becomes ‘Ask an Account admin’. First publish: every item is new, the stage shows Arrival and the 1★/5★ pair per enabled language, and the primary reads ‘Publish portal’ and continues to Share (ADM09). Resuming a paused portal goes through this same review.

## ADM08-property-look — Property look (Account admin)

1440×1024 · group g2

**Purpose.** Brand governance in one place: the composition, three colours with their derived roles and checks, the portals using the look, and the batch publish that follows a property-wide change. The three looks are drawn side by side in the property’s own colours.

**What exists and what is new.** Exists: the brand profile with display name and three hex values (Account admin only; text on background must reach 4.5:1), property localized content (Account admin), approved destinations with approve and disable (Account admin), per-portal pending-change rows for property-wide edits. New: a composition (A/B/C) on the brand profile, pinned with the colour-engine version in each snapshot (C2); the derived colour-role engine with verdicts and the accent contrast gate (C2); a property-level affected-portals read (B5); batch review and publish (decision); ‘Paste three colours’ (UI); a neutral default look at property setup (decision).

**Spec.**

MODE B workspace geometry (editor 640 | stage 750), Property look for Avela Resort. Viewer Elena Petrova, Account admin (only Account admins edit this; Property managers see the same page as facts, e.g. ‘Set by an Account admin · Elena Petrova’, with no dock and no disabled buttons). State: the look was saved on 17 Sep (accent #C2A26B → #CDAE78) and 4 live portals are waiting to publish it. <title>Property look — Avela Resort</title>. Fonts: the guide link with, in the same css2 URL, Cormorant Garamond (ital,wght 0,600;1,500), Ysabeau Office (wght 400;600), Playfair (opsz,wght 5..1200,400..600), Sofia Sans (wght 400;600;700) and Sofia Sans Extra Condensed (wght 800). RAIL, TOPBAR-B, WS-HEADER, ROW2, COMPACT TABS, SECTIONS, DOCK, DEVICE, SELECTION, ADMIN LINE and GUEST-A as ADM05.

WS-HEADER: back ‘Portals’; title ‘Property look’ over ‘Avela Resort’; DETAIL fact ‘Used by 5 portals · 4 live’; no ⋯.
ROW2 left: fact 13/20 #5b5d63 ‘Saved 17 Sep by Elena Petrova’. ROW2 right: outline sm select ‘Preview on: Reception’ (map-pin 16); COMPACT TABS ‘All three looks’ (active) | ‘Selected look’; outline sm select ‘Arrival’; COMPACT TABS ‘EN’ (active) | ‘БГ’.
EDITOR (padding 24, blocks 24 apart, h2 16/24 500; the first three blocks are always open, not an accordion):

1. ‘Composition’: a radiogroup of 3 rows, 8 apart; each row min 56, padding 8 12, radius 6, 1px #dcdee2, gap 12: a 16px radio; name 14/20 500 over a 12/16 #5b5d63 description; at the right a verdict fact 12/16 #5b5d63. The checked row has border #512da6, bg #f6f5fb and a filled #512da6 radio.
   • Carved Stillness (checked) — ‘Dark stage · Cormorant Garamond with Ysabeau Office’ — check 12 #007a3a ‘Suggested for your colours’
   • Folio — ‘Light paper · Playfair with Sofia Sans’ — ‘Readable · stars darkened to #8A6A3C on paper’
   • Table Card — ‘Colour poster · Sofia Sans Extra Condensed’ — ‘Readable · suits restaurants and bars’
2. ‘Colours’: three fields in one row (gap 16, 192 each), labels ‘Background’, ‘Text’, ‘Accent’. Each input is 36 with a 20×20 swatch (radius 4, 1px #dcdee2) at left 8 and the hex in JetBrains Mono 13 #101115: #121614 · #F2ECE1 · #CDAE78. Under the row, a ghost xs ‘Paste three colours’ (copy 12). Then 13/20 500 ‘Derived for guests · Carved Stillness’ and a <dl> of rows 28 tall (grid 16px 168px 1fr auto, gap 12, 13/20): a 16px swatch (radius 4); the role #101115; the hex in JetBrains Mono 12 #5b5d63 plus a note; the verdict ‘Readable’ #5b5d63 with check 12 #007a3a. Rows:
   Stage · #121614 · from your background
   Text · #F2ECE1 · from your text
   Stars and rules · #CDAE78 · your accent
   Small accent text · #D9BE8C · lightened from your accent for small text
   Idle stars · #8D8C85 · your text mixed into the stage
   Button · #D4B57E with a #121614 label
   No raw contrast ratios anywhere.
3. ‘Portals using this look’ + 12/16 #5b5d63 ‘5’: rows 36 (border-b, 13/20, grid 1fr 120px 180px): name 500; a state fact; the effect 12/16 #5b5d63.
   Reception · ‘● Live v5’ · ‘Look not live yet’
   Spa & thermal pools · ‘● Live v3’ · ‘Look not live yet’
   Olive Terrace restaurant · ‘● Live v4’ · ‘Look not live yet’
   Guest rooms · ‘● Live v2’ · ‘Look not live yet’
   Pool bar · hollow ring ‘Draft’ · ‘Uses the new look’
4. Collapsed SECTION rows (56 each; they may fall below the fold): ‘Name on guest pages’ — ‘Avela Resort · also your name in AI replies’; ‘Property wording’ — ‘English and Български · complete’; ‘Trusted link destinations’ — the summary in #a45f00 ‘1 waiting: spa.avela.bg’.
   DOCK: one row (padding 8 12): at the left 13/20 #101115 ‘Saved 17 Sep · 4 live portals are waiting to publish this look’; at the right primary sm ‘Review & publish 4 portals’.
   STAGE: padding 20 15. ADMIN LINE ‘Reception · Arrival · English, in each look’. Three DEVICE frames at s 0.58 (226×490, radius 19), gap 20, centred; under each a caption 13/20: ‘Carved Stillness’ 500 + 12/16 #5b5d63 ‘Selected’; ‘Folio’; ‘Table Card’. The Carved Stillness frame carries the SELECTION outline (clicking a frame selects its composition). PREVIEW:
   • Frame 1 = GUEST-A Arrival with h1 ‘RECEPTION’.
   • Frame 2 = FOLIO IN AVELA’S COLOURS (B1 geometry from build/brief-B.json): paper #F2ECE1 with 3% multiply grain; kicker ‘RECEPTION’ Sofia Sans 600 12/16 .16em #8A6A3C at x28, y12–56, and ‘EN’ | ‘БГ’ (Sofia 600 14; current #121614 with a 1px #8A6A3C underline, the other #4F4B45) at the right; masthead ‘Avela Resort’ in 2 lines, Playfair 500 56/58 #121614, y76–192; Oxford rule at y212–218 (2px #121614, 3px gap, 1px #121614); legend ‘How was your experience?’ Playfair 400 26/32 #121614 at y238–270; five 56px labels with 36px stars (idle stroke #807B72) from x28 at y290–346; ‘Poor’ and ‘Excellent’ Sofia 13 #625D56; submit 338×52 #121614, radius 2, ‘Send privately’ Sofia 600 17 #F2ECE1 at y418–470; privacy ‘Shared privately with Avela Resort.’ Sofia 14 #4F4B45 at y482–502.
   • Frame 3 = TABLE CARD IN AVELA’S COLOURS (C1 geometry from build/brief-C.json): poster 0–280 #CDAE78 with 5% multiply grain; h1 ‘RECEPTION’ Sofia 700 12/16 .14em #121614 at x24 and ‘EN’ | ‘БГ’ #121614 at the right (y12–56); wordmark ‘Avela Resort’ in 2 lines, Sofia Sans Extra Condensed 800 96/84 #121614, y76–244; the fold (1px rgba(0,0,0,.14) at y279, a 1px #E2D8C9 crease and the 16px shade); plate #F2ECE1; legend Sofia 700 28/32 #121614 at y312–344; 56px labels with 42px stars (idle #807B72) at y364–420; endpoints Sofia 600 13 #625D56; submit 342×56 #CDAE78 with a 1.5px #8A6A3C border, ‘Send privately’ Sofia 700 18 #121614, at y500–556; privacy Sofia 14 #4F4B45 at y568–588.

STATES: a saved look with its fan-out waiting; derived roles all readable, one of them lightened; composition verdicts.
INTERACTIVE (mock): the composition radios move the SELECTION outline and the ‘Selected’ caption between frames (state). Drawn only: Review & publish 4 portals, Paste three colours, the selects.
BEHAVIOUR: before a save the dock reads ‘Saving changes the draft of 5 portals. Live pages stay as they are until published.’ with the primary ‘Save look’. A composition that cannot carry the colours shows its reason (e.g. ‘Stars would be too faint on the dark stage with this accent · Folio keeps your colour’) and cannot be selected. ‘Review & publish 4 portals’ opens a batch review listing each portal’s own changes and checks, with opt-out checkboxes and one primary ‘Publish 4 portals’; portals whose drafts also hold unreviewed local edits say so and start unchecked. Every affected portal gets a ledger line, and open workspaces get a toast.

## ADM09-share-print-kit — Share · first publish with the print kit

1440×1024 · group g3

**Purpose.** Turn a first publish straight into something printable while the one-time address is on screen: the code, where it is placed, and a print kit in the property’s own composition with scan-safe rules built in.

**What exists and what is new.** Exists: issuing the public address (one token with exactly one QR and one NFC artifact; the raw token is shown once), a QR PNG with a 2-module margin, planned and immediate replacement, revoke all; codes survive publish, restore, pause and archive. New: the first publish that issues the code and then publishes version 1 (existing commands in sequence); a print-kit PDF per composition with the QR and NFC rules (C4); a QR SVG with a 4-module quiet zone; place names on the two existing artifacts (C4, a small model change; several artifacts per portal come later); kit-download ledger events and token history (B11). Not in the beta: downloading the address again without replacing it (security decision).

**Spec.**

MODE B workspace, the Share tab of Pool bar right after its first publish (creation step 4 lands here). Viewer Elena Petrova. <title>Pool bar — Share</title>. Fonts: the guide link with Cormorant Garamond (ital,wght 0,600;1,500) and Ysabeau Office (wght 400;600). RAIL, TOPBAR-B, WS-HEADER, ROW2 and COMPACT TABS as ADM05. The left column (640) is the SHARE COLUMN (bg #f7f8fa, border-right, no dock); the right is the stage (#f0f2f5) with the print preview.

WS-HEADER: ‘Pool bar’ over ‘Avela Resort’; DETAIL ‘● Live · version 1’ (popover ‘Published just now by Elena Petrova’); ⋯.
ROW2 left: line tabs, ‘Share’ active (tabs replace the step list after the first publish). ROW2 right: COMPACT TABS ‘Print’ (active) | ‘Guest page’; outline sm select ‘Front’ (options Front, Back).
SHARE COLUMN (padding 24, blocks 32 apart, h2 16/24 500):

1. ‘Public code’. A row, gap 24: a QR plate 160×160 (#feffff, 1px #dcdee2, radius 6; inside, the QR filling it with a 4-module quiet zone, dark modules #101115) | a stack, gap 12, 432 wide:
   • 12/16 500 #5b5d63 ‘QR address’; then a row: JetBrains Mono 13/20 #101115 ‘app.reputationkey.app/p/k7Qm4xT2aPz9?accessArtifact=3f1c…’ truncated with an ellipsis, and an outline xs ‘Copy’ (copy 12).
   • ‘NFC address’; ‘app.reputationkey.app/p/k7Qm4xT2aPz9?accessArtifact=9b27…’ and ‘Copy’.
   • fact 13/20 with globe 14 #5b5d63: ‘Opens the live version (1)’
   • fact 13/20 #a45f00 with clock-3 14: ‘Shown once. Download the kit or copy the addresses now.’
2. ‘Where it’s placed’ + 12/16 #5b5d63 ‘2’: a small table with no box: header 12/16 500 #5b5d63 (Place 320 · Channel 120 · Added 120 · 80); rows 44 with border-b, 13/20: ‘Bar counter table tents’ · QR · Today · ghost xs ‘Rename’; ‘Bar NFC card’ · NFC · Today · ghost xs ‘Rename’.
3. ‘Print kit’:
   • ‘Piece’ (label 14/14 500), a radiogroup of 4 choice cards in one row, 148×72, gap 16, padding 12, radius 6 (checked: border #512da6, bg #f6f5fb); title 13/20 500 over size 12/16 #5b5d63: ‘Table tent’ / ‘A6, folded’ (checked); ‘Reception card’ / ‘A6’; ‘NFC card’ / ‘85 × 54 mm’; ‘Sticker’ / ‘60 mm round’.
   • ‘Languages’: inline radios, gap 24, 14/20: (●) ‘English and Български’ (○) ‘English’ (○) ‘Български’.
   • ‘Call to action’: radios stacked 12 apart: (●) ‘Rate your visit – private, about 30 seconds’ (○) ‘How was your visit? Tell us privately’.
   • Actions, gap 8: primary 36 ‘Download print kit’ (download 16; the area’s one primary); outline 36 ‘QR only (SVG)’.
   • A closed <details>: summary min 44, 14/20 #5b5d63 with chevron-right 16, ‘Before you print’.
   STAGE (print preview): padding 24; a centred caption 13/20 #5b5d63 ‘Table tent A6 · front · 105 × 148 mm at 1:1’. ARTWORK, centred: trim 397×559 px plus 3 mm bleed (11px each side) = 419×581, with crop marks (1px #101115 lines 12 long outside each trim corner, 4px off the bleed). PREVIEW — the print in Carved Stillness, the same composition as the guest page: full bleed #121614 with the grain snippet at 5%; a top band 0–190 in radial-gradient(120% 90% at 50% 38%, #26302B 0%, #121614 72%) with the carved ‘A’ (Cormorant 600 150px #1E2622, the screen’s text-shadow); ‘AVELA RESORT’ Cormorant 600 13px .28em #F2ECE1 centred at y24; ‘POOL BAR’ Ysabeau 600 12/16 .18em #D9BE8C centred at y206; the CTA ‘Rate your visit’ Cormorant 600 30/36 #F2ECE1 centred at y232 and ‘Private, about 30 seconds’ Ysabeau 400 15/20 #B8B0A3 at y272; the QR on a bone plate #F2ECE1 170×170, radius 4, centred at y312–482 (dark #121614 modules, 4-module quiet zone inside the plate); the address as text, Ysabeau 400 11/14 #9D968A, centred at y498: ‘app.reputationkey.app/p/k7Qm4xT2aPz9’. No Google logo, no stars, no ‘review us’. Under the artwork, centred 12/16 #5b5d63: ‘QR on a light plate · 4-module quiet zone · error correction M’.
   QR DRAWING (both places): an inline SVG with viewBox 0 0 37 37 (29 modules plus a 4-module quiet zone on each side), shape-rendering crispEdges: three finder patterns at the corners (7×7 dark, 5×5 light, 3×3 dark), one timing row and column, and the data area filled with a <pattern> of an irregular 6×6-module tile clipped to the data area. It only has to look like a QR.
   STATES: first publish; the address on screen once; the table tent preselected from the place type.
   INTERACTIVE (mock): the piece cards are a working radio group that changes the stage caption (state; the artwork need not re-layout). Drawn only: Copy, Download, Rename, the details.
   BEHAVIOUR: leaving this tab before downloading or copying prompts once (‘Leave without the print kit? The address is shown only now.’ with ‘Download print kit’ and ‘Leave’). Later visits show ‘Code active since 19 Sep · QR and NFC · opens version N’ with ‘Replace code to reprint’ (a planned replacement keeps old cards working 1–90 days, default 30), and in ⋯ ‘Turn off all codes…’ (reason required), plus the code history. A ‘Link only’ portal skips the print kit and offers ‘Copy link’, ‘QR (SVG)’ and ‘Share…’. Every download is a ledger event (‘Elena Petrova downloaded the table tent kit · now’). The toast after the first publish reads ‘Pool bar is live. Codes open version 1.’

## ADM10-activity-health — Portal workspace · Activity with health attention

1440×1024 · group g3

**Purpose.** Monitoring and history for one portal in the inbox case pattern: every failing check with who can fix it and one fix, a 30-day vital strip, then the ledger with ‘Make live again…’ on earlier versions.

**What exists and what is new.** Exists: health derivation with one reason at a time, health intervals with listHistory (no caller today), the responsible-managers read and update, the publication history (actor stored but dropped), the content-review attestation (no read of the last one), token status, rollbackPortalPublication (no UI). New: an admin health read, current and history, batched (B1), with a ‘checked at’ time; every failing check listed through the review checklist (A2); a derived check for lapsed link addresses (C7); the actor in history and the last content review (B3); token and artifact events (B11); bounded qualified scans and Google opens (B6); the Inbox portal facet (B9); a portal.health_attention template that names the reason and the fix and deep-links to ?tab=activity (today it opens Settings).

**Spec.**

MODE B workspace, the Activity tab of Spa & thermal pools, which needs attention. Viewer Elena Petrova. <title>Spa & thermal pools — Activity</title>. Fonts as ADM05. RAIL, TOPBAR-B, WS-HEADER, ROW2, COMPACT TABS, DEVICE and GUEST-A as ADM05. There is no stage on this tab, so ROW2 is one full-width segment and the body is one surface. Timeline rules as the Inbox ledger: items padding-bottom 12; a 2px #dcdee2 connector at left 15; sm indicators 24×24 at margin 4 with a 14px #5b5d63 icon for system events; 32×32 indicators with 11px 500 #5b5d63 initials for people (1px #b5b7bd, bg #feffff); sentences 13/20 #5b5d63, padding 6 0, actor and object 500 #101115 joined by ‘ · ’, the time in a <time> with the absolute date as its title.

WS-HEADER: ‘Spa & thermal pools’ over ‘Avela Resort’; facts: DETAIL ‘● Live · version 3’; DETAIL 13/20 #a45f00 with triangle-alert 14 ‘Partly working’; DETAIL with pencil 14 ‘1 change not live’; ⋯.
ROW2: line tabs ‘Experience’ · ‘Share’ · ‘Analytics’ · ‘Activity’ (active), followed by 12/16 500 #a45f00 ‘· 2 issues’.
BODY y156–1024, bg #f7f8fa, padding 24: a MAIN column x73–833 (760) and a SIDE column x873–1209 (336), gap 40, both top-aligned.
MAIN (blocks 24 apart, h2 16/24 500):

1. HEALTH: h2 ‘Health’ + 12/16 #5b5d63 ‘Checked 4 min ago’. Rows: hairlines above and below, padding 16 0, grid 20px 1fr auto, gap 12, control vertically centred:
   a) triangle-alert 16 #a45f00 | 14/20 #101115 ‘No one is responsible for this portal. Publishing is blocked, and alerts and private notes have no one to go to.’ with 12/16 #5b5d63 ‘Since 16 Sep, when Nikolay Stoyanov’s access was removed · Who can fix: a Property manager or Account admin’ | primary sm ‘Assign a manager’ (the first fix is this area’s primary)
   b) link-2-off 16 #a45f00 | ‘Guests don’t see ‘Treatment menu’. Its address stopped passing checks on 15 Sep.’ with ‘Who can fix: Account admin (you)’ | outline sm ‘Review address’
2. LAST 30 DAYS: h2 ‘Last 30 days’ + at the right a link 13/20 ‘Open Analytics’ (arrow-right 12). A <dl> of 5 cells: border-top and border-bottom 1px #dcdee2, 1px vertical dividers, no fill; cell padding 12 16 (the first cell padding-left 0); dt 12/16 500 #5b5d63; value 24/32 700 tabular; context 12/16 #5b5d63:
   ‘Qualified scans’ 96 ‘+11 vs the 30 days before’ (‘+11’ #007a3a) · ‘Private ratings’ 31 ‘32% of scans’ · ‘Average private rating’ 4.6 + star 14 #da950b ‘from 31 · no change’ · ‘Guests who opened Google’ 18 ‘19% of scans’ · ‘Private notes’ (lock 12) 2 ‘1 waiting in Inbox’ (link)
3. HISTORY: h2 ‘History’ + at the right COMPACT TABS ‘All’ (active) · ‘Publishing’ · ‘Codes’ · ‘Health’. Timeline:
   1. sm palette: ‘Elena Petrova’ changed ‘the property look’ · waiting in this draft · 17 Sep
   2. sm user-minus: ‘Elena Petrova’ removed ‘Nikolay Stoyanov’ from Avela Resort · no one is responsible for this portal now · 16 Sep
   3. sm link-2-off: ‘Treatment menu’ stopped passing its address check · hidden from guests · 15 Sep
   4. sm layers: ‘3 routine events’ + ghost xs ‘Show’ (folded: a print-kit download, a content review, a manager change)
   5. EP: ‘Elena Petrova’ published ‘version 3’ · added ‘Treatment menu’ · 28 Aug (the live version; no restore on it)
   6. GI: ‘Georgi Ivanov’ published ‘version 2’ · replaced the welcome line · 30 Jul — drawn in its hover/focus state: row background #f1f0fc, radius 6, and at the right two outline xs buttons ‘View’ and ‘Make live again…’
   7. sm circle-plus: ‘Georgi Ivanov’ created ‘Spa & thermal pools’ · 12 Jul (the last item, no connector)
      SIDE (sections 24 apart, h3 14/20 500, bodies 13/20):
      • ‘Live version’: a DEVICE at s 0.4 (156×338, radius 13) showing GUEST-A Arrival with the h1 ‘SPA & THERMAL POOLS’; 8 below, a link 13/20 ‘Preview live version’.
      • ‘Responsible’: fact 13/20 500 #a45f00 ‘No one’; outline sm ‘Change’; DETAIL 12/16 #5b5d63 ‘Who gets alerts?’ (popover ‘Responsible managers get this portal’s alerts and private notes.’).
      • ‘Public code’: fact ‘QR and NFC · active since 12 Jul’; 12/16 #5b5d63 ‘Opens version 3’; link 13/20 ‘Open Share’.
      • ‘Content review’: ‘Last reviewed 12 Aug by Elena Petrova’; outline sm ‘Record a review’.
      PREVIEW: only the 0.4 thumbnail (GUEST-A Arrival, live version 3).
      STATES: degraded health with two failing checks (the domain’s one reason plus a derived check); folded routine events; a restorable earlier version.
      INTERACTIVE (mock): the ledger COMPACT TABS filter the list (state, optional). Drawn only: Assign a manager (it opens a popover of eligible managers with Save), Review address, Record a review, Make live again… (the dialog is drawn on ADM11 for Reception).
      BEHAVIOUR: a healthy portal replaces the Health rows with one quiet line ‘● Working · guests can rate and open Google’ (see ADM11’s background). Health transitions become ledger events (‘Google link became unavailable · 14 Sep, 09:12’ / ‘Working again · 11:40’). No uptime percentages. Pause (header ⋯) previews the brand-free ‘not available’ page and records ‘Paused by …’; resuming goes through Review.

## ADM11-restore-version — Make an earlier version live again (restore dialog)

1440×1024 · group g3

**Purpose.** Append-only recovery with the confidence of publishing: compare live with the earlier version, re-run its checks, keep the draft, and keep every version’s own number. The background also shows a healthy portal’s quiet health line.

**What exists and what is new.** Exists: rollbackPortalPublication — only while live, only to a lower version; it re-activates the target snapshot under its own version number with a ‘rollback’ activation and emits portal.publication.rolled_back; no UI calls it today. New: the restore dialog (A1, UI); the target snapshot as a guest DTO for the frames and the diff (B4); re-running checks on the target (A2 reuse); the actor in history (B3). Not possible today: Undo after a restore (making a higher version live again is a rule change; open decision).

**Spec.**

MODE B workspace, the Activity tab of the HEALTHY Reception portal with the restore dialog open. Viewer Elena Petrova. <title>Make version 4 live again — Reception</title>. Fonts as ADM05. The background is the ADM10 layout for Reception, drawn fully and then covered by the modal overlay rgba(0,0,0,.5) over the whole board, rail included.
BACKGROUND: WS-HEADER ‘Reception’ over ‘Avela Resort’, facts ‘● Live · version 5’ and pencil ‘4 changes not live’, ⋯. ROW2 tabs with ‘Activity’ active (no issue count). MAIN: HEALTH is one quiet line, no rows: a 7px #101115 dot + 13/20 #101115 ‘Working · guests can rate and open Google’ + 12/16 #5b5d63 ‘Checked 2 min ago’. LAST 30 DAYS strip: ‘Qualified scans’ 133 ‘+6 vs the 30 days before’ · ‘Private ratings’ 41 ‘31% of scans’ · ‘Average private rating’ 4.5★ ‘from 41 · ↑ 0.1 vs the 30 days before’ · ‘Guests who opened Google’ 23 ‘17% of scans’ · ‘Private notes’ 3 ‘2 waiting in Inbox’. HISTORY (the ADM10 timeline style): sm pencil ‘Georgi Ivanov’ made ‘6 draft edits’ · yesterday; sm palette ‘Elena Petrova’ changed ‘the property look’ · waiting in this draft · 17 Sep; EP ‘Elena Petrova’ published ‘version 5’ · replaced the welcome line, added ‘Getting here’ · 12 Sep; sm download ‘Georgi Ivanov’ downloaded ‘the reception card kit’ · 4 Sep; GI ‘Georgi Ivanov’ published ‘version 4’ · 28 Aug — in its hover state with outline xs ‘View’ and ‘Make live again…’ (this button shows the focus ring: it opened the dialog); sm circle-plus ‘Georgi Ivanov’ created ‘Reception’ · 3 Jul. SIDE: ‘Live version’ thumbnail (h1 ‘RECEPTION’); ‘Responsible’: discs GI and EP + ‘Georgi Ivanov, Elena Petrova’ + outline sm ‘Change’; ‘Public code’: ‘QR and NFC · active since 3 Sep’, ‘Opens version 5’; ‘Content review’: ‘Last reviewed 12 Sep by Elena Petrova’.
DIALOG (role dialog, aria-modal true, labelled by its title): centred, width 512, bg #f7f8fa, 1px #dcdee2, radius 8, padding 24, flex column, gap 16, shadow 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1); a close x 16 at top 16, right 16, opacity .7 (aria-label ‘Close’). Top to bottom:

1. Title 18/22 700 ‘Make version 4 live again?’; 8 below, 14/20 #5b5d63 ‘Guests will see version 4 again. Nothing is deleted: version 5 stays in the history, and your draft keeps its 4 changes.’
2. Two facts, 13/20: a 7px #101115 dot ‘Live now · version 5 · published 12 Sep by Elena Petrova’; a 7px #b5b7bd dot ‘Version 4 · published 28 Aug by Georgi Ivanov’.
3. A controls row: COMPACT TABS ‘Arrival’ (active) | ‘After rating’ | ‘Done’; at the right COMPACT TABS ‘EN’ (active) | ‘БГ’.
4. The frames row, centred, gap 24: captions 12/16 #5b5d63 above, ‘Live now · v5’ and ‘Version 4’; two DEVICE frames at s 0.4 (156×338, radius 13). PREVIEW: GUEST-A Arrival; the left h1 ‘RECEPTION’, the right h1 ‘FRONT DESK’.
5. h3 14/20 500 ‘What changes for guests’; lines 13/20 #5b5d63: ‘Welcome line · ‘Reception’ → ‘Front desk’’; ‘Useful links · ‘Getting here’ goes away and ‘Pool timetable’ comes back’.
6. h3 ‘Checks on version 4’; rows 13/20 each led by a 14px glyph: circle-alert #a45f00 + ‘‘Pool timetable’ no longer passes its address check, so guests won’t see it.’; check #007a3a + #5b5d63 ‘Google link verified · responsible managers set’.
7. 12/16 #5b5d63 ‘Your draft is based on version 5. After this, guests see version 4 and your 4 draft changes stay unpublished.’
8. Footer, justify end, gap 8: outline 36 ‘Cancel’; primary 36 ‘Make version 4 live’.
   STATES: a healthy portal (quiet health); a modal restore with re-run checks.
   INTERACTIVE (mock): optional — the ‘Arrival | After rating | Done’ tabs switch both frames (state). Drawn only: Cancel, Close, Make version 4 live.
   BEHAVIOUR: confirming runs the existing rollbackPortalPublication, which is allowed only while the portal is live and only to a lower version. Version 4 keeps its number. The ledger gets ‘Elena Petrova made version 4 live again · replaced version 5 · now’. The toast reads ‘Version 4 is live again. Printed codes keep working.’ with NO Undo, because making version 5 live again would need a rule change (open decision). The header then reads ‘● Live · version 4 (made live again)’ and the draft keeps its changes. The action is hidden when the portal is not live.

## ADM12-phone-portal-health — Phone · Portal detail from a health alert

390×844 · group g3

**Purpose.** The phone job that matters most: open the alert, see what is wrong and who can fix it, and act on the first fix without hunting.

**What exists and what is new.** As ADM10: the admin health read (B1), all failing checks (A2), the derived lapsed-address check (C7), bounded measures (B6) and the Inbox facet (B9) are new; the notification deep link to ?tab=activity is new (today it opens Settings); the phone workspace layout is UI only.

**Spec.**

PHONE 390×844, the portal workspace on a phone, landed on from the portal.health_attention notification (?tab=activity). Viewer Elena Petrova. <title>Spa & thermal pools — Activity (phone)</title>. Inbox phone density: controls 36, menu rows 44, gutters 16. Timeline rules as ADM10.
• TOPBAR-PHONE y0–52 as ADM04.
• WS-HEADER-PHONE y52–108, border-b, padding 0 8 0 4, gap 8: ghost 44 ‘Back to portals’ (arrow-left 20); the title stack ‘Spa & thermal pools’ 16/24 500 over ‘Avela Resort’ 12/16 #5b5d63; flex spacer; fact 12/16 500 #a45f00 with triangle-alert 12 ‘Partly working’; ghost 44 ⋯ ‘Portal actions’.
• TABS y108–156, border-b: horizontally scrollable line tabs, padding 0 16, gap 20: ‘Experience’, ‘Share’, ‘Analytics’, ‘Activity’ (active, the 2px #101115 bar) followed by 12/16 500 #a45f00 ‘· 2’ with sr-only ‘issues’.
• CONTENT, padding 16, blocks 20 apart:

1. Health (from y172): h2 16/24 500 ‘Health’ + 12/16 #5b5d63 ‘Checked 4 min ago’. Two stacked rows, each with border-b and padding 12 0:
   a) triangle-alert 16 #a45f00 + 14/20 #101115 ‘No one is responsible for this portal. Publishing is blocked, and alerts and private notes have no one to go to.’; 12/16 #5b5d63 ‘Who can fix: a Property manager or Account admin’; a full-width primary 36 ‘Assign a manager’ (the one primary).
   b) link-2-off 16 #a45f00 + ‘Guests don’t see ‘Treatment menu’. Its address stopped passing checks on 15 Sep.’; ‘Who can fix: Account admin (you)’; a full-width outline 36 ‘Review address’.
2. ‘Last 30 days’ (h2 16/24 500 + a link 13/20 ‘Analytics’ at the right): a <dl> in 2 columns on a hairline grid (border-y, 1px dividers), cells padding 10 12, dt 12/16 500 #5b5d63, value 18/28 700 tabular, context 12/16 #5b5d63: ‘Qualified scans’ 96 ‘+11 vs the 30 days before’ (‘+11’ #007a3a); ‘Private ratings’ 31 ‘32% of scans’; ‘Average private rating’ 4.6 + star 14 ‘from 31 · no change’; ‘Guests who opened Google’ 18 ‘19% of scans’; ‘Private notes’ (lock 12) 2 ‘1 waiting in Inbox’, spanning both columns.
3. ‘History’ (h2): the timeline, with the first two events visible and cut by the board edge: sm palette ‘Elena Petrova’ changed ‘the property look’ · waiting in this draft · 17 Sep; sm user-minus ‘Elena Petrova’ removed ‘Nikolay Stoyanov’ from Avela Resort · no one is responsible now · 16 Sep.
   No guest preview on this board.
   STATES: needs attention; two failing checks; the fix first.
   INTERACTIVE (mock): the back arrow is an <a> to ADM04-phone-portals.dc.html. Drawn only: Assign a manager. It opens a bottom sheet (not drawn): the title ‘Who is responsible for Spa & thermal pools?’, checkboxes ‘Elena Petrova (you) · Account admin’ and ‘Georgi Ivanov · Property manager’, the helper ‘They get this portal’s alerts and private notes.’ and the primary ‘Save’; the toast then reads ‘Georgi Ivanov is responsible for Spa & thermal pools.’

## ADM13-analytics-property — Portal analytics · property portfolio

1440×1600 · group g4

**Purpose.** An honest answer to ‘are our portals working?’ across the property: a funnel in guest order, weekly volume with the average, the rating mix, and a table of places with group roll-ups and period comparison that follows the 10-rating rule, without ranking anything.

**What exists and what is new.** Exists: single-portal analytics with an equal prior window and the 10-rating comparison floor; property sums of portal.scan and portal.feedback (operational scans, not qualified); Goals’ monthly qualified_scans, portal_rating_count and portal_rating_average at property, group and portal scope (internal queryGoalMetric). New: this route and view; qualified scans in bounded windows (B6); Google opens separated from link selections (B6); property- and group-scope private-rating count and average — widen the portal.rating registry scope or wrap queryGoalMetric (B7, governance decision); the range model aligned to ?range= (A8).

**Spec.**

MODE A standard page, dashboard tier. The board is 1440×1600 because a long analytics page is the point. Viewer Elena Petrova. <title>Portal analytics — Avela Resort</title>. SIDEBAR (Portals selected), TOPBAR, MAIN, PAGEHEADER, BUTTONS, FACT and TABLE as ADM01. Sections 24 apart; section h2 18/28 700, letter-spacing -0.45px, 12 above its content. Charts follow the app’s ChartFrame: bars #5b5d63 with a top radius of 4, lines #101115 at 2px, horizontal grid dashed 3 3 #edeef1, no axis or tick lines, 12px ticks #5b5d63; purple is never data.

TOP TO BOTTOM:

1. PAGEHEADER: breadcrumb Properties › Avela Resort › Portals › Analytics; h1 ‘Portal analytics’; description ‘Avela Resort · all portals · 21 Jun – 18 Sep’. Actions: outline 44 select ‘All portals’ (layers 16; menu not drawn: All portals · Dining · Wellness · each portal); the range group (role group, aria-label ‘Time range’, gap 4): four 44-tall buttons, min-width 80, 14/500: ‘30 days’, ‘90 days’ (aria-pressed true, secondary #f0f2f5 fill), ‘6 months’, ‘All time’ (ghost). There is no primary on this page.
2. h2 ‘At a glance’. A <dl> of 5 cells: border-top and border-bottom 1px #dcdee2, 1px dividers, no fill; cells padding 16 (the first padding-left 0): the dt 14/20 500 #5b5d63 is a DETAIL (dotted; its popover holds a one-sentence definition); value 30/36 700 tabular; context 14/20 #5b5d63:
   ‘Qualified scans’ 1,087 — ‘+117 vs the 90 days before’ (‘+117’ #007a3a) · ‘Private ratings’ 310 — ‘29% of scans’ · ‘Average private rating’ 4.4 + star 16 #da950b — ‘from 310 · ↑ 0.1 vs the 90 days before’ (‘↑ 0.1’ #007a3a) · ‘Guests who opened Google’ 159 — ‘15% of scans’ · ‘Private notes’ (lock 14) 24 — ‘3 waiting in Inbox’ (link).
   Definitions (popovers, not drawn): Qualified scans = QR or NFC arrivals the server verified, counted once per visit; Private ratings = ratings guests sent privately on a portal; Average private rating = their mean, always shown with how many; Guests who opened Google = guests who chose ‘Continue to Google’ after rating — a click, not a review; Private notes = notes guests added privately.
3. h2 ‘From scan to Google’. A figure: the bars at the left (860 wide), a 1px #dcdee2 vertical hairline, and an aside at the right (244). Bars: 3 rows 36 tall, 12 apart, grid 200px 1fr 260px, gap 12: a label 14/20 500; a bar 20 tall, radius 4, #5b5d63, at its true width relative to the first (100%, 28.5%, 14.6%; never clamped); a value 14/20 tabular. Rows: ‘Qualified scans’ ‘1,087’; ‘Private ratings’ ‘310 · 29% of scans’; ‘Guests who opened Google’ ‘159 · 15% of scans · 51% of rated guests’. Aside: lock 14 + 14/20 500 ‘Private notes 24’, and under it 12/16 #5b5d63 ‘Offered at 3★ or below’. Figcaption 14/20 #5b5d63: ‘29% of qualified scans led to a private rating, and 15% to a guest opening Google.’
4. Two columns, gap 32. LEFT (740), h2 ‘Over time’: a ChartFrame whose figcaption row reads 14/20 #5b5d63 ‘Weekly qualified scans, with the average private rating on the right axis.’ and carries the two-series legend at its right (8×8 swatches radius 2: #5b5d63 ‘Qualified scans’, #101115 ‘Average private rating’, 12px). Plot 240 tall: left y axis 32 wide (0, 50, 100), right axis 1–5; 13 weekly bars 71, 78, 84, 92, 95, 101, 97, 88, 83, 79, 76, 72, 71; x labels (at most 8): 22 Jun, 6 Jul, 20 Jul, 3 Aug, 17 Aug, 31 Aug, 14 Sep; a line of weekly averages, points only for weeks with at least 5 private ratings (all qualify): 4.3, 4.4, 4.4, 4.3, 4.4, 4.5, 4.4, 4.4, 4.3, 4.4, 4.4, 4.5, 4.4. Below, a <details> ‘View chart values’ (min 44, 14/20 #5b5d63). RIGHT (364), h2 ‘Rating mix’: distribution rows, 160 in total (5 rows, grid 32px 1fr auto, gap 8, 14/20): ‘5★’ 500 tabular, an 8px round track #f0f2f5 with a #5b5d63 fill, ‘196 · 63%’ right aligned (min-width 80); ‘4★’ ‘68 · 22%’; ‘3★’ ‘24 · 8%’; ‘2★’ ‘12 · 4%’; ‘1★’ ‘10 · 3%’. Caption 14/20 #5b5d63 ‘From 310 private ratings.’
5. h2 ‘By portal’. TABLE (property-list pattern), columns (1136): Portal 300 · Qualified scans 120 · vs the 90 days before 136 · Private ratings 120 · Average private rating 136 · vs the 90 days before 136 · Guests who opened Google 104 · Private notes 84. Header 56 (labels wrap). Group rows 44 (#f7f8fa, 13/20 500); portal rows 48 (name link 14/500, no meta); the total row 52. Deltas: counts as signed absolute numbers (‘+21’ #007a3a, ‘−3’ #d00021); averages as ‘↑ 0.2’ #007a3a, ‘↓ 0.1’ #d00021 or ‘No change’ #5b5d63.
   • Wellness · 286 · +21 · 91 · 4.6★ · No change · 52 · 4
   Spa & thermal pools · 286 · +21 · 91 · 4.6★ · No change · 52 · 4
   • Dining · 351 · +40 · 97 · 4.2★ · ↓ 0.1 · 41 · 11
   Olive Terrace restaurant · 351 · +40 · 97 · 4.2★ · ↓ 0.1 · 41 · 11
   Pool bar · one merged cell, 13/20 #5b5d63 ‘Not published yet’
   • Not in a group · 450 · +56 · 122 · 4.4★ · ↑ 0.2 · 66 · 9
   Guest rooms · 38 · ‘New · live since 2 Sep’ (#5b5d63) · 4 · DETAIL ‘Too few’ · ‘Too few to compare’ (#5b5d63) · 2 · 0
   Reception · 412 · +18 · 118 · 4.4★ · ↑ 0.2 · 64 · 9
   • Total ‘All portals’ (border-top #b5b7bd, 500) · 1,087 · +117 · 310 · 4.4★ · ↑ 0.1 · 159 · 24
   Caption 12 below, 14/20 #5b5d63: ‘Last 90 days (21 Jun – 18 Sep) against the 90 days before, Europe/Sofia time. Averages compare only when both periods have at least 10 private ratings. Sorted by group, then name.’
   No guest preview. No ranks, medals, ‘top/bottom’ labels, or staff, shift or person dimensions; Google opens are never split by star.
   STATES: 90 days; one portal below the average floor and new this period; one draft.
   INTERACTIVE (mock): the range buttons toggle aria-pressed (state; the figures do not need to change). Drawn only: the scope select, sort headers, ‘View chart values’, definitions.
   BEHAVIOUR: ‘All time’ shows no deltas. Thin data gets one sentence and one action (‘Too few private ratings in the 30 days before to compare. Show 90 days.’). An availability line (‘Filling in · …’) appears only when a measure is not ready. Group scope (?scope=group:dining) uses this same layout.

## ADM14-analytics-portal — Portal workspace · Analytics (single portal)

1440×1024 · group g4

**Purpose.** ‘Is this place working for us?’ for one portal: five honest measures with n, the funnel in guest order with private notes beside it, the rating mix, and weekly volume with the average and version ticks, with comparisons only where the sample allows.

**What exists and what is new.** Exists: getPortalAnalytics for one portal (bounded windows with an equal prior window, rating distribution, daily trend, evidence states, the 10-rating floor) and the lifetime view. New: bounded ‘Qualified scans’ (today bounded ‘Scans’ is operational portal.scan and must not be relabelled) and ‘Guests who opened Google’ split from link selections (B6); useful-link selections; version ticks from the publication history with its actor (B3); ?range= 30/90/180/all with a 90-day default instead of the 7/60 presets, the All-time default and localStorage (A8); the Inbox portal facet (B9); retire ‘Review Clicks’ (A9).

**Spec.**

MODE B workspace, the Analytics tab of Reception. Viewer Elena Petrova. <title>Reception — Analytics</title>. RAIL, TOPBAR-B, WS-HEADER, ROW2 as ADM05. No stage: the preview is hidden on this tab. Body bg #f7f8fa, padding 24, content max 1000, left aligned at x73–1073, blocks 32 apart, h2 16/24 500. Chart rules as ADM13.

WS-HEADER: ‘Reception’ over ‘Avela Resort’; DETAIL ‘● Live · version 5’; DETAIL with pencil ‘4 changes not live’; ⋯.
ROW2 left: line tabs, ‘Analytics’ active. At the right end of ROW2: the range group (role group, aria-label ‘Time range’, gap 4): 32-tall buttons, min-width 72, 13/500: ‘30 days’, ‘90 days’ (pressed, secondary #f0f2f5), ‘6 months’, ‘All time’.
TOP TO BOTTOM:

1. Metric strip, a <dl> of 5 cells (border-y, dividers, no fill, cell padding 12 16, the first padding-left 0): the dt 12/16 500 #5b5d63 is a DETAIL; value 24/32 700 tabular; context 12/16 #5b5d63:
   ‘Qualified scans’ 412 — ‘+18 vs the 90 days before’ (‘+18’ #007a3a) · ‘Private ratings’ 118 — ‘29% of scans’ · ‘Average private rating’ 4.4 + star 14 #da950b — ‘from 118 · ↑ 0.2 vs the 90 days before (from 104)’ · ‘Guests who opened Google’ 64 — ‘16% of scans’ · ‘Private notes’ (lock 12) 9 — ‘2 waiting in Inbox’ (link).
2. Two columns, gap 40. LEFT (560), h2 ‘From scan to Google’: rows 36, 12 apart (grid 176px 1fr 200px): ‘Qualified scans’, bar 100%, ‘412’; ‘Private ratings’, 28.6%, ‘118 · 29% of scans’; ‘Guests who opened Google’, 15.5%, ‘64 · 16% of scans · 54% of rated guests’; bars 20 tall, #5b5d63, radius 4. Under a hairline (12 above and below): lock 14 + 14/20 500 ‘Private notes 9’ + 12/16 #5b5d63 ‘Offered at 3★ or below’. RIGHT (400), h2 ‘Rating mix’: ‘5★’ ‘78 · 66%’; ‘4★’ ‘22 · 19%’; ‘3★’ ‘9 · 8%’; ‘2★’ ‘5 · 4%’; ‘1★’ ‘4 · 3%’ (the ADM13 distribution style); caption 14/20 #5b5d63 ‘From 118 private ratings.’
3. h2 ‘Over time’ (full 1000): a figcaption row 14/20 #5b5d63 ‘Weekly qualified scans and the average private rating. Ticks mark when a version went live.’ with the two-series legend at its right; plot 240 tall: bars 27, 29, 30, 31, 33, 35, 36, 34, 33, 32, 31, 30, 31 (left axis 0, 20, 40); the average line on the right axis 1–5: 4.3, 4.3, 4.4, 4.2, 4.4, 4.5, 4.4, 4.3, 4.4, 4.5, 4.4, 4.5, 4.6; x labels 22 Jun, 6 Jul, 20 Jul, 3 Aug, 17 Aug, 31 Aug, 14 Sep. VERSION TICKS: two 1px #b5b7bd vertical rules across the plot at 28 Aug and 12 Sep, each labelled at the plot top with a 12/16 #5b5d63 DETAIL, ‘v4’ and ‘v5’ (popover ‘Version 5 published 12 Sep by Elena Petrova’; no claim about cause). A <details> ‘View chart values’.
4. A row: link-2 14 #5b5d63 + 14/20 ‘Useful links opened’ + 14/20 500 tabular ‘37’; at the right, a <details> summary ‘About these measures’ (14/20 #5b5d63, min 44).
   No guest preview.
   STATES: 90 days, both periods above the comparison floor.
   INTERACTIVE (mock): the range buttons toggle aria-pressed (state). Drawn only: the details, ‘2 waiting in Inbox’ (it opens Inbox Feedback filtered to this portal).
   BEHAVIOUR: when either period has fewer than 10 private ratings, the average shows its n and one sentence with one action, e.g. ‘Too few private ratings in the 30 days before to compare.’ and ‘Show 90 days’. Below 5 ratings the average is withheld (‘3 private ratings so far, too few for an average’). All time shows no deltas. Never shown: Google opens by star, staff, or this portal against other portals.
