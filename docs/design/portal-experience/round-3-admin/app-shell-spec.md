# Reputation Key admin: app shell and component spec

Every number here comes from the code on `main` at `878268bf1` (worktree
`rk-portal-redesign`), not from memory. It is written for mockup builders
who draw `.dc.html` boards with inline styles. Read `ADMIN_BUILD_GUIDE.md`
first. Where this spec and the guide disagree, this spec describes what the
real app renders, and the disagreement is flagged with **(guide differs)**.

## 0. Conversion rules (read once)

| Tailwind                          | px                                                                     |     | Tailwind                 | px           |
| --------------------------------- | ---------------------------------------------------------------------- | --- | ------------------------ | ------------ |
| `text-xs`                         | 12 / lh 16                                                             |     | `h-7` `size-7`           | 28           |
| `text-[13px]`                     | 13 / lh inherits: use 20 (inbox writes `leading-5`) or 18 in list rows |     | `h-8` `size-8`           | 32           |
| `text-sm`                         | 14 / lh 20                                                             |     | `h-9` `size-9`           | 36           |
| `text-base`                       | 16 / lh 24                                                             |     | `h-10`                   | 40           |
| `text-lg`                         | 18 / lh 28                                                             |     | `h-11`                   | 44           |
| `text-2xl`                        | 24 / lh 32                                                             |     | `h-12`                   | 48           |
| `text-3xl`                        | 30 / lh 36                                                             |     | `h-13`                   | 52           |
| `tracking-tight`                  | -0.025em (24px: -0.6px; 18px: -0.45px)                                 |     | `h-14`                   | 56           |
| `rounded-sm/md/lg/xl`             | 4 / 6 / 8 / 12                                                         |     | `w-56`                   | 224          |
| `gap-1 / 1.5 / 2 / 3 / 4 / 6 / 8` | 4 / 6 / 8 / 12 / 16 / 24 / 32                                          |     | `size-3 / 3.5 / 4` icons | 12 / 14 / 16 |

**Font weights.** The app renders Satoshi 400 / 500 (`font-medium`) / 600
(`font-semibold`). The board has 400, 500 and 700 only, and CSS asks for 600
and gets the 700 face. So: at 16px and below, draw app 600 as **500**. At 18px
and above (h1, h2, big figures), draw app 600 as **700**. That matches the
guide's "500 for semibold" and "700 for titles".

**Links.** `styles.css` has an unlayered rule: every `<a>` that is not a
button, a sidebar row or a badge renders **#512da6**, with no underline, and
**#431096** on hover. It beats Tailwind utilities. So breadcrumb links,
settings sub-nav labels and table name links are all purple in the real app.
Figures that are links pin their ink to #101115 on purpose (`text-foreground!`).

**Focus.** Controls get `border-color #7b65d1` plus
`box-shadow: 0 0 0 3px rgba(123,101,209,.5)`. The guide's global
`:focus-visible{outline:2px solid #7b65d1;outline-offset:2px}` is fine for
boards.

**Snippets.** In the HTML snippets below, `{name N}` stands for the §19 SVG
drawn at N px, and `…` stands for repeated content.

**Shadows (Tailwind v4)**: `xs` `0 1px 2px 0 rgba(0,0,0,.05)` · `sm`
`0 1px 3px 0 rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1)` · `md`
`0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1)` · `lg`
`0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)` · `xl`
`0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)`.

## 1. Extra colours (beyond the guide's table)

Composites are computed over the surface they sit on (sRGB alpha).

| Use                                                               | Value                                     |
| ----------------------------------------------------------------- | ----------------------------------------- |
| Primary button hover (`primary/90`)                               | #6242ae                                   |
| Destructive button hover                                          | #e23743                                   |
| Secondary button hover (`secondary/80`)                           | #f3f4f7                                   |
| Table row hover, stock (`muted/50` on white)                      | #f7f8fa                                   |
| Property-list row hover (`muted/40` on white)                     | #f9fafb                                   |
| KPI tile / list-card hover on page ground (`muted/40` on #f7f8fa) | #f4f5f8                                   |
| Inbox list row hover (`accent-muted/40` on #f7f8fa)               | #f1f0fc                                   |
| Selected row / active nav / outline+ghost hover (`bg-accent`)     | #e7e4ff                                   |
| Inactive tab label (`foreground/60` on muted)                     | #6a6b6f                                   |
| Sidebar group label (`sidebar-foreground/70`)                     | #56575a                                   |
| Chart grid line (`border/50` on white)                            | #edeef1                                   |
| Empty star outline (`muted-foreground/40` on white)               | #bdbec1                                   |
| Focus ring (`ring/50`)                                            | rgba(123,101,209,.5)                      |
| Warn line (`--warn-line`)                                         | rgba(225,175,74,.6) → #edcb85 on #fff6dd  |
| Warn track (`--warn-track`)                                       | rgba(228,182,92,.22) → #f3ead8 on #f7f8fa |
| Modal overlay                                                     | rgba(0,0,0,.5)                            |
| Skeleton fill (`bg-accent`, pulsing)                              | #e7e4ff                                   |
| Tooltip                                                           | bg #101115, text #f7f8fa                  |
| Destructive menu item focus (`destructive/10`)                    | #fbe9ea                                   |

Surfaces to remember: `bg-background` is **#f7f8fa** and `bg-card` /
`bg-popover` is **#feffff**. Outline buttons, dialogs and sheets use
`bg-background` (#f7f8fa). Inputs are transparent. Menus, popovers, tables
and summary strips are #feffff.

Dark theme, if a board needs it: background #06070a · surface/card #101116 ·
elevated #181a20 · border #26292f · border-strong #3f424a · text #e6e8ed ·
secondary #9c9ea5 · tertiary #616369 · accent (icons, nav) #886de9 · primary
button #765ad4 · link #9f86ff · accent-muted #161227 · muted #191a1f ·
positive #43c07a · negative #ff4c4d · warn #f5af20 on #231806 · rating
#fcb52c · ring #6a53bd.

## 2. App shell geometry (desktop, 1440 × 1024)

```
x=0            256 (+1px border-r)                                   1440
┌──────────────┬─────────────────────────────────────────────────────────┐ y=0
│ Sidebar      │ Top bar 52px, border-b, px 16                            │
│ 256px        ├─────────────────────────────────────────────────────────┤ y=52
│ bg #f7f8fa   │ <main> bg #f7f8fa, padding 32 top/bottom, 24 left/right │
│ border-r     │   PageShell: centered, max-width by tier                 │
│ #dcdee2      │   standard 1024 → x 336–1360 · dashboard 1200 → fills    │
│              │   1136 (x 280–1416) · narrow 768 → x 464–1232            │
│              │   vertical rhythm 32px between blocks (20px on phone)    │
└──────────────┴─────────────────────────────────────────────────────────┘
```

There are two page modes. Pick one per board.

- **A. Standard page** (Properties, Overview, Ratings, Portals today): the
  top bar, then `<main>` with padding, `PageShell` and a `PageHeader` (§5).
  Sections float on #f7f8fa. Tables and strips are white panels with a
  1px border and radius 8.
- **B. Workspace** (Inbox): the sidebar collapses to a **48px icon rail**
  and the top bar keeps its 52px height, with no sidebar trigger on
  desktop. `<main>` has no padding and fills to the bottom. Columns are
  separated only by hairlines: queue rail 224 | list panel 400 (min 320,
  max 50%) | 6px resize handle (#dcdee2 at 50%) | detail (min 480). Each
  column has a 56px header with `border-b`. At 1440 the detail is about 762
  wide.

Shell recipe (mode A, property scope, Portals active). It goes inside the
guide's 1440 × 1024 root, which is `display:flex`:

```html
<nav
  aria-label="Primary navigation"
  style="width:256px;flex:none;height:100%;box-sizing:border-box;display:flex;flex-direction:column;background:#f7f8fa;border-right:1px solid #dcdee2"
>
  <div style="padding:8px">
    <button
      type="button"
      aria-label="Avela Resort"
      style="display:flex;align-items:center;gap:8px;width:100%;height:48px;padding:8px;border:0;border-radius:6px;background:transparent;text-align:left;font:14px/1.25 Satoshi,system-ui,sans-serif;color:#101115"
    >
      <span
        style="width:32px;height:32px;flex:none;border-radius:8px;background:#e7e4ff;color:#512da6;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500"
        >AR</span
      >
      <span style="display:grid;flex:1;min-width:0"
        ><span style="font-weight:500">Avela Resort</span
        ><span style="font-size:12px;color:#5b5d63">avela-resort</span></span
      >
      <span style="color:#512da6">{chevrons-up-down 16}</span>
    </button>
  </div>
  <div style="flex:1;padding:8px">
    <ul
      style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px"
    >
      <li style="position:relative">
        …Dashboard row (padding-right 32) + chevron-right button at top 6 / right 4…
      </li>
      <li style="position:relative">
        …Reviews row…
        <span
          style="position:absolute;right:4px;top:6px;height:20px;min-width:20px;padding:0 6px;border-radius:9999px;background:#df202e;color:#fff;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center"
          >3</span
        >
      </li>
      <li>…People…</li>
      <li>…Portals (active)…</li>
      <li>…Goals…</li>
      <li>…Property settings…</li>
    </ul>
  </div>
  <div style="padding:8px">…Settings row…</div>
</nav>
<div style="flex:1;min-width:0;display:flex;flex-direction:column;background:#f7f8fa">
  <header
    style="height:52px;flex:none;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid #dcdee2"
  >
    <button
      type="button"
      aria-label="Toggle sidebar"
      style="width:28px;height:28px;margin-left:-4px;border:0;border-radius:6px;background:transparent"
    >
      {panel-left 16}
    </button>
    <span style="flex:1"></span>
    <button
      type="button"
      style="height:32px;padding:0 10px;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:6px;background:transparent;font:500 14px/20px Satoshi,system-ui,sans-serif;color:#101115"
    >
      {message-square-plus 16} Feedback
    </button>
    <button
      type="button"
      aria-label="Notifications"
      style="width:32px;height:32px;border:0;border-radius:6px;background:transparent"
    >
      {bell 16}
    </button>
    <button
      type="button"
      aria-label="Account menu"
      style="width:32px;height:32px;border:0;border-radius:9999px;background:transparent;display:flex;align-items:center;justify-content:center"
    >
      <span
        style="width:28px;height:28px;border-radius:9999px;background:#512da6;color:#feffff;font-size:10px;font-weight:500;display:flex;align-items:center;justify-content:center"
        >EP</span
      >
    </button>
  </header>
  <main style="flex:1;overflow:hidden;padding:32px 24px">
    <div
      style="max-width:1024px;margin:0 auto;display:flex;flex-direction:column;gap:32px"
    >
      …PageHeader, blocks…
    </div>
  </main>
</div>
```

## 3. Sidebar (`manager-sidebar.tsx`, `ui/sidebar.tsx`)

The sidebar is for PropertyManager and AccountAdmin. Members get no sidebar,
only the top bar. It is a `<nav aria-label="Primary navigation">`, 256px wide
(**guide differs: 240**), bg #f7f8fa, `border-right: 1px solid #dcdee2`,
and a flex column the full height of the board.

| Block   | Box                                                                                   |
| ------- | ------------------------------------------------------------------------------------- |
| Header  | padding 8. It holds the property switcher tile (below).                               |
| Content | flex 1, gap 8. One group, padding 8. The menu `<ul>` is a flex column with **gap 4**. |
| Footer  | padding 8. One row: **Settings**.                                                     |
| Rail    | an invisible 16px hover strip on the right edge. Do not draw it.                      |

**Nav row** (`SidebarMenuButton`, size default): height 32, padding 8,
gap 8, radius 6, 14/20 text #101115 at weight 400, 16px icon. **Every
sidebar icon is #512da6**, active or not. **Hover and active** both fill
#e7e4ff. **Active** is also weight 600 (draw 500), and its label **stays
#101115** (**guide differs: purple label**). An **inert** row (no property
yet, or a capability missing) has opacity .5 and gets a tooltip. X
positions: row x 8–248, icon x 16, label x 40.

**Order** (property scope, e.g. Avela Resort, page = Portals):

| #      | Label                                     | lucide icon          | Route                               | Notes                                                                                                                                                                                                                     |
| ------ | ----------------------------------------- | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Dashboard                                 | `layout-dashboard`   | /properties/$id                     | A category. The row has `padding-right 32`. A 20×20 chevron button (`chevron-right` 16px, #101115, radius 6) sits absolute at top 6, right 4, and rotates 90° when open. It is open only when a dashboard page is active. |
| 1a–d   | Overview · Ratings · Google · Guest voice | none                 | …, /ratings, /google, /guests       | Sub-list `<ul>`: margin 0 14px, padding 2px 10px, `border-left 1px #dcdee2`, gap 4. Sub-row: height 28, padding 0 8, radius 6, 14px #101115. Active: #e7e4ff plus weight 600.                                             |
| 2      | Reviews                                   | `message-square`     | /properties/$id/reviews (the Inbox) | A trailing count badge when new items exist: absolute right 4, top 6. Pill height 20, min-width 20, padding 0 6, radius 9999, bg #df202e, text #fff 12px 500 tabular, margin-left 6.                                      |
| 3      | People                                    | `users`              | …/people                            | Needs `staff.use`.                                                                                                                                                                                                        |
| 4      | Portals                                   | `globe`              | …/portals                           | Needs `portal.read`. Active in the portal admin boards.                                                                                                                                                                   |
| 5      | Goals                                     | `target`             | …/goals                             | Needs `goal.use`.                                                                                                                                                                                                         |
| 6      | Property settings                         | `sliders-horizontal` | …/settings                          |                                                                                                                                                                                                                           |
| footer | Settings                                  | `settings`           | /settings/profile                   | Opens the org Settings sidebar.                                                                                                                                                                                           |

**Property switcher tile** (the header row, `size="lg"`): height 48,
padding 8, gap 8, radius 6, hover #e7e4ff. From left to right:

- A 32×32 tile, radius 8, bg #e7e4ff, with the initials **AR** in #512da6,
  12px, 600 (draw 500 or 700).
- A text column in 14px (line-height 1.25): the name "Avela Resort" at 600
  (draw 500) on top, and the slug "avela-resort" in 12px #5b5d63 below.
- A `chevrons-up-down` 16px icon, #512da6, margin-left auto.

Its menu is a dropdown 256 wide:

- A label, "Properties", 12px 500 #5b5d63.
- A separator.
- One 14px item per property, with "Active" in 12px #5b5d63 at the right
  of the current one.
- A separator.
- "View all properties" (`building-2`).
- "Import property" (`plus`), AccountAdmin only.

**Org scope** (/properties, the import flow, no property chosen): the tile
shows `building-2` 16px #512da6 in a 32px tile with bg #e7e4f2, "Select
property" on top and "No property selected" below. Reviews links to
`/inbox` (All properties). Dashboard, People, Portals, Goals and Property
settings are inert (opacity .5). Organisation settings live in a separate
**Settings sidebar** (/settings/*):

- Header row: "Back to app" with `arrow-left`.
- Group "**You**": Profile `user` · Security `shield` · Preferences
  `palette` · Notifications `bell`.
- Group "**Organization**": Organization `building-2` · Members `users` ·
  Integrations `plug` · AI overview `brain-circuit`.
- Group labels are 32px tall, padding 0 8, 12px 500 in #56575a, sentence
  case, not uppercase.

**Collapsed / icon mode** (always on in the Inbox): 48px wide. Each row is
32×32 with its icon centred at padding 8, and the tile becomes a bare 32px
square. Labels, sub-lists and badges are hidden. Tooltips open to the right:
bg #101115, 12px text in #f7f8fa, padding 6 12, radius 6.

```html
<!-- nav row: normal / active / inert -->
<a
  href="#"
  style="display:flex;align-items:center;gap:8px;height:32px;padding:8px;box-sizing:border-box;border-radius:6px;font-size:14px;line-height:20px;color:#101115;text-decoration:none"
  ><svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#512da6"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    …</svg
  ><span>Reviews</span></a
>
<a href="#" aria-current="page" style="…same…;background:#e7e4ff;font-weight:500"
  >…Portals</a
>
<span aria-disabled="true" style="…same…;opacity:.5">…Goals</span>
```

## 4. Top bar and user menu (`app-top-bar.tsx`)

A `<header>`, height 52, `border-bottom 1px #dcdee2`, padding 0 16, a flex
row with gap 8, bg #f7f8fa. From left to right:

1. The sidebar trigger: a ghost button, 28×28, radius 6, holding
   `panel-left` 16px #101115, with margin-left -4. It is hidden on desktop
   in the Inbox.
2. A flex spacer.
3. **Feedback**: a ghost button, height 32, padding 0 10, gap 8, with
   `message-square-plus` 16 and "Feedback" in 14px 500 #101115.
4. **Notifications**: a ghost icon button, 32×32, radius 6, with `bell` 16.
   When unread, a 16px circle sits at top -2, right -2: bg #512da6, 9px 700
   #feffff.
5. **Account**: a ghost 32×32 fully round button holding a 28px circle, bg
   #512da6, with "EP" in 10px 600 #feffff.

Account menu: a dropdown 192 wide, aligned to the end. It has:

- A header: "Elena Petrova" in 14px 500 over the email in 12px #5b5d63.
- A separator.
- A theme item with `sun`, `moon` or `monitor`. It reads "Dark mode", "Light
  mode" or "System theme".
- A separator.
- "Sign out" with `log-out`.

There is no breadcrumb or search in the top bar.

## 5. Page header anatomy

**Standard `PageHeader`** (mode A), with 12px between its rows:

1. An optional back link: `arrow-left` 14 plus 14px text. It is an `<a>`,
   so it renders #512da6.
2. The breadcrumb `<nav aria-label="breadcrumb">`: an `<ol>` in 14/20 text,
   #5b5d63, gap 10.
   - Links are #512da6 (the global `a` rule).
   - The separator is `chevron-right` 14px.
   - The current crumb is #101115 at 400.
   - Example: `Properties › Avela Resort › Portals`.
3. The title row: flex, wrap, `justify-content:space-between`,
   `align-items:flex-start`, gap 12.
   - Left: the `<h1>` in **24/32, 600 (draw 700), letter-spacing -0.6px**,
     #101115. Under it, 4px lower, an optional description in 14/20
     #5b5d63.
   - Right: the actions, a flex row with gap 8. At most one primary button,
     36px tall.

Total height is about 88px with a breadcrumb and a description. The next
block starts 32px below. **(guide differs: its "56px header, 18–20px
title" is the workspace header below, not this one.)**

**Workspace header** (mode B, from the Inbox list and detail headers):
height 56, `border-bottom 1px #dcdee2`, padding 0 12 in the list and 0 24
in the detail, `align-items:center`, gap 8.

- Title: 14/20, 600 (draw 500), #101115. A count may follow: 12px #5b5d63,
  tabular.
- Meta line under the title: 12px #5b5d63.
- Trailing controls: 32px ghost or outline buttons.

The detail header uses `message-square` at **24px** #5b5d63 before the name
and a 32px ghost `x` to close.

```html
<header style="display:flex;flex-direction:column;gap:12px">
  <nav aria-label="Breadcrumb">
    <ol
      style="display:flex;gap:10px;align-items:center;margin:0;padding:0;list-style:none;font-size:14px;line-height:20px;color:#5b5d63"
    >
      <li><a href="#" style="color:#512da6;text-decoration:none">Properties</a></li>
      <li aria-hidden="true">{chevron-right 14}</li>
      <li><a href="#" style="color:#512da6;text-decoration:none">Avela Resort</a></li>
      <li aria-hidden="true">{chevron-right 14}</li>
      <li aria-current="page" style="color:#101115">Portals</li>
    </ol>
  </nav>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
    <div>
      <h1
        style="margin:0;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.6px"
      >
        Portals
      </h1>
      <p style="margin:4px 0 0;font-size:14px;line-height:20px;color:#5b5d63">…</p>
    </div>
    <div style="display:flex;gap:8px">…one primary…</div>
  </div>
</header>
```

## 6. Tabs (`ui/tabs.tsx`)

**Default (segmented)** is used by the portal detail (Settings · Links ·
Share · Analytics) and by Properties (Workspace · Removed).

- The list: inline-flex, height 36, padding 3, radius 8, bg #f0f2f5.
- A trigger: height 29, padding 4 12 (the stock padding is 8), radius 6,
  1px transparent border, gap 6, 14/20 at 500, text #6a6b6f. Its icon is
  14px (`settings`, `link-2`, `share-2`, `chart-column` on the portal
  tabs).
- The active trigger: bg #f7f8fa, text #101115, shadow-sm.
- A count after the label is tabular, #5b5d63.
- The list sits 8px above the panel (16px on Properties).

**Line variant**: a transparent list with gap 4. The active trigger has no
fill. Instead, a 2px #101115 bar sits 5px below the trigger, spanning its
full width.

**Composer mode tabs** (Inbox dock), the compact form:

- The list: padding 2, radius 6, bg #f0f2f5, gap 2.
- A trigger: height 26, padding 0 10, radius 4, 13px, #5b5d63. Active is
  600 on #f7f8fa.
- In note mode the list is #f3ead8 and the active text is #a45f00.

## 7. Buttons (`ui/button.tsx`)

Base: inline-flex, centred, gap 8, radius 6, 14/20 at **500**, no wrap,
16px icons. Disabled is opacity .5.

| Size                               | Height                   | Padding x (with icon) | Other                                                  |
| ---------------------------------- | ------------------------ | --------------------- | ------------------------------------------------------ |
| default                            | 36                       | 16 (12)               |                                                        |
| sm                                 | 32                       | 12 (10)               | gap 6. **The standard control in the inbox language.** |
| xs                                 | 24                       | 8 (6)                 | 12px text, gap 4, 12px icon                            |
| lg                                 | 40                       | 24 (16)               |                                                        |
| icon / icon-sm / icon-xs / icon-lg | 36 / 32 / 24 / 40 square | 0                     |                                                        |

| Variant           | Rest                                                 | Hover               |
| ----------------- | ---------------------------------------------------- | ------------------- |
| default (primary) | bg #512da6, text #feffff                             | bg #6242ae          |
| outline           | bg **#f7f8fa**, 1px #dcdee2, text #101115, shadow-xs | bg #e7e4ff          |
| secondary         | bg #f0f2f5, text #101115                             | #f3f4f7             |
| ghost             | transparent, #101115                                 | bg #e7e4ff          |
| destructive       | bg #df202e, text #fff                                | #e23743             |
| link              | #512da6, no bg                                       | underline, offset 4 |

Touch targets: the dashboard and Properties keep 44px controls
(`min-h-11`), so the range buttons and "All reviews" are 44 there. The Inbox
uses 32 on desktop and 36 on phone.

**ButtonGroup**: members touch with no gap. The inner corners are square,
and every member after the first has no left border. A **CaseFact** member is
unboxed: no border, no bg, no shadow, 13px at 400, padding 0 10. A fact
that leads the group has padding-left 0. Where a fact meets a control, the
control keeps its full radius and left border.

```html
<button
  type="button"
  style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:0;border-radius:6px;background:#512da6;color:#feffff;font:500 14px/20px Satoshi,system-ui,sans-serif"
>
  {plus 16} Create portal
</button>
<button
  type="button"
  style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid #dcdee2;border-radius:6px;background:#f7f8fa;box-shadow:0 1px 2px rgba(0,0,0,.05);color:#101115;font:500 14px/20px Satoshi,system-ui,sans-serif"
>
  Show: All {chevron-down 14}
</button>
<button
  type="button"
  aria-label="Actions for Reception"
  style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:#5b5d63"
>
  {ellipsis 16}
</button>
```

## 8. Form controls

| Control                                           | Anatomy                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Label**                                         | 14px, 500, line-height 14 (none), #101115. A flex row with gap 8 when it wraps a checkbox or switch.                                                                                                                                                                                                                                                                      |
| **Field**                                         | A vertical stack: label, control, then error, gap **12**. A field group spaces its fields **28** apart (checkbox groups 12).                                                                                                                                                                                                                                              |
| **Helper text**                                   | 14/20 #5b5d63 in settings cards, or 12/16 #5b5d63 in dialogs. It sits under the control and is referenced by `aria-describedby`.                                                                                                                                                                                                                                          |
| **Error**                                         | 14px 400 #df202e. The control gets a 1px #df202e border and a ring of rgba(223,32,46,.2).                                                                                                                                                                                                                                                                                 |
| **Input**                                         | Height 36, radius 6, 1px #dcdee2, **transparent bg**, padding 4 12, 14px #101115, shadow-xs. The placeholder is **#5b5d63** (never tertiary). Focus: border #7b65d1 plus a 3px ring.                                                                                                                                                                                      |
| **Search input** (InputGroup)                     | Same box. A `search` 16px #5b5d63 addon sits at left 12 and the text at left 36. The Properties toolbar uses 288px wide and 44 tall (36 on desktop md+). The Portals list uses 384 max.                                                                                                                                                                                   |
| **Textarea**                                      | min-height 64, padding 8 12, otherwise as Input.                                                                                                                                                                                                                                                                                                                          |
| **Select trigger**                                | Height 36 (sm 32), padding 8 12, gap 8, radius 6, 1px #dcdee2, transparent, shadow-xs, 14px. A `chevron-down` 16px sits at opacity .5. The placeholder is #5b5d63.                                                                                                                                                                                                        |
| **Select / dropdown menu**                        | bg #feffff, 1px #dcdee2, radius 6, padding 4, shadow-md, min-width 128. An item is padding 6 8 (select: 6 32 6 8), radius 4, 14px, gap 8, with a 16px #5b5d63 icon. Focus fills #e7e4ff. The select's `check` 16 sits at the right edge. A label is padding 6 8, 14px 500 (select: 12px #5b5d63). A separator is 1px #dcdee2, margin 4 -4. Destructive items are #df202e. |
| **Native select** (the threshold field today)     | 1px #dcdee2, radius 6, bg #f7f8fa, padding 8 12, full width.                                                                                                                                                                                                                                                                                                              |
| **Checkbox**                                      | 16×16, radius 4, 1px #dcdee2, shadow-xs. Checked: bg and border #512da6 with `check` 14px #feffff.                                                                                                                                                                                                                                                                        |
| **Switch**                                        | Track 32 × 18.4, fully round, 1px transparent. Off #dcdee2, on #512da6. Thumb 16px circle, #f7f8fa, 1px inset from the track; it moves 14px when on.                                                                                                                                                                                                                      |
| **Choice card** (`FieldLabel` wrapping a `Field`) | 1px #dcdee2, radius 6, padding 16. Checked: border #512da6 and bg #f6f5fb.                                                                                                                                                                                                                                                                                                |
| **Kbd**                                           | Height 20, min-width 20, padding 0 4, radius 4, bg #f0f2f5, 12px 500 #5b5d63.                                                                                                                                                                                                                                                                                             |

```html
<div style="display:flex;flex-direction:column;gap:12px">
  <label for="t" style="font:500 14px/14px Satoshi,system-ui,sans-serif"
    >Offer a private note at</label
  >
  <select
    id="t"
    style="height:36px;padding:0 12px;border:1px solid #dcdee2;border-radius:6px;background:transparent;font-size:14px;color:#101115;box-shadow:0 1px 2px rgba(0,0,0,.05)"
  >
    …
  </select>
  <p id="t-help" style="margin:0;font-size:14px;line-height:20px;color:#5b5d63">
    Google stays available to every guest.
  </p>
</div>
```

## 9. Tables

**Stock `Table`** (portal list today): 14px text. Header cells are 40 tall,
padding 0 8, 500, #101115, left aligned, with a `border-bottom` under the
header row. Body cells have padding 8. Each row has a 1px #dcdee2
`border-bottom`, except the last. Row hover is #f7f8fa; a selected row is
#f0f2f5. A single-line row is about 37px.

**Property list pattern** (the reference for new admin tables,
`property-list-table.tsx`):

- The container: bg #feffff, 1px #dcdee2, radius 8, overflow hidden.
  There is no card shadow and no title inside it.
- The header row (no hover): each `th` is 40 tall with padding 0 16. It
  holds a **sort button**: height 32, **12px 500 #5b5d63**, then an
  `arrow-up-down` 14 at opacity .4. The active column is #101115 with
  `arrow-up` or `arrow-down`. Numeric columns are right aligned, with the
  icon before the text.
- A body cell has padding **12 16**. The rows run:
  - one text line (20) → 44px;
  - name plus a meta line (20 + 2 + 16) → about 62px.
- Hover is #f9fafb.
- Column widths from the code: figures 96, "Needs attention" 224, setup
  208, actions 56 (padding 12 8, a 32px ghost `ellipsis` button in
  #5b5d63).
- **The name is the row's one link**: 14px 500 #512da6, underlining on
  hover. The meta line is 12px #5b5d63, a gap of 8 between facts (e.g.
  "Bulgaria"). A warning fact in that line reads `link-2-off` 12 plus
  "Not linked" in 12px 500 #a45f00.
- **Figures** are tabular and right aligned. A rating reads "4.3" 500, then
  a gold `star` 14 (#da950b, filled), then an sr-only "stars". Missing
  data reads "No ratings" in #5b5d63, never a dash.
- **An attention cell** reads a count in 600 (draw 500), then
  "· 2 overdue" in 12px 500 #d00021, or "· 3 waiting" in 12px #5b5d63.
  "Nothing waiting" is #5b5d63.
- **A progress cell** draws seven 10 × 6 segments, radius 2, gap 2: done
  ones are rgba(16,17,21,.7) and the rest #dcdee2. Then "5 of 7" in 14px,
  tabular. Done reads `check` 14 #007a3a plus "Done" in #5b5d63.
- A **Paused** tag is the only chip in the row: a secondary badge (§10).
- One muted line under the table in 14px #5b5d63 states the basis ("Ratings
  and review counts are all-time.").

**Toolbar** above the table: a flex row, wrapping, gap 8. It holds:

1. The search input.
2. An outline sm button with `list-filter`: "Show: All".
3. An outline sm button with `arrow-down-up`: "Sort: Needs attention".
4. When filtered, "3 of 7" in 14px #5b5d63, tabular.
5. When filtered, a ghost "Clear" button.

The toolbar sits 16px above the table. On Properties the controls are 36px
tall on desktop (44 below md).

**Summary strip** (`<dl>` above the toolbar): a grid whose 1px gaps show
the #dcdee2 bg through, so the cells look split by hairlines. It has a 1px
#dcdee2 border, radius 8, overflow hidden, with up to 4 equal cells. Each
cell is #feffff, padding 12 16, a column with gap 4:

- The `dt`: 12px 500 #5b5d63.
- The value: **18/28, 600 (draw 700), tabular** #101115.
- The detail: 12px #5b5d63.

A cell that filters the list is a `<button aria-pressed>`: padding 4 6,
radius 6, hover #f0f2f5, #f0f2f5 when pressed. The strip has no icons and
no cards.

```html
<div
  style="background:#feffff;border:1px solid #dcdee2;border-radius:8px;overflow:hidden"
>
  <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:20px">
    <thead>
      <tr style="border-bottom:1px solid #dcdee2">
        <th scope="col" style="height:40px;padding:0 16px;text-align:left">
          <button
            type="button"
            style="display:inline-flex;align-items:center;gap:4px;height:32px;border:0;background:none;padding:0 4px;font:500 12px/16px Satoshi,system-ui,sans-serif;color:#5b5d63"
          >
            Portal {arrow-up-down 14, opacity .4}
          </button>
        </th>
        …
      </tr>
    </thead>
    <tbody>
      <tr style="border-bottom:1px solid #dcdee2">
        <td style="padding:12px 16px">
          <a href="#" style="color:#512da6;font-weight:500;text-decoration:none"
            >Reception</a
          >
          <div style="margin-top:2px;font-size:12px;line-height:16px;color:#5b5d63">
            Lobby desk · QR and NFC
          </div>
        </td>
        <td style="padding:12px 16px;text-align:right;font-variant-numeric:tabular-nums">
          128
        </td>
        …
      </tr>
    </tbody>
  </table>
</div>
```

## 10. Badges, facts, details, chips, stars

| Kind                               | Look                                                                                                                                                                                                                                                | When                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Badge** (base)                   | inline-flex, radius 9999, 1px transparent, padding 2 8, **12/16 500**, gap 4, 12px icon, about 22 tall.                                                                                                                                             | Rarely.                                                                |
| Badge variants                     | default #512da6 / #feffff (today on "Published", **retire it: purple is interactive-only**) · secondary #f0f2f5 / #101115 ("Paused") · outline 1px #dcdee2 / #101115 (Draft / Disabled / Archived today) · destructive #df202e / #fff (nav count)   |                                                                        |
| **Fact** (`CaseFact`)              | Plain 13px 400 text, **no box**. A 7px dot, gap 8, the word. Dot colours: open, published or healthy **#101115**; closed or past **#b5b7bd**; attention **#a45f00** (always with the word). Or a 14px glyph before the text.                        | Status that cannot be changed from here.                               |
| **Detail**                         | A fact whose words carry `text-decoration: underline dotted currentColor; text-underline-offset:4px`, solid on hover or when open, `cursor:help`, min-height 32. It is a real `<button>` that opens a popover. The text keeps its tone colour (§1). | Anything that has an explanation, like "Due in 3 h" or glossary terms. |
| **Tone ink** for facts             | neutral #5b5d63 · warning #a45f00 · negative #d00021 · positive #007a3a. Always paired with words or an arrow. Warn ink never sits on #f0f2f5 (4.44:1 fails).                                                                                       |                                                                        |
| **Owner disc**                     | A 20px circle with 10px 600 initials. As a fact it is #dcdee2 / #101115. On a control it is #e7e4ff / #512da6, turning #f7f8fa on hover.                                                                                                            | People.                                                                |
| **Attention chip** (Overview only) | min-height 44, radius 9999, 1px border, padding 4 16, 14px 500, gap 6, 16px icon, then a count in 600. Destructive: border rgba(223,32,46,.3), bg #fbe9ea, text #df202e. Warning: border #edcb85, bg #fff6dd, text #a45f00.                         | Links to work only.                                                    |
| **Stars**                          | Filled `star` in #da950b (fill = stroke). Empty is a stroke only, #bdbec1. Sizes: 12 (xs, default), 13 (sm, thread), 14 (rows), 16 (strip). The number is always printed beside them.                                                               |                                                                        |

A fact group inside a toolbar: `[● Published · v4]` (fact) `[Owner ⌄]` (outline sm) `[Publish changes]` (primary, the one in this area).

```html
<span
  style="display:inline-flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:#101115"
  ><span
    aria-hidden="true"
    style="width:7px;height:7px;border-radius:50%;background:#101115"
  ></span
  >Published · v4</span
>
<button
  type="button"
  style="display:inline-flex;align-items:center;gap:6px;min-height:32px;border:0;background:none;padding:0;font-size:13px;color:#a45f00;cursor:help"
>
  {clock-3 14}<span
    style="text-decoration:underline dotted currentColor;text-underline-offset:4px"
    >Google destination needs a check</span
  >
</button>
```

## 11. Inbox anatomy (the visual language to borrow)

| Region            | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Queue rail**    | 224 wide, `border-right`, bg #f7f8fa, flex column. The optional **scope select** comes first: padding 16 12 0, an outline sm button at full width with `building-2` 16 #5b5d63, 13px 500 text and `chevrons-up-down` at opacity .5. Then the scroll area, padding 16 12. It opens with a **rail label**: 11px, 600 (draw 700), `letter-spacing:.14em`, uppercase, #5b5d63, padding 0 8, margin-bottom 8. This is the only uppercase in the app.                                                                                                                                   |
| Rail row          | A ghost button: height 32, padding 0 8, gap 8, 13px 500, full width, left aligned, 16px icon in #101115. Active fills #e7e4ff with #101115 text, not purple. A count sits at margin-left auto: 12px #5b5d63 tabular, or #d00021 for Escalated. Rows are 4 apart. A separator (1px, margin 12 0) comes before the last row.                                                                                                                                                                                                                                                        |
| Rail footer       | `border-top`, padding 12: a ghost 32px row "Keyboard shortcuts" with a Kbd "?" at the right.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Queues (manager)  | Needs reply `inbox` · Awaiting approval `shield-check` · Waiting for Google `send` · Feedback `message-square-text` · Escalated `flag` · Mine `circle-user-round` · Open `layers` · ─ · Closed `archive`.                                                                                                                                                                                                                                                                                                                                                                         |
| **List header**   | Height 56, `border-bottom`, padding 0 12. Title "Needs reply" 14px 600 plus a count 12px #5b5d63, with the scope line under it (12px #5b5d63). Then 32px controls: a ghost `search` icon button (search takes over the header row when opened), then a ButtonGroup of [Filter popover trigger · a sort select sm with `arrow-up-down` "Newest"]. The ghost "Select" button appears on phone only.                                                                                                                                                                                 |
| **List row**      | A fixed **78px** height, `border-bottom`, padding 12. Hover #f1f0fc. Active or checked #e7e4ff. Its parts, left to right:<br>• A 20px gutter with an 8px #101115 "new" dot at top 6, replaced by a checkbox on hover.<br>• Line 1 (13/18): `star` 14 #da950b, then "4" tabular, then the name 500, then "· Avela Resort" #5b5d63.<br>• Lines 2–3 (13/18, clamped to 2, 36 tall), in #5b5d63. Signals come first in 500 #101115 ("Escalated ·" in #d00021 with `flag` 12).<br>• A trailing column, 44 wide: the age "2 h" in 12px #5b5d63 on top and the owner disc at the bottom. |
| **Detail header** | Height 56, `border-bottom`, padding 0 24. It holds `message-square` 24 #5b5d63, the property name 14px 600, "· google" 12px #5b5d63, then the copy menu and a ghost 32 `x`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Case toolbar**  | min-height 48, `border-bottom`, padding 4 24, `flex-wrap`, gap 4 12. A ButtonGroup of fact and controls, then the detail at margin-left auto.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Ledger**        | A scroll region, padding 24, a column with gap 24. It holds a Timeline (§12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Composer dock** | A region with `border-top`, padding 16 24, max-height 60%. The dock is **radius 12**, 1px #dcdee2, bg #feffff. Its rows:<br>• A mode row: min-height 42, `border-bottom`, holding the mode tabs (§6) and a save state (12px 500) at the right.<br>• A textarea: padding 10 12, 15px, line-height 1.625, min-height 72, no border.<br>• A foot row: `border-top`, padding 6, gap 6. The primary sm button sits at the far right.<br>A private note turns the dock to `border-style:dashed`, #edcb85 on #fff6dd.                                                                    |
| Empty detail      | Centred, gap 16, with a `border-left`. It shows a 56px `inbox` glyph in #e7e4ff at opacity .3 (`text-accent` resolves to accent-muted, so it is nearly invisible), then "No message selected" in 16px 600, then one 14px line in #8a8c91.                                                                                                                                                                                                                                                                                                                                         |

## 12. Timeline / ledger (`ui/timeline.tsx`)

- **Item**: `position:relative; display:flex; gap:12px; padding-bottom:12px`
  (0 on the last). A guest message uses padding-bottom 20.
- **Indicator (default)**: 32×32 circle, 1px **#b5b7bd**, bg #feffff,
  11px 600 #5b5d63. It holds initials or a 16px icon, or a photo that fills
  it.
- **Indicator (sm)**: 24×24 at margin 4, so it still fills the 32 column,
  with a 14px icon. Use it for system events.
- **Connector**: absolute, left 15, width 2, bg #dcdee2, from top 32 (28 for
  sm) down to the next item. Hidden on the last item.
- **Event sentence**: 13/20 #5b5d63, padding 6 0. The actor and the object
  are 500 #101115, joined by " · ". The time is relative, in a `<time>`
  with the absolute date as its title. Example: **Elena Petrova**
  published **version 4** · Replaced the Spa welcome line · 2 h ago.
- **Event body** (optional): 13/20 #5b5d63, margin-bottom 4. A private
  note leads with `lock` 14.
- **Message header**: 13px #5b5d63, gap 12. It opens with an `<h2>` in
  16/24 600 (draw 500) #101115, then stars at 13 with the value, then the
  date.
- **Private note**: the indicator is #edcb85 on #fff6dd with #a45f00. The
  body box has radius 8, a **1px dashed** #edcb85 border, bg #fff6dd and
  padding 12 16. Its label "Internal note" is 12px 500 #a45f00.
- Event icons in the code: `circle-plus` created · `rotate-ccw` reopened ·
  `circle-check` closed · `user-plus` / `user-minus` assignment ·
  `triangle-alert` escalated · `shield-check` approved · `clipboard-check`
  handled · `layers` bulk · `history` legacy.

```html
<ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">
  <li style="position:relative;display:flex;gap:12px;padding-bottom:12px">
    <span
      aria-hidden="true"
      style="flex:none;margin:4px;width:24px;height:24px;border:1px solid #b5b7bd;border-radius:50%;background:#feffff;display:flex;align-items:center;justify-content:center;color:#5b5d63;box-sizing:border-box"
      >{icon 14}</span
    >
    <span
      aria-hidden="true"
      style="position:absolute;left:15px;top:28px;bottom:-4px;width:2px;background:#dcdee2"
    ></span>
    <p style="margin:0;padding:6px 0;font-size:13px;line-height:20px;color:#5b5d63">
      <b style="font-weight:500;color:#101115">Elena Petrova</b> published
      <b style="font-weight:500;color:#101115">version 4</b> ·
      <time datetime="2026-09-19T08:10">2 h ago</time>
    </p>
  </li>
</ol>
```

## 13. Dashboard patterns (KPIs, strips, range, charts)

**Section**: an `<h2>` in **18/28, 600 (draw 700), letter-spacing
-0.45px**, sentence case, no eyebrow. It sits 12px above its content, and
sections are 32 apart. A caption under a grid is 14px #5b5d63, e.g. "Last 30
days against the 30 before · rating is all-time."

**KPI tile** (Overview, a link):

- Box: radius 8, 1px #dcdee2, padding 16, **transparent** over #f7f8fa.
  Hover fills #f4f5f8 and shows `arrow-right` 16 #5b5d63 at the top right.
- Contents, top to bottom: the label (14px 500 #5b5d63), then the value
  8px lower (**30/36, 600 (draw 700), tabular**), then the context 4px
  lower (14px #5b5d63).
- The grid is 4 columns at gap 16, or 2 × 2 on a phone.
- The **delta** in the context line reads "↑ 12% vs the prior 30 days" in
  #007a3a, or "↓ 0.2 vs …" in #d00021, or "No change vs …" in #5b5d63. The
  arrow or sign is always printed. With thin data the value is omitted and
  the context is one sentence: "Fewer than 10 ratings so far, so there is no
  comparison yet."

**Metric strip** (the Ratings summary, a `<dl>`): 3 columns with
`border-top` and `border-bottom` in #dcdee2 and 1px vertical dividers
between cells. There is no outer box and no fill. Cells have padding 16 0 /
16 / 16 0. Each holds the `dt` (14px 500 #5b5d63), the value 4px lower
(30/36 600 tabular), and the context 2px lower (14px #5b5d63). The Responding
block uses a lighter form: 2 columns at gap 16, each cell `border-top` plus
padding-top 12.

**Range control** (in the `PageHeader` actions): a `role="group"` labelled
"Time range", flex, gap 4. It holds four buttons, each **44 tall, min-width
80**, 14px 500, with `aria-pressed`. The selected one is **secondary**
(#f0f2f5 fill); the others are ghost. Labels: **30 days · 90 days · 6
months · All time**, default 90 days. On phone it is one select, 44 tall. It
is shared across pages as `?range=`. The Overview has no range control.

**Chart frame** (`ChartFrame`): a `<figure>` with gap 8. The figcaption
is a computed sentence in 14/20 #5b5d63 that doubles as the description,
e.g. "4.3 → 4.5 over 90 days · 38 new reviews". The plot is **240px
tall** (standard) or **160** (compact), full width. `aspect-video` is
forbidden.

- Text: 12px, with ticks in #5b5d63.
- Axes: no axis line and no tick lines. Y axis 32 wide; a second Y axis on
  the right runs 1–5 for ratings.
- Grid: horizontal only, `stroke-dasharray 3 3`, stroke #edeef1.
- **Bars are neutral ink #5b5d63**, top radius 4. **Lines are #101115 at
  2px** (monotone). Purple is never data.
- Legend only with more than one series: centred, gap 16, padding-top 12,
  8×8 swatches at radius 2, 12px.
- At most 8 axis labels; the year goes on the first tick of each year.
- Fewer than 3 non-empty buckets means no chart, only a sentence: 14px
  #5b5d63 at padding 24 0.
- Below the chart, a `<details>` with summary "View chart values" (min-height
  44, 14px #5b5d63) holds a `<dl>` with `border-y` and dividers, rows at
  padding 8 0.
- Tooltip: bg #f7f8fa, 1px #dcdee2 at 50%, radius 8, padding 6 10, 12px,
  shadow-xl, min-width 128. Values are in JetBrains Mono 500, tabular.
- Categorical series (Google), if ever needed: #3284d0 #af76bc #008a96
  #40639c. They must stay distinguishable in greyscale.

**Distribution bars** (rating mix, a list 160 tall): each row is a grid of
`32px 1fr auto` columns with gap 8, in 14px. It reads "5★" 500 tabular,
then the track, then "31 · 62%" right aligned at min-width 80, tabular. The
track is 8 tall, fully round, #f0f2f5, and the fill is #5b5d63.

**Availability line** (by exception, only when a metric is not ready):
12px #5b5d63. It reads **"Filling in"** in 500, then " · " and the evidence,
then the reason. Never a dash, never "Data through…" when the metric is
ready. Freshness appears only where lag is real, e.g. "Updated 4 min ago".

```html
<a
  href="#"
  style="display:flex;flex-direction:column;padding:16px;border:1px solid #dcdee2;border-radius:8px;color:#101115;text-decoration:none"
>
  <span style="font-size:14px;line-height:20px;font-weight:500;color:#5b5d63"
    >Qualified scans</span
  >
  <span
    style="margin-top:8px;font-size:30px;line-height:36px;font-weight:700;font-variant-numeric:tabular-nums"
    >412</span
  >
  <span style="margin-top:4px;font-size:14px;line-height:20px;color:#5b5d63"
    ><span style="color:#007a3a">↑ 12%</span> vs the prior 30 days</span
  >
</a>
```

## 14. Empty states

- **The `EmptyState` component** (a whole list is empty): a flex column,
  centred, gap 12, padding 48 0, radius 8, a **1px dashed** #dcdee2 border
  and no fill. Inside, in order:
  - a 40px circle in #f0f2f5 holding a 16px icon in #5b5d63;
  - the title, 14px 500 #5b5d63 ("No portals yet");
  - the children, gap 8: one 14px #5b5d63 sentence and at most one button.
  - A search with no result uses the same shape: the `search` icon,
    "No portals match "spa"", and "Try a shorter search, or clear it to see
    all 5 portals."
- **Inside a populated page** (availability by exception): no box and no
  icon. One sentence in 14px #5b5d63 plus one action, e.g. "No ratings in
  this period." Never "—", never a fake 0.
- **Legacy, do not copy**: the analytics tab's `chart-column` 40px at 50%
  plus "No data yet" in a dashed box with padding 48.

## 15. Sheet and dialog

- **Overlay**: rgba(0,0,0,.5) over everything.
- **Dialog**: centred, width min(100% − 32, **512**), bg **#f7f8fa**, 1px
  #dcdee2, radius 8, **padding 24**, gap 16, shadow-lg. Its parts:
  - Header, gap 8: the title in 18px 600 (draw 700) with line-height 1,
    then the description in 14/20 #5b5d63.
  - Footer: a row, `justify-content:flex-end`, gap 8, with Cancel as an
    outline button and the action as a primary (or destructive) button.
  - Close: `x` 16 at top 16, right 16, opacity .7.
- **AlertDialog**: the same box. The sm size is 320 wide with its two
  buttons in 2 equal columns.
- **Sheet (right)**: full height, width 75% up to **384**, bg #f7f8fa,
  `border-left`, shadow-lg, a flex column with gap 16. Its parts:
  - Header: padding 16, gap 6. The title is 16px 600 (draw 500); the
    description is 14px #5b5d63.
  - Body: scrolls between the header and the footer.
  - Footer: margin-top auto, padding 16, gap 8.
  - Close: the same `x` at 16/16.
  - The portal preview sheet today is **480 wide** with padding 0. Its body
    is a grey (#f3f4f6) stage holding a 400px white card, radius 8,
    shadow-lg. **Replace it** with the device outline from the guide.
- **Phone**: the Inbox detail becomes a full-height sheet with a back arrow.
- **Popover**: 288 wide, bg #feffff, 1px #dcdee2, radius 6, padding 16,
  shadow-md. The title is 14px 500; the description is 14px #5b5d63,
  4px below.

## 16. Toasts (sonner 2.0.8)

The toasts sit **top-right**, 24px from the viewport edges, stacked 14
apart. Each one is 356 wide, padding 16, **radius 6**, 1px border,
`box-shadow:0 4px 12px rgba(0,0,0,.1)`, 13px text, a flex row with gap 6
and a 16px icon. The title is 500 at line-height 1.5; the description is
400 at line-height 1.4. The close button is a 20px circle, bordered, at the
top-left corner, pulled 35% outside the toast. **richColors is on**:

| Type    | bg      | border  | text                          | icon             |
| ------- | ------- | ------- | ----------------------------- | ---------------- |
| default | #feffff | #dcdee2 | #101115 (description #3f3f3f) | none             |
| success | #ecfdf3 | #bffcd9 | #008a2e                       | `circle-check`   |
| info    | #f0f8ff | #dde7fd | #0973dc                       | `info`           |
| warning | #fffcf0 | #fbeeb1 | #dc7609                       | `triangle-alert` |
| error   | #fff0f0 | #ffe0e1 | #e60000                       | `octagon-x`      |

The Inbox carries guarantees in the success toast ("Published. Guests see
version 4 now."), not in a standing line of copy.

## 17. Other primitives

- **Alert**: radius 8, 1px #dcdee2, padding 12 16, 14px, a grid
  `16px 1fr` with a column gap of 12. The icon is 16px. The title is 500;
  the description is 14px #5b5d63. The destructive variant keeps a white
  bg and turns its text #df202e.
- **Card** (legacy): radius 12, border, #feffff, padding 24 0, gap 24,
  shadow-sm. **Do not use it in new admin boards.** Use hairline sections.
- **Separator**: 1px #dcdee2.
- **Skeleton**: #e7e4ff, radius 6, pulsing. Give it the same size as the
  value it replaces so nothing shifts.
- **Property settings sub-nav** (the in-page left nav, the model for any
  admin section nav): a 224px column, sticky, 24px from the content. Each
  item is min-height 36, padding 8 12, radius 6, 14px, and its label is
  **#512da6** (an `<a>`). Under it sits a 12px #5b5d63 description.
  Current and hover fill #f0f2f5; current is 500. "Danger zone" has 16px
  extra above it.
  - Sections: Profile · Google · Replies · AI · People · Targets · Danger
    zone.

## 18. Portal admin today (what the redesign replaces)

- **Portals list**: `PageHeader` "Portals", with the description "Manage
  guest-facing portal pages for this property." and the primary button
  "**Add Portal**" (`plus`, 36).
  - Search: a 384px input with a `search` addon, "Search portals by name".
  - A stock table with the columns Name (a purple link) · Theme (a 20px
    swatch circle) · Status (a badge; only Published is filled purple) ·
    Actions (a ghost `eye` at 14, and archive/restore).
  - Paging: "Showing 1–5 of 5" in 14px #5b5d63, with outline sm Previous
    and Next.
  - A "Portal groups" section below.
  - **Retire**: the swatch, the filled purple badge and "Add Portal" in
    Title Case.
- **Portal detail**: `PageHeader` with the portal name and breadcrumbs.
  - A row: a ghost `arrow-left` "Back", and an outline `eye` "Preview"
    toggle at 36.
  - Segmented tabs: **Settings `settings` · Links `link-2` · Share
    `share-2` · Analytics `chart-column`**.
  - Settings is one long stack of bordered boxes with six or more save
    buttons.
- **Portal analytics** (legacy): `ChartCard` boxes (radius 8, border, bg
  #f0f2f5 at 30%, padding 16, 14px 600 title) with purple chart series and
  the forbidden label "Review clicks". **Replace** them with §13 patterns
  and the honest names: Qualified scans · Private ratings · Average private
  rating · Guests who opened Google · Private notes.

## 19. Lucide icons: inner SVG markup (lucide-react 1.41, the installed version)

Wrap each as
`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">INNER</svg>`.
The app draws most icons at 16px, dense spots at 14, meta glyphs at 12, and
always at stroke 2. `history` resolves to `rotate-ccw-clock` and `trash-2`
to `trash`.

| Icon                        | INNER                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| layout-dashboard            | `<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>`                                                                                                                                                                                                                                                                                                             |
| message-square              | `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>`                                                                                                                                                                                                                                                                                                                                                                              |
| users                       | `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>`                                                                                                                                                                                                                                                                                                                                              |
| globe                       | `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`                                                                                                                                                                                                                                                                                                                                                                                              |
| target                      | `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`                                                                                                                                                                                                                                                                                                                                                                                                               |
| sliders-horizontal          | `<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>`                                                                                                                                                                                                                                                                                                                           |
| settings                    | `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>`                                                                                                                           |
| chevrons-up-down            | `<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| chevron-right               | `<path d="m9 18 6-6-6-6"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| chevron-down                | `<path d="m6 9 6 6 6-6"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| chevron-left                | `<path d="m15 18-6-6 6-6"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| building-2                  | `<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>`                                                                                                                                                                                                                                                                                        |
| plus                        | `<path d="M5 12h14"/><path d="M12 5v14"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| panel-left                  | `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| message-square-plus         | `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 8v6"/><path d="M9 11h6"/>`                                                                                                                                                                                                                                                                                                                                        |
| bell                        | `<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>`                                                                                                                                                                                                                                                                                                                            |
| search                      | `<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| list-filter                 | `<path d="M2 5h20"/><path d="M6 12h12"/><path d="M9 19h6"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| arrow-down-up               | `<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| arrow-up-down               | `<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| arrow-up                    | `<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| arrow-down                  | `<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ellipsis                    | `<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| star                        | `<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>`                                                                                                                     |
| check                       | `<path d="M20 6 9 17l-5-5"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| x                           | `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| arrow-left                  | `<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| arrow-right                 | `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| clock-3                     | `<circle cx="12" cy="12" r="10"/><path d="M12 6v6h4"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| flag                        | `<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>`                                                                                                                                                                                                                                                                                                                                               |
| eye                         | `<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>`                                                                                                                                                                                                                                                                                                                                                             |
| link-2                      | `<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>`                                                                                                                                                                                                                                                                                                                                                                                               |
| link-2-off                  | `<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/>`                                                                                                                                                                                                                                                                                                                                                                |
| share-2                     | `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>`                                                                                                                                                                                                                                                                                                               |
| chart-column                | `<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>`                                                                                                                                                                                                                                                                                                                                                                                                             |
| qr-code                     | `<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>`                                                                                                                                 |
| copy                        | `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`                                                                                                                                                                                                                                                                                                                                                                                  |
| inbox                       | `<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`                                                                                                                                                                                                                                                                                                                                 |
| shield-check                | `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`                                                                                                                                                                                                                                                                                                      |
| send                        | `<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>`                                                                                                                                                                                                                                                                                                                            |
| message-square-text         | `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/>`                                                                                                                                                                                                                                                                                                                     |
| circle-user-round           | `<path d="M17.925 20.056a6 6 0 0 0-11.851.001"/><circle cx="12" cy="11" r="4"/><circle cx="12" cy="12" r="10"/>`                                                                                                                                                                                                                                                                                                                                                                                               |
| layers                      | `<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>`                                                                                                                                                                                                           |
| archive                     | `<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>`                                                                                                                                                                                                                                                                                                                                                                                     |
| triangle-alert              | `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`                                                                                                                                                                                                                                                                                                                                                                                |
| circle-check                | `<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| circle-alert                | `<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>`                                                                                                                                                                                                                                                                                                                                                                                             |
| info                        | `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| octagon-x                   | `<path d="m15 9-6 6"/><path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/><path d="m9 9 6 6"/>`                                                                                                                                                                                                              |
| history (=rotate-ccw-clock) | `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>`                                                                                                                                                                                                                                                                                                                                                                                                     |
| rotate-ccw                  | `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| lock                        | `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`                                                                                                                                                                                                                                                                                                                                                                                                                |
| external-link               | `<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`                                                                                                                                                                                                                                                                                                                                                                                             |
| printer                     | `<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>`                                                                                                                                                                                                                                                                                                                   |
| nfc                         | `<path d="M6 8.32a7.43 7.43 0 0 1 0 7.36"/><path d="M9.46 6.21a11.76 11.76 0 0 1 0 11.58"/><path d="M12.91 4.1a15.91 15.91 0 0 1 .01 15.8"/><path d="M16.37 2a20.16 20.16 0 0 1 0 20"/>`                                                                                                                                                                                                                                                                                                                       |
| smartphone                  | `<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| circle-plus                 | `<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| user-plus                   | `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>`                                                                                                                                                                                                                                                                                                                                              |
| user-minus                  | `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" x2="16" y1="11" y2="11"/>`                                                                                                                                                                                                                                                                                                                                                                                    |
| user-round                  | `<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| user-round-check            | `<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="m16 19 2 2 4-4"/>`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| download                    | `<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>`                                                                                                                                                                                                                                                                                                                                                                                                           |
| pencil                      | `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>`                                                                                                                                                                                                                                                                                                                                            |
| trash-2 (=trash)            | `<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`                                                                                                                                                                                                                                                                                                                                            |
| grip-vertical               | `<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>`                                                                                                                                                                                                                                                                                                                        |
| activity                    | `<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>`                                                                                                                                                                                                                                                                                                                                                                       |
| log-out                     | `<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>`                                                                                                                                                                                                                                                                                                                                                                                                            |
| sun                         | `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`                                                                                                                                                                                                                                                            |
| moon                        | `<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>`                                                                                                                                                                                                                                                                                                                                                                                   |
| monitor                     | `<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>`                                                                                                                                                                                                                                                                                                                                                                               |
| user                        | `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| shield                      | `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>`                                                                                                                                                                                                                                                                                                                               |
| palette                     | `<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>`                                                                                                                                                      |
| plug                        | `<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>`                                                                                                                                                                                                                                                                                                                                                                  |
| brain-circuit               | `<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/>` |
| map-pin                     | `<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>`                                                                                                                                                                                                                                                                                                                                                              |
| languages                   | `<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>`                                                                                                                                                                                                                                                                                                                                                                           |
| calendar                    | `<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>`                                                                                                                                                                                                                                                                                                                                                                                                    |
| refresh-cw                  | `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`                                                                                                                                                                                                                                                                                                                                     |
| clipboard-check             | `<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>`                                                                                                                                                                                                                                                                                                                                          |
| scan-line                   | `<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>`                                                                                                                                                                                                                                                                                                                                           |
| image-off                   | `<line x1="2" x2="22" y1="2" y2="22"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><line x1="13.5" x2="6" y1="13.5" y2="21"/><line x1="18" x2="21" y1="12" y2="15"/><path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59"/><path d="M21 15V5a2 2 0 0 0-2-2H9"/>`                                                                                                                                                                                                                |
| loader-circle               | `<path d="M21 12a9 9 0 1 1-6.219-8.56"/>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| folder                      | `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`                                                                                                                                                                                                                                                                                                                                                                           |
