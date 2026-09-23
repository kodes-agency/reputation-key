# Admin components: copy these verbatim

The reference board is `canvas/project/ADM01-portals-overview.dc.html`. Every
snippet below is taken from it or built to the same rules. Copy the markup and
the inline styles exactly, then change only the copy, the fixture data and the
one thing each snippet says you may change. The numbers are the real app's
(see `app-shell-spec.md`). Where this file and a board spec disagree on a
pixel, follow the board spec. Where they disagree on a rule (contrast, purple
use, one primary), follow this file and say so in your final line.

Contents: 0 Helmet and skeleton · 1 Sidebar and rail · 2 Top bar · 3 Page
header · 4 Tabs · 5 Buttons · 6 Form controls · 7 Data table · 8 Facts,
details, status and health · 9 Strips and KPI tiles · 10 Timeline / ledger ·
11 Charts · 12 Empty states · 13 Menu and popover · 14 Dialog and sheet ·
15 Toast · 16 Guest preview (device, selection, GUEST-A, GUEST-B).

Icons are lucide at stroke 2, drawn as
`<svg width="N" height="N" viewBox="0 0 24 24" fill="none" stroke="…" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none">…</svg>`.
Every icon in this file is already expanded. For other icons, take the inner
markup from `app-shell-spec.md` §19. These extra icons are verified against
lucide-react in the repo:

| icon           | inner markup                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| waves          | `<path d="M2 12q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 19q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 5q2.5 2 5 0t5 0 5 0 5 0"/>`                                                                                                                                                                     |
| utensils       | `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>`                                                                                                                                                         |
| book-open      | `<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>`                                                                                                              |
| bed-double     | `<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>`                                                                                                                                         |
| concierge-bell | `<path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z"/><path d="M20 16a8 8 0 1 0-16 0"/><path d="M12 4v4"/><path d="M10 4h4"/>`                                                                                                                                |
| arrow-up-right | `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`                                                                                                                                                                                                                                             |
| eye-off        | `<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>` |
| circle-pause   | `<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>`                                                                                                                                                                             |

Measured type (Satoshi, from the woff2 files): at 12px 500 "Qualified" is
48px, "Average private rating" 120px, "Guests who opened Google" 151px; at
12px 400 "Restaurant or bar table · QR and NFC · EN, БГ" is about 245px; at
14px 500 "Olive Terrace restaurant" is 152px. Satoshi has no Cyrillic, so
"БГ" in admin text falls back to system-ui (as in the app). Measure before
you squeeze a column: text that wraps silently makes a row taller and pushes
content past the board edge.

---

## 0. Helmet and skeleton

Use the guide's skeleton. Replace its `<style>` with this one on every admin
board (it adds the hover and focus classes the snippets use; do not add
others unless a board truly needs one):

```html
<style>
  @font-face {
    font-family: 'Satoshi';
    src: url('/_blob/bc9aed933eebd2242e24e1a874f3e980') format('woff2');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Satoshi';
    src: url('/_blob/b4176652b3bb793da8608143a4c2d4d1') format('woff2');
    font-weight: 500;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Satoshi';
    src: url('/_blob/d97bb02bcf4b472111e2170c4170bd0c') format('woff2');
    font-weight: 700;
    font-style: normal;
    font-display: swap;
  }
  body {
    margin: 0;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  a {
    color: #512da6;
  }
  a:hover {
    color: #431096;
  }
  :focus-visible {
    outline: 2px solid #7b65d1;
    outline-offset: 2px;
  }
  button,
  input,
  select,
  textarea {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
  }
  .rk-primary {
    background: #512da6;
  }
  .rk-primary:hover {
    background: #6242ae;
  }
  .rk-outline {
    background: #f7f8fa;
  }
  .rk-outline:hover {
    background: #e7e4ff;
  }
  .rk-ghost {
    background: transparent;
  }
  .rk-ghost:hover {
    background: #e7e4ff;
  }
  .rk-destructive {
    background: #df202e;
  }
  .rk-destructive:hover {
    background: #e23743;
  }
  .rk-nav:hover {
    background: #e7e4ff;
  }
  .rk-row:hover > td,
  .rk-row:hover > th {
    background: #f9fafb;
  }
  .rk-sort:hover {
    color: #101115 !important;
  }
  .rk-name:hover {
    text-decoration: underline !important;
    text-underline-offset: 4px;
  }
  .rk-detail:hover > span {
    text-decoration-style: solid !important;
  }
  .rk-cell {
    background: #feffff;
  }
  .rk-cell-i:hover,
  .rk-cell-i.is-on {
    background: #f0f2f5;
  }
  .rk-stretch::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .rk-stretch:focus-visible {
    outline: none;
  }
  .rk-stretch:focus-visible::after {
    outline: 2px solid #7b65d1;
    outline-offset: -3px;
  }
  .rk-input::placeholder {
    color: #5b5d63;
    opacity: 1;
  }
  .rk-input:focus-visible {
    outline: none;
    border-color: #7b65d1 !important;
    box-shadow: 0 0 0 3px rgba(123, 101, 209, 0.5) !important;
  }
  .rk-menuitem {
    background: transparent;
  }
  .rk-menuitem:hover,
  .rk-menuitem:focus-visible {
    background: #e7e4ff;
    outline: none;
  }
  .rk-check:focus-visible + span {
    outline: 2px solid #7b65d1;
    outline-offset: 2px;
  }
  .rk-tile {
    background: transparent;
  }
  .rk-tile:hover {
    background: #f4f5f8;
  }
</style>
```

Rules the classes rely on:

- A hoverable element never carries an inline `background`. Its resting fill
  comes from its class (`rk-primary`, `rk-outline`, `rk-ghost`,
  `rk-destructive`, `rk-cell`, `rk-tile`). A selected nav row is the one exception: it
  has no class and an inline `background:#e7e4ff`.
- Buttons inherit Satoshi through the reset line. Always set `font-size`,
  `line-height`, `font-weight` and `color` inline anyway.
- Default `<th>` is bold and centred. Always set `font-weight` and
  `text-align` inline.

Desktop root (mode A standard page and mode B workspace both start here):

```html
<div
  style="width: 1440px; height: 1024px; box-sizing: border-box; overflow: hidden; position: relative; display: flex; background: #f7f8fa; color: #101115; font-family: 'Satoshi', system-ui, sans-serif; font-size: 14px; line-height: 20px;"
>
  …SIDEBAR (or RAIL)…
  <div
    style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: #f7f8fa;"
  >
    …TOPBAR…
    <main
      style="flex: 1; min-height: 0; overflow: hidden; padding: 32px 24px; box-sizing: border-box;"
    >
      <div style="width: 1136px; margin: 0 auto; display: flex; flex-direction: column;">
        …blocks…
      </div>
    </main>
  </div>
</div>
```

Content widths: dashboard tier `width: 1136px` (x280–1416), standard tier
`width: 1024px` (x336–1360), narrow tier `width: 768px` (x464–1232). Space
blocks with `margin-top` on each block (the ADM01 rhythm: header, 32, the
property-wide line, 24, strip, 24, toolbar, 16, table, 12, basis line).
A taller board changes only `height` on the root, `height` on the sidebar
`<nav>` and the `$preview`.

Headings: one `<h1>` per board. Sections get `<h2>`; unlabelled regions such
as the strip and the table get an sr-only `<h2>` (`<h2 class="sr-only">Summary</h2>`).

---

## 1. Sidebar and rail

### SIDEBAR (expanded, property scope, 256 wide)

Identical on every mode A board. To move the selection, give the chosen row
`aria-current="page"`, remove its `class="rk-nav"` and add
`background: #e7e4ff; font-weight: 500;` to its style; restore the class and
remove those on the row that was selected. The Reviews count is fixture data.

```html
<nav
  aria-label="Primary navigation"
  style="width: 256px; flex: none; height: 1024px; box-sizing: border-box; display: flex; flex-direction: column; background: #f7f8fa; border-right: 1px solid #dcdee2;"
>
  <div style="padding: 8px;">
    <button
      type="button"
      class="rk-ghost"
      aria-label="Avela Resort, switch property"
      aria-haspopup="menu"
      aria-expanded="false"
      style="display: flex; align-items: center; gap: 8px; width: 100%; height: 48px; padding: 8px; box-sizing: border-box; border: 0; border-radius: 6px; text-align: left; color: #101115; cursor: pointer;"
    >
      <span
        aria-hidden="true"
        style="width: 32px; height: 32px; flex: none; border-radius: 8px; background: #e7e4ff; color: #512da6; display: flex; align-items: center; justify-content: center; font-size: 12px; line-height: 16px; font-weight: 500;"
        >AR</span
      >
      <span
        style="display: grid; flex: 1; min-width: 0; font-size: 14px; line-height: 1.25;"
        ><span style="font-weight: 500;">Avela Resort</span
        ><span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
          >avela-resort</span
        ></span
      >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#512da6"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <path d="m7 15 5 5 5-5" />
        <path d="m7 9 5-5 5 5" />
      </svg>
    </button>
  </div>
  <div style="flex: 1; min-height: 0; padding: 8px;">
    <ul
      style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px;"
    >
      <li style="position: relative;">
        <a
          href="#"
          class="rk-nav"
          style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px 32px 8px 8px; box-sizing: border-box; border-radius: 6px; color: #101115; text-decoration: none; font-size: 14px; line-height: 20px;"
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
            style="flex:none"
          >
            <rect width="7" height="9" x="3" y="3" rx="1" />
            <rect width="7" height="5" x="14" y="3" rx="1" />
            <rect width="7" height="9" x="14" y="12" rx="1" />
            <rect width="7" height="5" x="3" y="16" rx="1" /></svg
          ><span>Dashboard</span></a
        >
        <button
          type="button"
          class="rk-ghost"
          aria-label="Show Dashboard pages"
          aria-expanded="false"
          style="position: absolute; top: 6px; right: 4px; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #101115; cursor: pointer;"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            style="flex:none"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </li>
      <li style="position: relative;">
        <a
          href="#"
          class="rk-nav"
          style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px 32px 8px 8px; box-sizing: border-box; border-radius: 6px; color: #101115; text-decoration: none; font-size: 14px; line-height: 20px;"
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
            style="flex:none"
          >
            <path
              d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
            /></svg
          ><span>Reviews</span><span class="sr-only">, 3 new</span></a
        >
        <span
          aria-hidden="true"
          style="position: absolute; top: 6px; right: 4px; height: 20px; min-width: 20px; box-sizing: border-box; padding: 0 6px; border-radius: 9999px; background: #df202e; color: #fff; font-size: 12px; line-height: 16px; font-weight: 500; font-variant-numeric: tabular-nums; display: flex; align-items: center; justify-content: center; pointer-events: none;"
          >3</span
        >
      </li>
      <li>
        <a
          href="#"
          class="rk-nav"
          style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px; box-sizing: border-box; border-radius: 6px; color: #101115; text-decoration: none; font-size: 14px; line-height: 20px;"
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
            style="flex:none"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <path d="M16 3.128a4 4 0 0 1 0 7.744" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <circle cx="9" cy="7" r="4" /></svg
          ><span>People</span></a
        >
      </li>
      <li>
        <a
          href="#"
          aria-current="page"
          style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px; box-sizing: border-box; border-radius: 6px; background: #e7e4ff; color: #101115; text-decoration: none; font-size: 14px; line-height: 20px; font-weight: 500;"
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
            style="flex:none"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" /></svg
          ><span>Portals</span></a
        >
      </li>
      <li>
        <a
          href="#"
          class="rk-nav"
          style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px; box-sizing: border-box; border-radius: 6px; color: #101115; text-decoration: none; font-size: 14px; line-height: 20px;"
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
            style="flex:none"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" /></svg
          ><span>Goals</span></a
        >
      </li>
      <li>
        <a
          href="#"
          class="rk-nav"
          style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px; box-sizing: border-box; border-radius: 6px; color: #101115; text-decoration: none; font-size: 14px; line-height: 20px;"
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
            style="flex:none"
          >
            <path d="M10 5H3" />
            <path d="M12 19H3" />
            <path d="M14 3v4" />
            <path d="M16 17v4" />
            <path d="M21 12h-9" />
            <path d="M21 19h-5" />
            <path d="M21 5h-7" />
            <path d="M8 10v4" />
            <path d="M8 12H3" /></svg
          ><span>Property settings</span></a
        >
      </li>
    </ul>
  </div>
  <div style="padding: 8px;">
    <ul style="list-style: none; margin: 0; padding: 0;">
      <li>
        <a
          href="#"
          class="rk-nav"
          style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px; box-sizing: border-box; border-radius: 6px; color: #101115; text-decoration: none; font-size: 14px; line-height: 20px;"
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
            style="flex:none"
          >
            <path
              d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
            />
            <circle cx="12" cy="12" r="3" /></svg
          ><span>Settings</span></a
        >
      </li>
    </ul>
  </div>
</nav>
```

Geometry: switcher y8–56; rows at y64, 100, 136, 172 (Portals), 208, 244;
Settings at y984–1016 on a 1024 board.

**Org scope** (ADM02). Replace the switcher's first two spans with:

```html
<span
  aria-hidden="true"
  style="width: 32px; height: 32px; flex: none; border-radius: 8px; background: #e7e4f2; color: #512da6; display: flex; align-items: center; justify-content: center;"
  ><svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="M10 12h4" />
    <path d="M10 8h4" />
    <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
    <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
    <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /></svg
></span>
<span style="display: grid; flex: 1; min-width: 0; font-size: 14px; line-height: 1.25;"
  ><span style="font-weight: 500;">Select property</span
  ><span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
    >No property selected</span
  ></span
>
```

and give the button `aria-label="Select property"`. Dashboard, People, Goals
and Property settings become inert spans (never disabled buttons):

```html
<span
  aria-disabled="true"
  style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 8px; box-sizing: border-box; border-radius: 6px; color: #101115; font-size: 14px; line-height: 20px; opacity: .5;"
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
    style="flex:none"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <path d="M16 3.128a4 4 0 0 1 0 7.744" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <circle cx="9" cy="7" r="4" /></svg
  ><span>People</span></span
>
```

The Dashboard inert span keeps `padding: 8px 32px 8px 8px` and drops its
chevron button. Reviews links to the Inbox with the org count.

### RAIL (mode B workspace, 48 + 1 wide)

The sidebar collapsed to icons, as the Inbox. No labels, badges or tooltips
drawn. Move `aria-current`, the class and the fill exactly as above.

```html
<nav
  aria-label="Primary navigation"
  style="width: 49px; flex: none; height: 1024px; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; background: #f7f8fa; border-right: 1px solid #dcdee2;"
>
  <button
    type="button"
    class="rk-ghost"
    aria-label="Avela Resort, switch property"
    aria-haspopup="menu"
    aria-expanded="false"
    style="width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer;"
  >
    <span
      aria-hidden="true"
      style="width: 32px; height: 32px; border-radius: 8px; background: #e7e4ff; color: #512da6; display: flex; align-items: center; justify-content: center; font-size: 12px; line-height: 16px; font-weight: 500;"
      >AR</span
    >
  </button>
  <ul
    style="list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px;"
  >
    <li>
      <a
        href="#"
        class="rk-nav"
        aria-label="Dashboard"
        style="width: 32px; height: 32px; box-sizing: border-box; border-radius: 6px; display: flex; align-items: center; justify-content: center;"
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
          style="flex:none"
        >
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" /></svg
      ></a>
    </li>
    <li>
      <a
        href="#"
        class="rk-nav"
        aria-label="Reviews, 3 new"
        style="width: 32px; height: 32px; box-sizing: border-box; border-radius: 6px; display: flex; align-items: center; justify-content: center;"
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
          style="flex:none"
        >
          <path
            d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
          /></svg
      ></a>
    </li>
    <li>
      <a
        href="#"
        class="rk-nav"
        aria-label="People"
        style="width: 32px; height: 32px; box-sizing: border-box; border-radius: 6px; display: flex; align-items: center; justify-content: center;"
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
          style="flex:none"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <path d="M16 3.128a4 4 0 0 1 0 7.744" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <circle cx="9" cy="7" r="4" /></svg
      ></a>
    </li>
    <li>
      <a
        href="#"
        aria-current="page"
        aria-label="Portals"
        style="width: 32px; height: 32px; box-sizing: border-box; border-radius: 6px; background: #e7e4ff; display: flex; align-items: center; justify-content: center;"
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
          style="flex:none"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" /></svg
      ></a>
    </li>
    <li>
      <a
        href="#"
        class="rk-nav"
        aria-label="Goals"
        style="width: 32px; height: 32px; box-sizing: border-box; border-radius: 6px; display: flex; align-items: center; justify-content: center;"
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
          style="flex:none"
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" /></svg
      ></a>
    </li>
    <li>
      <a
        href="#"
        class="rk-nav"
        aria-label="Property settings"
        style="width: 32px; height: 32px; box-sizing: border-box; border-radius: 6px; display: flex; align-items: center; justify-content: center;"
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
          style="flex:none"
        >
          <path d="M10 5H3" />
          <path d="M12 19H3" />
          <path d="M14 3v4" />
          <path d="M16 17v4" />
          <path d="M21 12h-9" />
          <path d="M21 19h-5" />
          <path d="M21 5h-7" />
          <path d="M8 10v4" />
          <path d="M8 12H3" /></svg
      ></a>
    </li>
  </ul>
  <a
    href="#"
    class="rk-nav"
    aria-label="Settings"
    style="margin-top: auto; width: 32px; height: 32px; box-sizing: border-box; border-radius: 6px; display: flex; align-items: center; justify-content: center;"
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
      style="flex:none"
    >
      <path
        d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
      />
      <circle cx="12" cy="12" r="3" /></svg
  ></a>
</nav>
```

Geometry: tile y8–40, first icon at y56, Settings at y984. The column to its
right starts at x49.

---

## 2. Top bar

### TOPBAR (mode A)

```html
<header
  style="height: 52px; flex: none; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid #dcdee2; background: #f7f8fa;"
>
  <button
    type="button"
    class="rk-ghost"
    aria-label="Toggle sidebar"
    style="width: 28px; height: 28px; margin-left: -4px; padding: 0; border: 0; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #101115; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  </button>
  <span style="flex: 1;"></span>
  <button
    type="button"
    class="rk-ghost"
    style="height: 32px; padding: 0 10px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path
        d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
      />
      <path d="M12 8v6" />
      <path d="M9 11h6" /></svg
    >Feedback
  </button>
  <button
    type="button"
    class="rk-ghost"
    aria-label="Notifications, 2 unread"
    style="position: relative; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #101115; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path
        d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
      /></svg
    ><span
      aria-hidden="true"
      style="position: absolute; top: -2px; right: -2px; width: 16px; height: 16px; border-radius: 9999px; background: #512da6; color: #feffff; font-size: 9px; line-height: 16px; font-weight: 700; text-align: center;"
      >2</span
    >
  </button>
  <button
    type="button"
    class="rk-ghost"
    aria-label="Account menu, Elena Petrova"
    aria-haspopup="menu"
    aria-expanded="false"
    style="width: 32px; height: 32px; padding: 0; border: 0; border-radius: 9999px; display: flex; align-items: center; justify-content: center; cursor: pointer;"
  >
    <span
      aria-hidden="true"
      style="width: 28px; height: 28px; border-radius: 9999px; background: #512da6; color: #feffff; font-size: 10px; line-height: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center;"
      >EP</span
    >
  </button>
</header>
```

### TOPBAR-B (mode B)

The same header without the first button (x49–1440). For Georgi Ivanov, change the account button's label to "Account menu, Georgi
Ivanov" and the initials to `GI`.

---

## 3. Page header

```html
<header style="display: flex; flex-direction: column; gap: 12px;">
  <nav aria-label="Breadcrumb">
    <ol
      style="display: flex; align-items: center; gap: 10px; margin: 0; padding: 0; list-style: none; font-size: 14px; line-height: 20px; color: #5b5d63;"
    >
      <li><a href="#" style="text-decoration: none;">Properties</a></li>
      <li aria-hidden="true" style="display: flex;">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          style="flex:none"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </li>
      <li><a href="#" style="text-decoration: none;">Avela Resort</a></li>
      <li aria-hidden="true" style="display: flex;">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          style="flex:none"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </li>
      <li aria-current="page" style="color: #101115;">Portals</li>
    </ol>
  </nav>
  <div
    style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;"
  >
    <div style="min-width: 0;">
      <h1
        style="margin: 0; font-size: 24px; line-height: 32px; font-weight: 700; letter-spacing: -0.6px; color: #101115;"
      >
        Portals
      </h1>
      <p style="margin: 4px 0 0; font-size: 14px; line-height: 20px; color: #5b5d63;">
        Pages guests reach from codes around Avela Resort · Look: Carved Stillness
      </p>
    </div>
    <div style="display: flex; gap: 8px; flex: none;">
      …outline 36 buttons, then at most one primary 36…
    </div>
  </div>
</header>
```

With breadcrumb and description it is 88 tall (y84–172). Without a
breadcrumb, drop the `<nav>` (56 tall). Without a description, drop the `<p>`.

**Property-wide line** (by exception, no box, 32 below the header):

```html
<p
  style="margin: 32px 0 0; display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; color: #101115;"
>
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5b5d63"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path
      d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
    />
    <path d="m15 5 4 4" /></svg
  ><span
    >Elena Petrova changed the property look on 17 Sep. It isn’t live on 4 portals
    yet.</span
  ><a href="#" style="font-weight: 500; text-decoration: none;"
    >Review &amp; publish 4 portals</a
  >
</p>
```

**Step list** (creation mode, replaces tabs until the first publish):

```html
<ol
  aria-label="New portal steps"
  style="display: flex; align-items: center; gap: 24px; margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 20px; color: #5b5d63;"
>
  <li style="display: flex; align-items: center; gap: 6px;">
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="M20 6 9 17l-5-5" /></svg
    ><span>1 Place</span>
  </li>
  <li aria-current="step" style="font-weight: 500; color: #101115;">2 Experience</li>
  <li>3 Review</li>
  <li>4 Publish and share</li>
</ol>
```

In ROW2 the current step also gets the line-tab bar (§4).

---

## 4. Tabs

### Line tabs (workspace ROW2, 48 tall, the bar sits on ROW2's hairline)

```html
<div
  role="tablist"
  aria-label="Portal"
  style="display: flex; align-items: stretch; gap: 24px; height: 48px;"
>
  <button
    type="button"
    role="tab"
    aria-selected="true"
    style="position: relative; height: 48px; padding: 0; border: 0; background: none; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    Experience<span
      aria-hidden="true"
      style="position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: #101115;"
    ></span>
  </button>
  <button
    type="button"
    role="tab"
    aria-selected="false"
    class="rk-sort"
    style="height: 48px; padding: 0; border: 0; background: none; font-size: 14px; line-height: 20px; font-weight: 500; color: #6a6b6f; cursor: pointer;"
  >
    Share
  </button>
  <button
    type="button"
    role="tab"
    aria-selected="false"
    class="rk-sort"
    style="height: 48px; padding: 0; border: 0; background: none; font-size: 14px; line-height: 20px; font-weight: 500; color: #6a6b6f; cursor: pointer;"
  >
    Analytics
  </button>
  <button
    type="button"
    role="tab"
    aria-selected="false"
    class="rk-sort"
    style="height: 48px; padding: 0; border: 0; background: none; font-size: 14px; line-height: 20px; font-weight: 500; color: #6a6b6f; cursor: pointer;"
  >
    Activity
  </button>
</div>
```

An issue count after a tab: `<span style="margin-left: 4px; font-size: 12px; line-height: 16px; font-weight: 500; color: #a45f00;">· 2 issues</span>` inside the tab button.

### Segmented tabs (default, 36 tall)

```html
<div
  role="tablist"
  aria-label="View"
  style="display: inline-flex; align-items: center; height: 36px; box-sizing: border-box; padding: 3px; border-radius: 8px; background: #f0f2f5;"
>
  <button
    type="button"
    role="tab"
    aria-selected="true"
    style="height: 29px; box-sizing: border-box; padding: 4px 12px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 6px; background: #f7f8fa; box-shadow: 0 1px 3px 0 rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1); font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    Workspace
  </button>
  <button
    type="button"
    role="tab"
    aria-selected="false"
    style="height: 29px; box-sizing: border-box; padding: 4px 12px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-size: 14px; line-height: 20px; font-weight: 500; color: #6a6b6f; cursor: pointer;"
  >
    Removed
  </button>
</div>
```

### COMPACT TABS (Draft | Live v5, EN | БГ, Arrival | After rating)

```html
<div
  role="tablist"
  aria-label="Language"
  style="display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; background: #f0f2f5;"
>
  <button
    type="button"
    role="tab"
    aria-selected="true"
    style="height: 26px; padding: 0 10px; border: 0; border-radius: 4px; background: #f7f8fa; font-size: 13px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    EN
  </button>
  <button
    type="button"
    role="tab"
    aria-selected="false"
    lang="bg"
    style="height: 26px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; font-size: 13px; line-height: 20px; color: #5b5d63; cursor: pointer;"
  >
    БГ
  </button>
</div>
```

State-driven tabs: keep the selection in `state`, bind `aria-selected` and a
precomputed style piece (`background: {{ t.bg }}; color: {{ t.ink }}`), and
`onClick="{{ t.pick }}"` from `renderVals()`.

---

## 5. Buttons

One filled purple button per area. Its label is the next step. Guarantees
live in toasts and tooltips, not beside buttons.

```html
<!-- primary 36 (page header) -->
<button
  type="button"
  class="rk-primary"
  style="height: 36px; box-sizing: border-box; padding: 0 12px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #feffff; cursor: pointer;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" /></svg
  >New portal
</button>
<!-- primary sm 32 (docks, health rows, dialogs in workspaces) -->
<button
  type="button"
  class="rk-primary"
  style="height: 32px; box-sizing: border-box; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #feffff; cursor: pointer;"
>
  Review &amp; publish
</button>
<!-- outline 36 -->
<button
  type="button"
  class="rk-outline"
  style="height: 36px; box-sizing: border-box; padding: 0 12px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path
      d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"
    />
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg
  >Property look
</button>
<!-- outline sm 32 (the standard control) -->
<button
  type="button"
  class="rk-outline"
  style="height: 32px; box-sizing: border-box; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
    <path d="M12 18h.01" /></svg
  >Try as guest
</button>
<!-- outline sm menu trigger: ends with chevron-down 14 -->
<button
  type="button"
  class="rk-outline"
  aria-haspopup="menu"
  aria-expanded="false"
  style="height: 32px; box-sizing: border-box; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="M2 5h20" />
    <path d="M6 12h12" />
    <path d="M9 19h6" /></svg
  ><span>Show: All</span
  ><svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5b5d63"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
</button>
<!-- ghost sm 32 -->
<button
  type="button"
  class="rk-ghost"
  style="height: 32px; box-sizing: border-box; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
>
  Clear
</button>
<!-- ghost icon 32 (row and header actions) -->
<button
  type="button"
  class="rk-ghost"
  aria-label="Actions for Reception"
  aria-haspopup="menu"
  aria-expanded="false"
  style="width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; color: #5b5d63; cursor: pointer;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </svg>
</button>
<!-- destructive 36 (confirm dialogs only) and sm 32 -->
<button
  type="button"
  class="rk-destructive"
  style="height: 36px; box-sizing: border-box; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #ffffff; cursor: pointer;"
>
  Archive portal
</button>
<button
  type="button"
  class="rk-destructive"
  style="height: 32px; box-sizing: border-box; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #ffffff; cursor: pointer;"
>
  Remove
</button>
<!-- xs 24 (in-row: Copy, Show, View, Use property wording) -->
<button
  type="button"
  class="rk-outline"
  style="height: 24px; box-sizing: border-box; padding: 0 6px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 12px; line-height: 16px; font-weight: 500; color: #101115; cursor: pointer;"
>
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg
  >Copy
</button>
<button
  type="button"
  class="rk-ghost"
  style="height: 24px; box-sizing: border-box; padding: 0 6px; display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 6px; font-size: 12px; line-height: 16px; font-weight: 500; color: #101115; cursor: pointer;"
>
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" /></svg
  >Use property wording
</button>
<!-- back link in a workspace header: ghost sm as an <a> -->
<a
  href="ADM01-portals-overview.dc.html"
  class="rk-ghost"
  style="height: 32px; box-sizing: border-box; padding: 0 10px 0 8px; display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; text-decoration: none;"
  ><svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" /></svg
  >Portals</a
>
```

Navigation is an `<a>` styled as the button (a `<button>` inside an `<a>`
swallows the click in Play). ADM01's "New portal" is the reference:
`<a href="ADM03-new-portal-place.dc.html" class="rk-primary" style="height: 36px; box-sizing: border-box; padding: 0 12px; display: inline-flex; align-items: center; gap: 8px; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #feffff; text-decoration: none;">…</a>`.

Never draw a disabled button for a permission. Draw the fact instead (§8).
Disabled for a real momentary reason is `opacity: .5; cursor: default` plus a
reason in the helper text.

---

## 6. Form controls

Field stack: label, 12, control, 12, helper. Fields are 28 apart.

Field outline token: text inputs, textareas, search inputs, form select
triggers (the field-stack select), native selects and unchecked radios
(plain and in choice cards) use a 1px `#85878d` edge (3.4:1 on #f7f8fa,
3.6:1 on #feffff, for 3:1 non-text contrast). `#dcdee2` stays for
hairlines, card and choice-card edges, outline buttons and toolbar pickers
drawn as outline sm menu buttons. The boards' form fields already draw
#85878d; the snippets below use it.

```html
<div style="display: flex; flex-direction: column; gap: 12px;">
  <label
    for="welcome-line"
    style="font-size: 14px; line-height: 14px; font-weight: 500; color: #101115;"
    >Welcome line</label
  >
  <input
    id="welcome-line"
    type="text"
    class="rk-input"
    value="Pool bar"
    aria-describedby="welcome-line-help"
    style="height: 36px; box-sizing: border-box; padding: 4px 12px; border: 1px solid #85878d; border-radius: 6px; background: transparent; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; color: #101115;"
  />
  <p
    id="welcome-line-help"
    style="margin: 0; font-size: 14px; line-height: 20px; color: #5b5d63;"
  >
    Guests see this at the top of the page. Name the place, never a person.
  </p>
</div>
```

- An optional marker after a label: `<span style="margin-left: 6px; font-size: 12px; line-height: 16px; font-weight: 400; color: #5b5d63;">optional</span>`.
- Dense rows use 12/16 helpers.
- Error: the input gets `border-color: #df202e; box-shadow: 0 0 0 3px rgba(223,32,46,.2);` and `aria-invalid="true"`; the message is `<p id="…-error" role="alert" style="margin: 0; font-size: 14px; line-height: 20px; color: #df202e;">Add a welcome line.</p>`.
- Textarea: the input's style plus `min-height: 64px; padding: 8px 12px; resize: vertical;`.
- Inherited field ("Using property wording"): no input, the inherited text
  as a fact, and one xs action.

```html
<div style="display: flex; flex-direction: column; gap: 8px;">
  <span style="font-size: 14px; line-height: 14px; font-weight: 500; color: #101115;"
    >Short description</span
  >
  <span style="font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63;"
    >Using property wording</span
  >
  <p style="margin: 0; font-size: 14px; line-height: 20px; color: #5b5d63;">
    Stone, olive shade and water that keeps the last of the light. Thank you for spending
    part of your day with us.
  </p>
  <button
    type="button"
    class="rk-outline"
    style="align-self: flex-start; height: 24px; box-sizing: border-box; padding: 0 6px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 12px; line-height: 16px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path
        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
      />
      <path d="m15 5 4 4" /></svg
    >Write for this portal
  </button>
</div>
```

**Search input** (288 × 36, the icon is decorative, the label sr-only):

```html
<div style="position: relative; width: 288px; flex: none;">
  <label for="portal-search" class="sr-only">Search portals</label>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5b5d63"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none;position:absolute;left:12px;top:10px;pointer-events:none"
  >
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </svg>
  <input
    id="portal-search"
    type="search"
    class="rk-input"
    placeholder="Search portals"
    style="width: 288px; height: 36px; box-sizing: border-box; padding: 4px 12px 4px 36px; border: 1px solid #85878d; border-radius: 6px; background: transparent; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; color: #101115;"
  />
</div>
```

**Select trigger** (the shadcn Select; its menu is §13). Use sm 32 in
toolbars and workspaces, 36 in forms:

```html
<span
  id="group-label"
  style="font-size: 14px; line-height: 14px; font-weight: 500; color: #101115;"
  >Group</span
>
<button
  type="button"
  id="group"
  class="rk-outline"
  aria-haspopup="listbox"
  aria-expanded="false"
  aria-labelledby="group-label group"
  style="width: 360px; height: 36px; box-sizing: border-box; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid #85878d; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; color: #101115; text-align: left; cursor: pointer;"
>
  <span>Dining</span
  ><svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none;opacity:.5"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
</button>
```

Put it in the field stack (label, 12, trigger, 12, helper). A form select in
the app rests transparent: swap `rk-outline` for `rk-ghost` there and keep
the border. A placeholder value is `color: #5b5d63`.

**Native select** (fine for simple fields):

```html
<select
  id="threshold"
  class="rk-input"
  style="width: 100%; height: 36px; box-sizing: border-box; padding: 0 12px; border: 1px solid #85878d; border-radius: 6px; background: #f7f8fa; font-size: 14px; line-height: 20px; color: #101115;"
>
  <option>3★ or below</option>
</select>
```

**Switch** (on; for off set `aria-checked="false"`, track `#dcdee2`, thumb `transform: none`):

```html
<div style="display: flex; align-items: center; gap: 8px;">
  <button
    type="button"
    role="switch"
    aria-checked="true"
    aria-labelledby="sw-fail"
    style="position: relative; width: 32px; height: 18.4px; box-sizing: border-box; padding: 0; border: 1px solid transparent; border-radius: 9999px; background: #512da6; display: inline-flex; align-items: center; flex: none; cursor: pointer;"
  >
    <span
      aria-hidden="true"
      style="width: 16px; height: 16px; border-radius: 50%; background: #f7f8fa; transform: translateX(14px);"
    ></span>
  </button>
  <span
    id="sw-fail"
    style="font-size: 14px; line-height: 14px; font-weight: 500; color: #101115;"
    >Make the next send fail</span
  >
</div>
```

**Checkbox** (checked; unchecked: the span gets `background: transparent; border-color: #dcdee2` and loses the svg; the input loses `checked`):

```html
<label
  style="display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
>
  <input type="checkbox" class="rk-check sr-only" checked />
  <span
    aria-hidden="true"
    style="width: 16px; height: 16px; box-sizing: border-box; flex: none; border: 1px solid #512da6; border-radius: 4px; background: #512da6; box-shadow: 0 1px 2px rgba(0,0,0,.05); display: flex; align-items: center; justify-content: center;"
    ><svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#feffff"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="M20 6 9 17l-5-5" /></svg
  ></span>
  Include Pool bar
</label>
```

**Radio** (checked; unchecked: border `#85878d` and no inner dot):

```html
<label
  style="display: flex; align-items: flex-start; gap: 8px; font-size: 14px; line-height: 20px; color: #101115; cursor: pointer;"
>
  <input type="radio" name="start" class="rk-check sr-only" checked />
  <span
    aria-hidden="true"
    style="width: 16px; height: 16px; margin-top: 2px; box-sizing: border-box; flex: none; border: 1px solid #512da6; border-radius: 50%; display: flex; align-items: center; justify-content: center;"
    ><span
      style="width: 6px; height: 6px; border-radius: 50%; background: #512da6;"
    ></span
  ></span>
  <span style="display: flex; flex-direction: column; gap: 2px;"
    ><span>Avela Resort’s wording</span
    ><span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
      >Guests see the property’s welcome line and description until you write your
      own.</span
    ></span
  >
</label>
```

**Choice card** (radio card; checked shown; unchecked: border `#dcdee2`,
background `transparent` (hover `#f4f5f8`), the unchecked radio with its
`#85878d` ring):

```html
<label
  style="position: relative; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: 240px; height: 88px; padding: 16px; border: 1px solid #512da6; border-radius: 6px; background: #f6f5fb; cursor: pointer;"
>
  <input type="radio" name="place" class="rk-check sr-only" checked />
  <span
    aria-hidden="true"
    style="position: absolute; top: 16px; right: 16px; width: 16px; height: 16px; box-sizing: border-box; border: 1px solid #512da6; border-radius: 50%; display: flex; align-items: center; justify-content: center;"
    ><span
      style="width: 6px; height: 6px; border-radius: 50%; background: #512da6;"
    ></span
  ></span>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5b5d63"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
    <path d="M7 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
  </svg>
  <span style="display: flex; flex-direction: column;"
    ><span style="font-size: 14px; line-height: 20px; font-weight: 500; color: #101115;"
      >Restaurant or bar table</span
    ><span style="font-size: 13px; line-height: 18px; color: #5b5d63;"
      >Table tents and menus</span
    ></span
  >
</label>
```

---

## 7. Data table (property-list pattern)

Container, then `table-layout: fixed` with a `<colgroup>` whose widths add up
to the container's inner width (1136 content minus the 2px border = 1134).

```html
<div
  style="margin-top: 16px; background: #feffff; border: 1px solid #dcdee2; border-radius: 8px; overflow: hidden;"
>
  <table
    style="width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 14px; line-height: 20px; color: #101115;"
  >
    <caption class="sr-only">
      Portals at Avela Resort by group, last 90 days, needs attention first
    </caption>
    <colgroup>
      <col style="width: 278px;" />
      <col style="width: 236px;" />
      <col style="width: 92px;" />
      <col style="width: 88px;" />
      <col style="width: 100px;" />
      <col style="width: 110px;" />
      <col style="width: 98px;" />
      <col style="width: 84px;" />
      <col style="width: 48px;" />
    </colgroup>
    <thead>
      …
    </thead>
    <tbody>
      …one tbody per group…
    </tbody>
    <tfoot>
      …
    </tfoot>
  </table>
</div>
```

ADM01 widened Portal and Status and narrowed the figures against its brief
(264/200/104…) because the brief's copy did not fit: "Partly working · no one
responsible" needs 207px and "Restaurant or bar table · QR and NFC · EN, БГ"
needs about 245px. Numeric headers wrap to 2 lines inside 88–110px.

**Header row** (48 tall; two-line labels at most). Text column, then numeric
column, then plain and sr-only headers:

```html
<tr style="height: 48px; border-bottom: 1px solid #dcdee2;">
  <th scope="col" style="padding: 0 12px 0 16px; text-align: left; font-weight: 400;">
    <button
      type="button"
      class="rk-sort"
      style="display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0; border: 0; background: none; font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63; cursor: pointer;"
    >
      Portal<svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none;opacity:.4"
      >
        <path d="m21 16-4 4-4-4" />
        <path d="M17 20V4" />
        <path d="m3 8 4-4 4 4" />
        <path d="M7 4v16" />
      </svg>
    </button>
  </th>
  <th scope="col" style="padding: 8px 12px; text-align: right; font-weight: 400;">
    <button
      type="button"
      class="rk-sort"
      style="display: inline-block; padding: 0; border: 0; background: none; text-align: right; font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63; cursor: pointer;"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none;display:inline-block;vertical-align:-3px;margin-right:4px;opacity:.4"
      >
        <path d="m21 16-4 4-4-4" />
        <path d="M17 20V4" />
        <path d="m3 8 4-4 4 4" />
        <path d="M7 4v16" /></svg
      >Qualified scans
    </button>
  </th>
  <th scope="col" style="padding: 8px 12px; text-align: right; font-weight: 400;">
    <button
      type="button"
      class="rk-sort"
      style="display: inline-block; padding: 0; border: 0; background: none; text-align: right; font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63; cursor: pointer;"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none;display:inline-block;vertical-align:-3px;margin-right:4px;opacity:.4"
      >
        <path d="m21 16-4 4-4-4" />
        <path d="M17 20V4" />
        <path d="m3 8 4-4 4 4" />
        <path d="M7 4v16" /></svg
      ><svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none;display:inline-block;vertical-align:-2px;margin-right:4px"
      >
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg
      >Private notes
    </button>
  </th>
  <th
    scope="col"
    style="padding: 0 8px; text-align: left; font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63;"
  >
    Responsible
  </th>
  <th scope="col" style="padding: 0;"><span class="sr-only">Actions</span></th>
</tr>
```

The active sort (only when the board says a column is sorted): the `<th>`
gets `aria-sort="descending"`, the button `color: #101115`, and the icon
becomes `arrow-down` (or `arrow-up`) at full opacity:
`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;display:inline-block;vertical-align:-3px;margin-right:4px"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`.

**Group row** (44, `th scope="rowgroup"` spans Portal and Status; sums
13/20 500; the ⋯ only for real groups, not "Not in a group"):

```html
<tr style="height: 44px; background: #f7f8fa; border-bottom: 1px solid #dcdee2;">
  <th
    scope="rowgroup"
    colspan="2"
    style="padding: 0 12px 0 16px; text-align: left; font-size: 13px; line-height: 20px; font-weight: 500; color: #101115;"
  >
    Wellness<span style="color: #5b5d63;"> · 1 portal · </span
    ><span
      style="font-size: 12px; line-height: 16px; font-weight: 500; color: #a45f00; white-space: nowrap;"
      ><svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none;display:inline-block;vertical-align:-1px;margin-right:4px"
      >
        <path
          d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
        />
        <path d="M12 9v4" />
        <path d="M12 17h.01" /></svg
      >1 needs attention</span
    >
  </th>
  <td
    style="padding: 0 12px; text-align: right; font-size: 13px; line-height: 20px; font-weight: 500; font-variant-numeric: tabular-nums;"
  >
    286
  </td>
  <td
    style="padding: 0 12px; text-align: right; font-size: 13px; line-height: 20px; font-weight: 500; font-variant-numeric: tabular-nums;"
  >
    <span style="display: inline-flex; align-items: center; gap: 4px;"
      >4.6<svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="#da950b"
        stroke="#da950b"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <path
          d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
        /></svg
      ><span class="sr-only">stars</span></span
    >
  </td>
  <td></td>
  <td style="padding: 0 8px; text-align: right;">
    <button
      type="button"
      class="rk-ghost"
      aria-label="Actions for group Wellness"
      aria-haspopup="menu"
      aria-expanded="false"
      style="width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; color: #5b5d63; cursor: pointer;"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="12" r="1" />
      </svg>
    </button>
  </td>
</tr>
```

**Portal row** (62: the name is the row's one link, a meta line 2 below;
Status is a fact plus an optional second line; figures right aligned):

```html
<tr class="rk-row" style="height: 62px; border-bottom: 1px solid #dcdee2;">
  <td style="padding: 12px 12px 12px 16px;">
    <a href="#" class="rk-name" style="font-weight: 500; text-decoration: none;"
      >Olive Terrace restaurant</a
    >
    <div
      style="margin-top: 2px; font-size: 12px; line-height: 16px; color: #5b5d63; white-space: nowrap;"
    >
      Restaurant or bar table · QR and NFC · EN, <span lang="bg">БГ</span>
    </div>
  </td>
  <td style="padding: 12px;">
    <div
      style="display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: #101115;"
    >
      <span
        aria-hidden="true"
        style="width: 7px; height: 7px; flex: none; border-radius: 50%; background: #101115;"
      ></span
      >Live · v4
    </div>
    <div
      style="margin-top: 2px; display: flex; align-items: center; gap: 4px; font-size: 12px; line-height: 16px; color: #5b5d63;"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <path
          d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
        />
        <path d="m15 5 4 4" /></svg
      >1 change not live
    </div>
  </td>
  <td style="padding: 12px; text-align: right; font-variant-numeric: tabular-nums;">
    351
  </td>
  <td style="padding: 12px; text-align: right; font-variant-numeric: tabular-nums;">
    <span style="display: inline-flex; align-items: center; gap: 4px;"
      ><span style="font-weight: 500;">4.2</span
      ><svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="#da950b"
        stroke="#da950b"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <path
          d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
        /></svg
      ><span class="sr-only">stars</span></span
    >
  </td>
  <td style="padding: 12px 8px;">
    <span style="display: flex;"
      ><span
        aria-hidden="true"
        style="width: 20px; height: 20px; border-radius: 50%; background: #dcdee2; color: #101115; font-size: 10px; line-height: 20px; font-weight: 500; text-align: center;"
        >GI</span
      ><span class="sr-only">Georgi Ivanov</span></span
    >
  </td>
  <td style="padding: 0 8px; text-align: right;">
    <button
      type="button"
      class="rk-ghost"
      aria-label="Actions for Olive Terrace restaurant"
      aria-haspopup="menu"
      aria-expanded="false"
      style="width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; color: #5b5d63; cursor: pointer;"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="12" r="1" />
      </svg>
    </button>
  </td>
</tr>
```

- Single-line row (ADM02, 52): drop the meta `<div>` and put the place type
  inline after the name: `<span style="font-size: 12px; line-height: 16px; color: #5b5d63;"> · Restaurant or bar table</span>`; set `height: 52px`.
- A draft's figures: one cell `<td colspan="5" style="padding: 12px; font-size: 13px; line-height: 20px; color: #5b5d63;">Not published yet</td>`. Never five dashes.
- Under the floor: the average cell holds the "Too few" detail (§8).
- Selected row (bulk selection): `background: #f0f2f5` on each cell, and a
  16px checkbox (§6) in a 40px leading cell.
- The last body row before `<tfoot>` has no `border-bottom`.

**Total row** (52; the #b5b7bd line goes on the cells, because a row border
loses to the row above it in the collapsed model):

```html
<tfoot>
  <tr style="height: 52px;">
    <th
      scope="row"
      colspan="2"
      style="padding: 0 12px 0 16px; border-top: 1px solid #b5b7bd; text-align: left; font-weight: 500;"
    >
      All portals · 5
    </th>
    <td
      style="padding: 0 12px; border-top: 1px solid #b5b7bd; text-align: right; font-weight: 500; font-variant-numeric: tabular-nums;"
    >
      1,087
    </td>
    <td style="border-top: 1px solid #b5b7bd;"></td>
  </tr>
</tfoot>
```

**Basis line** under a table: `<p style="margin: 12px 0 0; font-size: 14px; line-height: 20px; color: #5b5d63;">Last 90 days, Europe/Sofia time · An average needs 5 private ratings · Sorted by what needs attention, then name.</p>`

**Toolbar** above a table (16 above it): the search, outline sm menu
triggers, then when filtered a count and a ghost Clear, a flex spacer, then
the range trigger:

```html
<div style="margin-top: 24px; display: flex; align-items: center; gap: 8px;">
  …search input… …outline sm "Show: All" trigger…
  <span
    style="margin-left: 4px; font-size: 14px; line-height: 20px; color: #5b5d63; font-variant-numeric: tabular-nums;"
    >1 of 5</span
  >
  …ghost sm "Clear"…
  <span style="flex: 1;"></span>
  <button
    type="button"
    class="rk-outline"
    aria-haspopup="menu"
    aria-expanded="false"
    aria-label="Time range: last 90 days"
    style="height: 32px; box-sizing: border-box; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" /></svg
    ><span>Last 90 days</span
    ><svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5b5d63"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>
</div>
```

Filtering rows in the mock: never put `<sc-if>` between table tags (the HTML
parser moves it out of the table). Bind `hidden="{{ f.hideDining }}"` on the
`<tbody>` or `<tr>` instead, as ADM01 does.

A small table with no box (Share "Where it's placed", Property look
"Portals using this look"): no container, header 12/16 500 #5b5d63 with
`padding: 0 0 8px` and `border-bottom: 1px solid #dcdee2`, rows 36–44 with
`border-bottom: 1px solid #dcdee2`, 13/20 text.

---

## 8. Facts, details, status and health

A FACT has no box and cannot be clicked. A DETAIL is a fact inside a
`<button>` whose words carry a dotted underline and which opens a popover
(not drawn open unless the board says so). A CONTROL is a button (§5).

```html
<!-- status facts, 13/20 -->
<span
  style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: #101115;"
  ><span
    aria-hidden="true"
    style="width: 7px; height: 7px; flex: none; border-radius: 50%; background: #101115;"
  ></span
  >Live · version 5</span
>
<span
  style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: #101115;"
  ><span
    aria-hidden="true"
    style="width: 7px; height: 7px; flex: none; box-sizing: border-box; border-radius: 50%; border: 1.5px solid #b5b7bd;"
  ></span
  >Draft · not published</span
>
<span
  style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: #101115;"
  ><span
    aria-hidden="true"
    style="width: 7px; height: 7px; flex: none; border-radius: 50%; background: #b5b7bd;"
  ></span
  >Paused</span
>
<span
  style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: #5b5d63;"
  ><span
    aria-hidden="true"
    style="width: 7px; height: 7px; flex: none; border-radius: 50%; background: #b5b7bd;"
  ></span
  >Archived 2 Sep</span
>
<!-- a glyph-led fact -->
<span
  style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; color: #101115;"
  ><svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5b5d63"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path
      d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
    />
    <path d="m15 5 4 4" /></svg
  >4 changes not live</span
>
```

Status vocabulary (publication): **Live · vN** (● #101115) · **Draft · not
published** (hollow ring) · **Paused** (● #b5b7bd, "Paused by … · date" as
its detail) · **Archived** (● #b5b7bd, secondary ink). Write "version 5" in
workspace headers and ledgers, "v5" in dense rows. The filled purple
"Published" badge and the theme swatch are retired.

Health vocabulary (from the domain's healthy / degraded / unavailable), one
line each, always with words and who can fix it:

| Health                    | Glyph and ink                              | Words                                                                                                      |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| healthy                   | 7px dot #101115, text #101115              | "Working · guests can rate and open Google" + 12/16 #5b5d63 "Checked 2 min ago". Quiet: one line, no rows. |
| degraded                  | `triangle-alert` #a45f00, text #a45f00 500 | "Partly working · {reason}" (e.g. "no one responsible", "property Google link").                           |
| unavailable               | `octagon-x` #a45f00, text #a45f00 500      | "Not working · guests see ‘not available’".                                                                |
| draft / paused / archived | the publication fact                       | Health is not shown for them.                                                                              |

Attention is always #a45f00 ink plus a glyph plus words. Never #a45f00 on
#f0f2f5 (4.44:1). #007a3a and #d00021 appear only with a sign or an arrow.

```html
<!-- attention DETAIL in a table row (12/16); its accessible name includes the portal -->
<button
  type="button"
  class="rk-detail"
  aria-haspopup="dialog"
  aria-expanded="false"
  style="margin-top: 2px; display: flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font-size: 12px; line-height: 16px; font-weight: 500; color: #a45f00; white-space: nowrap; cursor: help;"
>
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" /></svg
  ><span class="sr-only">Spa &amp; thermal pools: </span
  ><span
    style="text-decoration: underline dotted currentColor; text-underline-offset: 4px;"
    >Partly working · no one responsible</span
  >
</button>
<!-- DETAIL in a header fact group (13/20, min-height 32) -->
<button
  type="button"
  class="rk-detail"
  aria-haspopup="dialog"
  aria-expanded="false"
  style="min-height: 32px; display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; font-size: 13px; line-height: 20px; color: #101115; cursor: help;"
>
  <span
    aria-hidden="true"
    style="width: 7px; height: 7px; flex: none; border-radius: 50%; background: #101115;"
  ></span
  ><span
    style="text-decoration: underline dotted currentColor; text-underline-offset: 4px;"
    >Live · version 5</span
  >
</button>
<!-- under the floor -->
<button
  type="button"
  class="rk-detail"
  aria-haspopup="dialog"
  aria-expanded="false"
  style="padding: 0; border: 0; background: none; font-size: 13px; line-height: 20px; color: #5b5d63; cursor: help;"
>
  <span
    style="text-decoration: underline dotted currentColor; text-underline-offset: 4px;"
    >Too few</span
  ><span class="sr-only"> private ratings for an average at Guest rooms</span>
</button>
<!-- who can fix, under a health or check sentence -->
<p style="margin: 2px 0 0; font-size: 12px; line-height: 16px; color: #5b5d63;">
  Who can fix: a Property manager or Account admin
</p>
<!-- an Account-admin-only item for a Property manager: a fact, never a disabled button -->
<span
  style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; color: #5b5d63;"
  ><svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg
  >Set by an Account admin · Elena Petrova</span
>
<!-- waiting-for-approval fact (12/16) -->
<span
  style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; line-height: 16px; font-weight: 500; color: #a45f00;"
  ><svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6h4" /></svg
  >Waiting for an Account admin</span
>
```

Numbers:

```html
<!-- average with n: the number, the gold star, sr-only 'stars' -->
<span style="display: inline-flex; align-items: center; gap: 4px;"
  ><span style="font-weight: 500; font-variant-numeric: tabular-nums;">4.4</span
  ><svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="#da950b"
    stroke="#da950b"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none"
  >
    <path
      d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
    /></svg
  ><span class="sr-only">stars</span></span
><span style="margin-left: 6px; font-size: 12px; line-height: 16px; color: #5b5d63;"
  >from 118</span
>
<!-- deltas: absolute for counts, averages only with 10+ ratings in both periods -->
<span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
  ><span style="color: #007a3a; font-weight: 500;">+11</span> vs the 30 days before</span
>
<span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
  ><span style="color: #007a3a; font-weight: 500;">↑ 0.1</span> vs the 30 days
  before</span
>
<span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
  ><span style="color: #d00021; font-weight: 500;">−6</span> vs the 30 days before</span
>
<span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
  >No change vs the 30 days before</span
>
```

Owner discs: a fact is `#dcdee2` / `#101115`; a stack overlaps by -4 with a
2px ring in the surface colour; as a control (a "Change" trigger) the disc is
`#e7e4ff` / `#512da6`.

```html
<span style="display: flex;"
  ><span
    aria-hidden="true"
    style="width: 20px; height: 20px; border-radius: 50%; background: #dcdee2; color: #101115; font-size: 10px; line-height: 20px; font-weight: 500; text-align: center;"
    >GI</span
  ><span
    aria-hidden="true"
    style="width: 20px; height: 20px; margin-left: -4px; border-radius: 50%; background: #dcdee2; box-shadow: 0 0 0 2px #feffff; color: #101115; font-size: 10px; line-height: 20px; font-weight: 500; text-align: center;"
    >EP</span
  ><span class="sr-only">Georgi Ivanov and Elena Petrova</span></span
>
```

On #f7f8fa change the ring to `0 0 0 2px #f7f8fa`. No one responsible reads
`<span style="font-size: 12px; line-height: 16px; font-weight: 500; color: #a45f00;">No one</span>`.

---

## 9. Strips and KPI tiles

### STRIP (a `<dl>` of equal cells on a hairline grid; filters live here)

A filtering cell: the `<button aria-pressed>` holds the value and stretches
over the whole cell through `rk-stretch`; the cell's class carries the hover
and the pressed fill. Bind the pressed class and `aria-pressed` from state:
`class="rk-cell rk-cell-i {{ f.onAttn }}"` where `f.onAttn` is `'is-on'` when
pressed and `''` otherwise, and `aria-pressed="{{ f.pAttn }}"` (a boolean). A link cell uses an `<a class="rk-stretch">` on its detail line. A
static cell is `class="rk-cell"` with plain text.

```html
<h2 class="sr-only">Summary</h2>
<dl
  style="margin: 24px 0 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: #dcdee2; border: 1px solid #dcdee2; border-radius: 8px; overflow: hidden;"
>
  <div
    class="rk-cell rk-cell-i"
    style="position: relative; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px;"
  >
    <dt style="font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63;">
      Needs attention
    </dt>
    <dd style="margin: 0; display: flex; flex-direction: column; gap: 4px;">
      <button
        type="button"
        class="rk-stretch"
        aria-pressed="false"
        aria-label="Needs attention: 1 portal. Show only these"
        style="align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; font-size: 18px; line-height: 28px; font-weight: 700; font-variant-numeric: tabular-nums; color: #101115; cursor: pointer;"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#a45f00"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          style="flex:none"
        >
          <path
            d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
          />
          <path d="M12 9v4" />
          <path d="M12 17h.01" /></svg
        >1
      </button>
      <span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
        >Spa &amp; thermal pools</span
      >
    </dd>
  </div>
  <div
    class="rk-cell rk-cell-i"
    style="position: relative; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px;"
  >
    <dt style="font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63;">
      Private notes waiting
    </dt>
    <dd style="margin: 0; display: flex; flex-direction: column; gap: 4px;">
      <span
        style="display: inline-flex; align-items: center; gap: 6px; font-size: 18px; line-height: 28px; font-weight: 700; font-variant-numeric: tabular-nums; color: #101115;"
        ><svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#5b5d63"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          style="flex:none"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg
        >3</span
      >
      <a
        href="#"
        class="rk-stretch"
        aria-label="3 private notes waiting. Open in Inbox"
        style="align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; line-height: 16px; color: #512da6; text-decoration: none;"
        >Open in Inbox<svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          style="flex:none"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" /></svg
      ></a>
    </dd>
  </div>
</dl>
```

A cell is 92 tall inside the 1px border. On the phone (ADM04) use
`grid-template-columns: repeat(2, minmax(0, 1fr))`, cell padding `10px 12px`,
no detail line.

### METRIC STRIP (Activity, Analytics: no fill, hairlines above and below)

```html
<dl
  style="margin: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid #dcdee2; border-bottom: 1px solid #dcdee2;"
>
  <div
    style="padding: 12px 16px 12px 0; display: flex; flex-direction: column; gap: 4px;"
  >
    <dt style="font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63;">
      Qualified scans
    </dt>
    <dd style="margin: 0; display: flex; flex-direction: column; gap: 2px;">
      <span
        style="font-size: 24px; line-height: 32px; font-weight: 700; font-variant-numeric: tabular-nums; color: #101115;"
        >96</span
      ><span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
        ><span style="color: #007a3a; font-weight: 500;">+11</span> vs the 30 days
        before</span
      >
    </dd>
  </div>
  <div
    style="padding: 12px 16px; border-left: 1px solid #dcdee2; display: flex; flex-direction: column; gap: 4px;"
  >
    <dt style="font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63;">
      Average private rating
    </dt>
    <dd style="margin: 0; display: flex; flex-direction: column; gap: 2px;">
      <span
        style="display: inline-flex; align-items: center; gap: 6px; font-size: 24px; line-height: 32px; font-weight: 700; font-variant-numeric: tabular-nums; color: #101115;"
        >4.6<svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="#da950b"
          stroke="#da950b"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          style="flex:none"
        >
          <path
            d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
          /></svg
        ><span class="sr-only">stars</span></span
      ><span style="font-size: 12px; line-height: 16px; color: #5b5d63;"
        >from 31 · no change</span
      >
    </dd>
  </div>
</dl>
```

The first cell has no left padding; every other cell has
`border-left: 1px solid #dcdee2`. The analytics page scale is dt 14/20, value
30/36 and context 14/20 with padding 16. A dt that is a definition becomes a
DETAIL button (§8) at the dt's size.

### KPI TILE (a link; Overview pattern)

```html
<a
  href="#"
  class="rk-tile"
  style="display: flex; flex-direction: column; padding: 16px; border: 1px solid #dcdee2; border-radius: 8px; color: #101115; text-decoration: none;"
>
  <span style="font-size: 14px; line-height: 20px; font-weight: 500; color: #5b5d63;"
    >Qualified scans</span
  >
  <span
    style="margin-top: 8px; font-size: 30px; line-height: 36px; font-weight: 700; font-variant-numeric: tabular-nums;"
    >1,087</span
  >
  <span style="margin-top: 4px; font-size: 14px; line-height: 20px; color: #5b5d63;"
    ><span style="color: #007a3a; font-weight: 500;">+117</span> vs the 90 days
    before</span
  >
</a>
```

The app also shows `arrow-right` 16 #5b5d63 at the top right on hover; boards
leave it out. With thin data drop the value and write one sentence: "Fewer than 10 ratings so
far, so there is no comparison yet."

### Range control (Analytics header; 44 tall on standard pages, 32 in ROW2)

```html
<div role="group" aria-label="Time range" style="display: flex; gap: 4px;">
  <button
    type="button"
    class="rk-ghost"
    aria-pressed="false"
    style="height: 44px; min-width: 80px; padding: 0 12px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    30 days
  </button>
  <button
    type="button"
    aria-pressed="true"
    style="height: 44px; min-width: 80px; padding: 0 12px; border: 0; border-radius: 6px; background: #f0f2f5; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    90 days
  </button>
  <button
    type="button"
    class="rk-ghost"
    aria-pressed="false"
    style="height: 44px; min-width: 80px; padding: 0 12px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    6 months
  </button>
  <button
    type="button"
    class="rk-ghost"
    aria-pressed="false"
    style="height: 44px; min-width: 80px; padding: 0 12px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
  >
    All time
  </button>
</div>
```

---

## 10. Timeline / ledger (the Inbox Timeline)

32px indicator column, 2px connector at left 15, 12 gap, sentences "Actor ·
verb · object · time". People get a 32 initials indicator; system events a
24 indicator (margin 4) with a 14 icon. The last item has no connector.

```html
<ol
  aria-label="History"
  style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;"
>
  <li style="position: relative; display: flex; gap: 12px; padding-bottom: 12px;">
    <span
      aria-hidden="true"
      style="flex: none; margin: 4px; width: 24px; height: 24px; box-sizing: border-box; border: 1px solid #b5b7bd; border-radius: 50%; background: #feffff; color: #5b5d63; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <path
          d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"
        />
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg
    ></span>
    <span
      aria-hidden="true"
      style="position: absolute; left: 15px; top: 32px; bottom: 0; width: 2px; background: #dcdee2;"
    ></span>
    <p
      style="margin: 0; padding: 6px 0; font-size: 13px; line-height: 20px; color: #5b5d63;"
    >
      <b style="font-weight: 500; color: #101115;">Elena Petrova</b> changed
      <b style="font-weight: 500; color: #101115;">the property look</b> · waiting in this
      draft · <time datetime="2026-09-17T10:40" title="17 Sep 2026, 10:40">17 Sep</time>
    </p>
  </li>
  <li style="position: relative; display: flex; gap: 12px; padding-bottom: 12px;">
    <span
      aria-hidden="true"
      style="flex: none; width: 32px; height: 32px; box-sizing: border-box; border: 1px solid #b5b7bd; border-radius: 50%; background: #feffff; color: #5b5d63; font-size: 11px; line-height: 1; font-weight: 500; display: flex; align-items: center; justify-content: center;"
      >EP</span
    >
    <span
      aria-hidden="true"
      style="position: absolute; left: 15px; top: 32px; bottom: 0; width: 2px; background: #dcdee2;"
    ></span>
    <div style="flex: 1; min-width: 0; padding: 6px 0;">
      <p style="margin: 0; font-size: 13px; line-height: 20px; color: #5b5d63;">
        <b style="font-weight: 500; color: #101115;">Elena Petrova</b> published
        <b style="font-weight: 500; color: #101115;">version 5</b> · replaced the welcome
        line, added ‘Getting here’ ·
        <time datetime="2026-09-12T09:15" title="12 Sep 2026, 09:15">12 Sep</time>
      </p>
    </div>
  </li>
  <li style="position: relative; display: flex; gap: 12px;">
    <span
      aria-hidden="true"
      style="flex: none; margin: 4px; width: 24px; height: 24px; box-sizing: border-box; border: 1px solid #b5b7bd; border-radius: 50%; background: #feffff; color: #5b5d63; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h8" />
        <path d="M12 8v8" /></svg
    ></span>
    <p
      style="margin: 0; padding: 6px 0; font-size: 13px; line-height: 20px; color: #5b5d63;"
    >
      <b style="font-weight: 500; color: #101115;">Georgi Ivanov</b> created
      <b style="font-weight: 500; color: #101115;">Reception</b> ·
      <time datetime="2026-07-03T11:02" title="3 Jul 2026, 11:02">3 Jul</time>
    </p>
  </li>
</ol>
```

- Attention event: the indicator gets `border-color: #edcb85; background: #fff6dd; color: #a45f00` and a `triangle-alert` 14.
- Hovered version row (restore): add at the right of the sentence
  `<span style="margin-left: auto; display: flex; gap: 6px;">` with two
  outline xs buttons "View" and "Make live again…"; give the item
  `background: #f9fafb; border-radius: 6px` while hovered.
- Folded routine events: a sm indicator with `history` 14 and
  `<p style="margin: 0; padding: 6px 0; font-size: 13px; line-height: 20px; color: #5b5d63;">3 routine checks passed · <button type="button" style="padding: 0; border: 0; background: none; font-size: 13px; line-height: 20px; font-weight: 500; color: #512da6; cursor: pointer;">Show</button></p>`.
- A private note body: `<div style="margin-top: 4px; padding: 12px 16px; border: 1px dashed #edcb85; border-radius: 8px; background: #fff6dd; font-size: 13px; line-height: 20px; color: #101115;"><span style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px; font-size: 12px; line-height: 16px; font-weight: 500; color: #a45f00;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Internal note</span>…</div>`.

Event icons (a person's publish or restore uses their initials instead):
`circle-plus` created · `rotate-ccw` made live again · `user-plus` / `user-minus`
responsibility · `triangle-alert` health went bad · `circle-check` back to
normal · `qr-code` code issued · `download` kit downloaded · `palette`
property look · `pencil` draft edits · `history` folded routine events.

---

## 11. Charts (ChartFrame)

Neutral ink only: bars #5b5d63 with a 4px top radius, lines #101115 at 2px,
horizontal dashed grid `3 3` #edeef1, no axis or tick lines, 12px ticks
#5b5d63. Purple is never data. The figcaption is a computed sentence.
Fewer than 3 non-empty buckets: no chart, one sentence.

```html
<figure style="margin: 0; display: flex; flex-direction: column; gap: 8px;">
  <figcaption
    id="chart-cap"
    style="display: flex; justify-content: space-between; align-items: center; gap: 16px; font-size: 14px; line-height: 20px; color: #5b5d63;"
  >
    <span>Weekly qualified scans and the average private rating.</span>
    <span
      aria-hidden="true"
      style="display: flex; gap: 16px; font-size: 12px; line-height: 16px;"
      ><span style="display: inline-flex; align-items: center; gap: 6px;"
        ><span
          style="width: 8px; height: 8px; border-radius: 2px; background: #5b5d63;"
        ></span
        >Qualified scans</span
      ><span style="display: inline-flex; align-items: center; gap: 6px;"
        ><span style="width: 8px; height: 2px; background: #101115;"></span>Average
        private rating</span
      ></span
    >
  </figcaption>
  <svg
    width="640"
    height="176"
    viewBox="0 0 640 176"
    role="img"
    aria-labelledby="chart-cap"
    style="display:block;overflow:visible;font-family:Satoshi,system-ui,sans-serif"
  >
    <line
      x1="32"
      x2="608"
      y1="140.0"
      y2="140.0"
      stroke="#edeef1"
      stroke-dasharray="3 3"
    />
    <text x="24" y="144.0" text-anchor="end" font-size="12" fill="#5b5d63">0</text>
    <line x1="32" x2="608" y1="74.0" y2="74.0" stroke="#edeef1" stroke-dasharray="3 3" />
    <text x="24" y="78.0" text-anchor="end" font-size="12" fill="#5b5d63">20</text>
    <line x1="32" x2="608" y1="8.0" y2="8.0" stroke="#edeef1" stroke-dasharray="3 3" />
    <text x="24" y="12.0" text-anchor="end" font-size="12" fill="#5b5d63">40</text>
    <text x="616" y="144.0" font-size="12" fill="#5b5d63">1</text>
    <text x="616" y="78.0" font-size="12" fill="#5b5d63">3</text>
    <text x="616" y="12.0" font-size="12" fill="#5b5d63">5</text>
    <path d="M42.2 140V54.9a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M86.5 140V48.3a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M130.8 140V45.0a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M175.1 140V41.7a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M219.4 140V35.1a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M263.7 140V28.5a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M308.0 140V25.2a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M352.3 140V31.8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M396.6 140V35.1a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M440.9 140V38.4a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M485.2 140V41.7a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M529.5 140V45.0a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <path d="M573.8 140V41.7a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4V140z" fill="#5b5d63" />
    <polyline
      points="54.2,31.1 98.5,31.1 142.8,27.8 187.1,34.4 231.4,27.8 275.7,24.5 320.0,27.8 364.3,31.1 408.6,27.8 452.9,24.5 497.2,27.8 541.5,24.5 585.8,21.2"
      fill="none"
      stroke="#101115"
      stroke-width="2"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <text x="54.2" y="164" text-anchor="middle" font-size="12" fill="#5b5d63">
      22 Jun
    </text>
    <text x="142.8" y="164" text-anchor="middle" font-size="12" fill="#5b5d63">
      6 Jul
    </text>
    <text x="231.4" y="164" text-anchor="middle" font-size="12" fill="#5b5d63">
      20 Jul
    </text>
    <text x="320.0" y="164" text-anchor="middle" font-size="12" fill="#5b5d63">
      3 Aug
    </text>
    <text x="408.6" y="164" text-anchor="middle" font-size="12" fill="#5b5d63">
      17 Aug
    </text>
    <text x="497.2" y="164" text-anchor="middle" font-size="12" fill="#5b5d63">
      31 Aug
    </text>
    <text x="585.8" y="164" text-anchor="middle" font-size="12" fill="#5b5d63">
      14 Sep
    </text>
  </svg>
</figure>
```

The plot above is 640 × 176 (plot area x32–608, y8–140; bars 24 wide in
13 bands; left axis 0–40, right axis 1–5; labels 24 below the baseline). To
scale to other data: `y = 140 − value / max × 132`; a bar is
`M{x} 140 V{y+4} a4 4 0 0 1 4-4 h16 a4 4 0 0 1 4 4 V140 z`.

A version tick (ADM14): `<line x1="{x}" x2="{x}" y1="8" y2="140" stroke="#b5b7bd"/>`
plus a DETAIL label "v5" in 12/16 #5b5d63 positioned over the plot top.

**Funnel bars** (From scan to Google; true widths, never clamped):

```html
<div
  style="display: grid; grid-template-columns: 200px 1fr 260px; align-items: center; column-gap: 12px; row-gap: 12px; font-size: 14px; line-height: 20px;"
>
  <span style="font-weight: 500;">Qualified scans</span
  ><span style="height: 20px;"
    ><span
      style="display: block; width: 100%; height: 20px; border-radius: 4px; background: #5b5d63;"
    ></span></span
  ><span style="font-variant-numeric: tabular-nums;">1,087</span>
  <span style="font-weight: 500;">Private ratings</span
  ><span style="height: 20px;"
    ><span
      style="display: block; width: 28.5%; height: 20px; border-radius: 4px; background: #5b5d63;"
    ></span></span
  ><span style="font-variant-numeric: tabular-nums;">310 · 29% of scans</span>
</div>
```

**Distribution bars** (rating mix):

```html
<div
  style="display: grid; grid-template-columns: 32px 1fr auto; align-items: center; column-gap: 8px; row-gap: 8px; font-size: 14px; line-height: 20px;"
>
  <span style="font-weight: 500; font-variant-numeric: tabular-nums;">5★</span
  ><span
    style="height: 8px; border-radius: 9999px; background: #f0f2f5; overflow: hidden;"
    ><span
      style="display: block; width: 66%; height: 8px; background: #5b5d63;"
    ></span></span
  ><span style="min-width: 80px; text-align: right; font-variant-numeric: tabular-nums;"
    >78 · 66%</span
  >
</div>
```

---

## 12. Empty states

Whole list empty (dashed `EmptyState`, one sentence, one action):

```html
<div
  style="display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 0; border: 1px dashed #dcdee2; border-radius: 8px; text-align: center;"
>
  <span
    aria-hidden="true"
    style="width: 40px; height: 40px; border-radius: 50%; background: #f0f2f5; color: #5b5d63; display: flex; align-items: center; justify-content: center;"
    ><svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" /></svg
  ></span>
  <p
    style="margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; color: #5b5d63;"
  >
    No portals yet
  </p>
  <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
    <p
      style="margin: 0; max-width: 420px; font-size: 14px; line-height: 20px; color: #5b5d63;"
    >
      A portal is the page guests reach from a code at a place such as reception or a
      table.
    </p>
    <a
      href="ADM03-new-portal-place.dc.html"
      class="rk-primary"
      style="height: 36px; box-sizing: border-box; padding: 0 12px; display: inline-flex; align-items: center; gap: 8px; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #feffff; text-decoration: none;"
      ><svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <path d="M5 12h14" />
        <path d="M12 5v14" /></svg
      >New portal</a
    >
  </div>
</div>
```

Search with no result: the same box with `search` 16, "No portals match
“spa”", "Try a shorter search, or clear it to see all 5 portals." and a ghost
sm "Clear search". Inside a populated page (availability by exception): no
box, no icon, one 14/20 #5b5d63 sentence and at most one action. Never a
dash, never a fake zero.

---

## 13. Menu and popover (only when a board draws one open)

Menus and popovers float over the page: position them `absolute` inside the
nearest `position: relative` wrapper outside any `overflow: hidden` table,
4px from their trigger, and set the trigger's `aria-expanded="true"`.

```html
<div
  role="menu"
  aria-label="Actions for Reception"
  style="position: absolute; top: 36px; right: 0; z-index: 20; min-width: 208px; box-sizing: border-box; padding: 4px; background: #feffff; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1); display: flex; flex-direction: column;"
>
  <button
    type="button"
    role="menuitem"
    class="rk-menuitem"
    style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; font-size: 14px; line-height: 20px; color: #101115; text-align: left; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5b5d63"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" /></svg
    >Open
  </button>
  <button
    type="button"
    role="menuitem"
    class="rk-menuitem"
    style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; font-size: 14px; line-height: 20px; color: #101115; text-align: left; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5b5d63"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" /></svg
    >Try as guest
  </button>
  <button
    type="button"
    role="menuitem"
    class="rk-menuitem"
    style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; font-size: 14px; line-height: 20px; color: #101115; text-align: left; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5b5d63"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" /></svg
    >Download print kit
  </button>
  <button
    type="button"
    role="menuitem"
    class="rk-menuitem"
    style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; font-size: 14px; line-height: 20px; color: #101115; text-align: left; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5b5d63"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path
        d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"
      />
      <path
        d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"
      />
      <path
        d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"
      /></svg
    >Move to group…
  </button>
  <div role="separator" style="height: 1px; margin: 4px -4px; background: #dcdee2;"></div>
  <button
    type="button"
    role="menuitem"
    class="rk-menuitem"
    style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; font-size: 14px; line-height: 20px; color: #101115; text-align: left; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5b5d63"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="10" x2="10" y1="15" y2="9" />
      <line x1="14" x2="14" y1="15" y2="9" /></svg
    >Pause public page…
  </button>
  <button
    type="button"
    role="menuitem"
    class="rk-menuitem"
    style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; font-size: 14px; line-height: 20px; color: #df202e; text-align: left; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" /></svg
    >Archive…
  </button>
</div>
```

The item under the pointer or with focus in a drawn state: add
`background: #e7e4ff;` inline and drop its class. A select's option list is
the same box with `role="listbox"` and `role="option"` items padded
`6px 32px 6px 8px` and a `check` 16 at `right: 8px` on the chosen one.
A label inside a menu: `<div style="padding: 6px 8px; font-size: 12px; line-height: 16px; font-weight: 500; color: #5b5d63;">Properties</div>`.

**Popover** (288 wide; the ADM01 attention detail's popover as the example):

```html
<div
  role="dialog"
  aria-label="Spa &amp; thermal pools needs attention"
  style="position: absolute; z-index: 20; width: 288px; box-sizing: border-box; padding: 16px; background: #feffff; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1); display: flex; flex-direction: column; gap: 12px;"
>
  <div>
    <p
      style="margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; color: #101115;"
    >
      No one is responsible for this portal
    </p>
    <p style="margin: 4px 0 0; font-size: 14px; line-height: 20px; color: #5b5d63;">
      Publishing is blocked, and alerts and private notes have no one to go to.
    </p>
    <p style="margin: 8px 0 0; font-size: 12px; line-height: 16px; color: #5b5d63;">
      Who can fix: a Property manager or Account admin
    </p>
  </div>
  <div style="display: flex; align-items: center; gap: 12px;">
    <button
      type="button"
      class="rk-primary"
      style="height: 32px; box-sizing: border-box; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #feffff; cursor: pointer;"
    >
      Assign a manager
    </button>
    <a
      href="ADM10-activity-health.dc.html"
      style="font-size: 14px; line-height: 20px; font-weight: 500; text-decoration: none;"
      >Open Activity</a
    >
  </div>
</div>
```

Tooltip: `bg #101115`, 12/16 text `#f7f8fa`, padding `6px 12px`, radius 6.

---

## 14. Dialog and sheet

Overlay over the whole board, rail and sidebar included (it is the last child
of the root):

```html
<div
  aria-hidden="true"
  style="position: absolute; inset: 0; z-index: 40; background: rgba(0,0,0,.5);"
></div>
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dlg-title"
  aria-describedby="dlg-desc"
  style="position: absolute; z-index: 50; left: 464px; top: 256px; width: 512px; box-sizing: border-box; padding: 24px; background: #f7f8fa; border: 1px solid #dcdee2; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1); display: flex; flex-direction: column; gap: 16px;"
>
  <button
    type="button"
    class="rk-ghost"
    aria-label="Close"
    style="position: absolute; top: 12px; right: 12px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #101115; opacity: .7; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style="flex:none"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  </button>
  <div style="display: flex; flex-direction: column; gap: 8px; padding-right: 24px;">
    <h2
      id="dlg-title"
      style="margin: 0; font-size: 18px; line-height: 22px; font-weight: 700; color: #101115;"
    >
      Make version 4 live again?
    </h2>
    <p
      id="dlg-desc"
      style="margin: 0; font-size: 14px; line-height: 20px; color: #5b5d63;"
    >
      Guests will see version 4 again. Nothing is deleted: version 5 stays in the history,
      and your draft keeps its 4 changes.
    </p>
  </div>
  …body…
  <div style="display: flex; justify-content: flex-end; gap: 8px;">
    <button
      type="button"
      class="rk-outline"
      style="height: 36px; box-sizing: border-box; padding: 0 16px; border: 1px solid #dcdee2; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05); font-size: 14px; line-height: 20px; font-weight: 500; color: #101115; cursor: pointer;"
    >
      Cancel
    </button>
    <button
      type="button"
      class="rk-primary"
      style="height: 36px; box-sizing: border-box; padding: 0 16px; border: 0; border-radius: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: #feffff; cursor: pointer;"
    >
      Make version 4 live
    </button>
  </div>
</div>
```

Centre it by hand: `left = (1440 − 512) / 2 = 464`, `top = (1024 − height) / 2`.
A destructive confirmation swaps the primary for `rk-destructive`. A small
alert dialog is 320 wide with its two buttons in two equal columns.

**Sheet (right)**:

```html
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="sheet-title"
  style="position: absolute; z-index: 50; top: 0; right: 0; bottom: 0; width: 384px; box-sizing: border-box; background: #f7f8fa; border-left: 1px solid #dcdee2; box-shadow: 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1); display: flex; flex-direction: column;"
>
  <div
    style="position: relative; padding: 16px; display: flex; flex-direction: column; gap: 6px;"
  >
    <h2
      id="sheet-title"
      style="margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: #101115;"
    >
      Assign a manager
    </h2>
    <p style="margin: 0; font-size: 14px; line-height: 20px; color: #5b5d63;">
      Spa &amp; thermal pools · Avela Resort
    </p>
    <button
      type="button"
      class="rk-ghost"
      aria-label="Close"
      style="position: absolute; top: 12px; right: 12px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #101115; opacity: .7; cursor: pointer;"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="flex:none"
      >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
  <div style="flex: 1; min-height: 0; overflow: hidden; padding: 0 16px;">…body…</div>
  <div
    style="padding: 16px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #dcdee2;"
  >
    …Cancel outline, one primary…
  </div>
</div>
```

---

## 15. Toast (top right, 24 from the edges; draw one only when a board says so)

```html
<div
  role="status"
  style="position: absolute; z-index: 60; top: 24px; right: 24px; width: 356px; box-sizing: border-box; padding: 16px; display: flex; align-items: flex-start; gap: 6px; background: #ecfdf3; border: 1px solid #bffcd9; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.1); font-size: 13px; color: #008a2e;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex:none;margin-top:2px"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m16 9-5.5 5.5L8 12" />
  </svg>
  <div style="display: flex; flex-direction: column; gap: 2px;">
    <span style="font-weight: 500; line-height: 1.5;"
      >Published. Guests see version 5 now.</span
    ><span style="line-height: 1.4;">Printed codes keep working.</span>
  </div>
</div>
```

Default toast: `background: #feffff; border-color: #dcdee2; color: #101115`,
description `#3f3f3f`, no icon. Warning: `#fffcf0` / `#fbeeb1` / `#dc7609`
with `triangle-alert`. Error: `#fff0f0` / `#ffe0e1` / `#e60000` with
`octagon-x`. Guarantees ("Printed codes keep working", "Try as guest records
nothing", "Google stays the same for every guest") live here, not on the page.

---

## 16. Guest preview (device, admin line, selection, GUEST-A, GUEST-B)

The guest page is the real guest page, never admin UI, and the admin never
borrows its colours. The beta has no photo uploads: GUEST-A always uses the
carved initial. Add the guest fonts to the ONE css2 link:

```html
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=JetBrains+Mono:wght@400;500&family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Ysabeau+Office:wght@400;600&family=Playfair:opsz,wght@5..1200,400..600&family=Sofia+Sans:wght@400;600;700&family=Sofia+Sans+Extra+Condensed:wght@800&display=swap"
/>
```

(keep only the families the board shows: A needs Cormorant Garamond and
Ysabeau Office; B needs Playfair and Sofia Sans; C adds Sofia Sans Extra
Condensed).

### STAGE, ADMIN LINE and DEVICE

The stage is `background: #f0f2f5`. The admin line sits 12 above the device.
The DEVICE is a wrapper sized to the scaled page (390s × 844s), 1px #b5b7bd,
radius 32s, one tab stop, `role="img"` with a label naming portal, source,
state and language. The scaled page inside is `aria-hidden` and has no
focusable elements.

| s                         | wrapper (inner) | radius |
| ------------------------- | --------------- | ------ |
| 0.9 (default)             | 351 × 759.6     | 28.8   |
| 0.8                       | 312 × 675.2     | 25.6   |
| 0.58 (three side by side) | 226.2 × 489.5   | 18.6   |

```html
<div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
  <p
    style="margin: 0; font-size: 13px; line-height: 20px; color: #5b5d63; text-align: center;"
  >
    Draft · Arrival · English
  </p>
  <div
    role="img"
    tabindex="0"
    aria-label="Guest preview: Pool bar, draft, arrival, English"
    style="position: relative; flex: none; width: 351px; height: 759.6px; border: 1px solid #b5b7bd; border-radius: 28.8px; overflow: hidden; background: #121614;"
  >
    …GUEST-A or GUEST-B page (390 × 844) with transform: scale(0.9)…
  </div>
</div>
```

For another scale change the wrapper's width, height and radius and the
page's `transform: scale(…)`; nothing else.

### SELECTION (edit mode; drawn in admin space, above the wrapper)

Put the device wrapper and the selection in one `position: relative` box.
For a guest region `(gx, gy, gw, gh)` at scale s, the outline box is
`left = 1 + gx·s − 6`, `top = 1 + gy·s − 6`, `width = gw·s + 12`,
`height = gh·s + 12` (4px gap plus the 2px line). The tag sits just outside
its top-left corner. Example: the h1 region (24, 240, 342, 32) at 0.9:

```html
<div style="position: relative; width: 353px; height: 761.6px;">
  …DEVICE wrapper…
  <div
    aria-hidden="true"
    style="position: absolute; left: 16.6px; top: 211px; width: 319.8px; height: 40.8px; box-sizing: border-box; border: 2px solid #7b65d1; border-radius: 4px; pointer-events: none;"
  ></div>
  <span
    aria-hidden="true"
    style="position: absolute; left: 16.6px; top: 189px; padding: 2px 6px; border-radius: 4px; background: #512da6; color: #feffff; font-size: 12px; line-height: 16px; font-weight: 500;"
    >Welcome</span
  >
</div>
```

The wrapper keeps `overflow: hidden`; the outline and tag are siblings, not
children, so they are not clipped.

### GUEST-A · Carved Stillness, Avela Resort, arrival (A1 geometry, no photo)

Paste inside the DEVICE wrapper. Change `scale(0.9)`, the h1 text, the
grain filter id (unique per board, e.g. `gA1`, `gA2`) and the language only.

```html
<div
  aria-hidden="true"
  style="position: absolute; left: 0; top: 0; width: 390px; height: 844px; overflow: hidden; transform: scale(0.9); transform-origin: top left; background: #121614; color: #F2ECE1; font-family: 'Ysabeau Office', system-ui, sans-serif; font-size: 16px; line-height: 24px;"
>
  <div
    style="position: absolute; left: 0; top: 0; width: 390px; height: 232px; overflow: hidden; background: radial-gradient(120% 90% at 50% 38%, #26302B 0%, #121614 72%);"
  >
    <svg
      width="390"
      height="232"
      viewBox="0 0 390 232"
      style="position: absolute; left: 0; top: 0;"
    >
      <text
        x="195"
        y="195"
        text-anchor="middle"
        font-family="Cormorant Garamond, Georgia, serif"
        font-weight="600"
        font-size="176"
        fill="#000000"
        fill-opacity=".55"
      >
        A
      </text>
      <text
        x="195"
        y="197"
        text-anchor="middle"
        font-family="Cormorant Garamond, Georgia, serif"
        font-weight="600"
        font-size="176"
        fill="#EEF1EE"
        fill-opacity=".08"
      >
        A
      </text>
      <text
        x="195"
        y="196"
        text-anchor="middle"
        font-family="Cormorant Garamond, Georgia, serif"
        font-weight="600"
        font-size="176"
        fill="#1E2622"
      >
        A
      </text>
    </svg>
    <svg
      style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .05; mix-blend-mode: overlay;"
    >
      <filter id="gA1">
        <feTurbulence
          type="fractalNoise"
          baseFrequency=".85"
          numOctaves="2"
          stitchTiles="stitch"
        ></feTurbulence>
        <feColorMatrix type="saturate" values="0"></feColorMatrix>
      </filter>
      <rect width="100%" height="100%" filter="url(#gA1)" />
    </svg>
  </div>
  <p
    style="position: absolute; left: 24px; top: 0; height: 56px; margin: 0; display: flex; align-items: center; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 14px; line-height: 20px; letter-spacing: .28em; text-transform: uppercase; color: #F2ECE1;"
  >
    Avela Resort
  </p>
  <div
    style="position: absolute; right: 24px; top: 6px; height: 44px; display: flex; align-items: center; font-weight: 600; font-size: 14px; line-height: 20px;"
  >
    <span
      style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: #F2ECE1; text-decoration: underline; text-decoration-color: #CDAE78; text-decoration-thickness: 1px; text-underline-offset: 6px;"
      >EN</span
    >
    <span style="width: 1px; height: 14px; background: rgba(214,207,195,.4);"></span>
    <span
      lang="bg"
      style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: #D6CFC3;"
      >БГ</span
    >
  </div>
  <p
    style="position: absolute; left: 24px; top: 248px; width: 342px; margin: 0; text-align: center; font-weight: 600; font-size: 12px; line-height: 16px; letter-spacing: .18em; text-transform: uppercase; color: #D9BE8C;"
  >
    Pool bar
  </p>
  <p
    style="position: absolute; left: 24px; top: 276px; width: 342px; margin: 0; text-align: center; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 32px; line-height: 38px; letter-spacing: -0.005em; color: #F2ECE1;"
  >
    How was your experience?
  </p>
  <div style="position: absolute; left: 35px; top: 334px; display: flex; gap: 10px;">
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8D8C85"
        stroke-width="1.1"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8D8C85"
        stroke-width="1.1"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8D8C85"
        stroke-width="1.1"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8D8C85"
        stroke-width="1.1"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8D8C85"
        stroke-width="1.1"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
  </div>
  <span
    style="position: absolute; left: 35px; top: 396px; font-size: 13px; line-height: 18px; color: #9D968A;"
    >Poor</span
  >
  <span
    style="position: absolute; right: 35px; top: 396px; font-size: 13px; line-height: 18px; color: #9D968A;"
    >Excellent</span
  >
  <div
    style="position: absolute; left: 24px; top: 462px; width: 342px; height: 52px; border-radius: 4px; background: #D4B57E; color: #121614; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 17px; line-height: 20px;"
  >
    Send privately
  </div>
  <p
    style="position: absolute; left: 24px; top: 526px; width: 342px; margin: 0; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 14px; line-height: 20px; color: #B8B0A3;"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#CDAE78"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg
    >Shared privately with Avela Resort.
  </p>
  <div
    style="position: absolute; left: 24px; top: 578px; width: 342px; height: 1px; background: #363835;"
  ></div>
  <p
    style="position: absolute; left: 24px; top: 594px; width: 342px; margin: 0; font-size: 13px; line-height: 19px; color: #9D968A;"
  >
    This page counts visits for Avela Resort. No ads or third-party trackers.
  </p>
  <div
    style="position: absolute; left: 24px; top: 636px; width: 342px; height: 44px; display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 14px; line-height: 20px; color: #D9BE8C;"
  >
    <span style="text-decoration: underline; text-underline-offset: 3px;"
      >Privacy notice</span
    ><span
      style="width: 72px; height: 44px; display: flex; align-items: center; justify-content: flex-end;"
      >Got it</span
    >
  </div>
  <p
    style="position: absolute; left: 24px; top: 704px; width: 342px; margin: 0; text-align: center; font-size: 17px; line-height: 26px; color: #D6CFC3;"
  >
    Stone, olive shade and water that keeps the last of the light. Thank you for spending
    part of your day with us.
  </p>
  <div
    style="position: absolute; left: 24px; top: 800px; width: 342px; height: 1px; background: #363835;"
  ></div>
  <div
    style="position: absolute; left: 24px; top: 800px; width: 342px; height: 44px; display: flex; align-items: center; justify-content: space-between;"
  >
    <span
      style="font-weight: 600; font-size: 13px; line-height: 18px; color: #D9BE8C; text-decoration: underline; text-underline-offset: 3px;"
      >Privacy notice</span
    ><span style="font-size: 12px; line-height: 16px; color: #9D968A;"
      >Made with Reputation Key</span
    >
  </div>
</div>
```

Variants of GUEST-A, same frame:

- **Bulgarian**: `lang="bg"` on the page div; EN loses the underline and
  turns `#D6CFC3`, БГ gets it and `#F2ECE1`. The legend "Как беше
  преживяването ви?" takes two lines (276–352) and everything below moves
  +38: stars 372, endpoints 434 ("Слабо" / "Отлично"), submit 500
  ("Изпрати поверително"), privacy 564 ("Споделя се поверително с Avela
  Resort."), hairline 616, notice 632, actions 674, description 742.
- **A selected star** (e.g. 4 = Very good): stars 1–4 get
  `fill="#CDAE78" stroke="#CDAE78" stroke-width="1.4"`, and the caption slot
  shows `<p style="position: absolute; left: 24px; top: 420px; width: 342px; margin: 0; text-align: center; font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; font-weight: 500; font-size: 22px; line-height: 26px; color: #D9BE8C;">Very good</p>`.
- **After rating** (A2/A3 geometry): delete everything from the legend down
  and add the blocks below. The Google card is pixel-identical for every
  score; the private card appears only at 3★ or below.

```html
<p
  style="position: absolute; left: 24px; top: 276px; width: 342px; margin: 0; text-align: center; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 32px; line-height: 38px; color: #F2ECE1;"
>
  Thank you.
</p>
<div
  style="position: absolute; left: 24px; top: 326px; width: 342px; height: 44px; display: flex; align-items: center; justify-content: center; gap: 12px;"
>
  <span style="display: flex; gap: 3px;">
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="#CDAE78"
      stroke="#CDAE78"
      stroke-width="1.4"
      stroke-linejoin="round"
    >
      <path
        d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
      />
    </svg>
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="#CDAE78"
      stroke="#CDAE78"
      stroke-width="1.4"
      stroke-linejoin="round"
    >
      <path
        d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
      />
    </svg>
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8D8C85"
      stroke-width="1.4"
      stroke-linejoin="round"
    >
      <path
        d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
      />
    </svg>
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8D8C85"
      stroke-width="1.4"
      stroke-linejoin="round"
    >
      <path
        d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
      />
    </svg>
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8D8C85"
      stroke-width="1.4"
      stroke-linejoin="round"
    >
      <path
        d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
      />
    </svg>
  </span>
  <span style="font-size: 15px; line-height: 20px; color: #B8B0A3;"
    >Fair · sent privately</span
  >
  <span
    style="font-weight: 600; font-size: 15px; line-height: 20px; color: #D9BE8C; text-decoration: underline; text-underline-offset: 3px;"
    >Change</span
  >
</div>
<div
  style="position: absolute; left: 24px; top: 394px; width: 342px; height: 264px; box-sizing: border-box; padding: 24px; background: #1A1F1C; border: 1px solid #363835; border-radius: 4px;"
>
  <p
    style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 24px; line-height: 30px; color: #F2ECE1;"
  >
    Share your experience on Google
  </p>
  <p style="margin: 8px 0 0; font-size: 16px; line-height: 24px; color: #B8B0A3;">
    If you’d like, you can also leave a public review on Google.
  </p>
  <div
    style="margin-top: 20px; height: 52px; border-radius: 4px; background: #D4B57E; color: #121614; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 17px; line-height: 20px;"
  >
    Continue to Google<svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#121614"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  </div>
  <p
    style="margin: 10px 0 0; text-align: center; font-size: 13px; line-height: 18px; color: #9D968A;"
  >
    Opens Google · you may need to sign in
  </p>
</div>
<div
  style="position: absolute; left: 24px; top: 674px; width: 342px; height: 192px; box-sizing: border-box; padding: 24px; border: 1px solid #363835; border-radius: 4px;"
>
  <p
    style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 22px; line-height: 28px; color: #F2ECE1;"
  >
    Add a private note for the team
  </p>
  <p style="margin: 8px 0 0; font-size: 15px; line-height: 22px; color: #B8B0A3;">
    Optional. Shared privately with Avela Resort.
  </p>
  <div
    style="margin-top: 16px; height: 48px; box-sizing: border-box; border: 1px solid #CDAE78; border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 16px; line-height: 20px; color: #D9BE8C;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#CDAE78"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg
    >Write a private note
  </div>
</div>
```

For a 5★ state, fill all five mini stars, write "Excellent · sent
privately" and delete the private card; the Google card does not move.
The Google card's slot (394–658) never changes with the score.

### GUEST-B · Folio in Avela's colours, arrival (B1 geometry, no photo)

Used where the three looks sit side by side (ADM08) or where a board shows
Folio. Avela's colours on paper: stage `#F2ECE1`, ink `#121614`, text 2
`#4F4B45` (7.4:1), text 3 `#625D56` (5.6:1), idle star `#807B72` (3.6:1),
stars and underlines `#8A6A3C` (4.2:1, a 3:1 role), rules `#C1BDB4`.
**Small accent text** (the kicker, links, "Change") needs 4.5:1, so it uses
`#7A5C33` (5.2:1), not `#8A6A3C`: ADM08's brief puts the 12px kicker in
#8A6A3C, which is 4.24:1 on #F2ECE1 and fails.

```html
<div
  aria-hidden="true"
  style="position: absolute; left: 0; top: 0; width: 390px; height: 844px; overflow: hidden; transform: scale(0.58); transform-origin: top left; background: #F2ECE1; color: #121614; font-family: 'Sofia Sans', system-ui, sans-serif; font-size: 16px; line-height: 24px;"
>
  <svg
    style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .03; mix-blend-mode: multiply;"
  >
    <filter id="gB1">
      <feTurbulence
        type="fractalNoise"
        baseFrequency=".85"
        numOctaves="2"
        stitchTiles="stitch"
      ></feTurbulence>
      <feColorMatrix type="saturate" values="0"></feColorMatrix>
    </filter>
    <rect width="100%" height="100%" filter="url(#gB1)" />
  </svg>
  <p
    style="position: absolute; left: 28px; top: 12px; height: 44px; margin: 0; display: flex; align-items: center; font-weight: 600; font-size: 12px; line-height: 16px; letter-spacing: .16em; text-transform: uppercase; color: #7A5C33;"
  >
    Reception
  </p>
  <div
    style="position: absolute; right: 24px; top: 12px; height: 44px; display: flex; align-items: center; font-weight: 600; font-size: 14px; line-height: 20px;"
  >
    <span
      style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: #121614; text-decoration: underline; text-decoration-color: #8A6A3C; text-decoration-thickness: 1px; text-underline-offset: 5px;"
      >EN</span
    >
    <span style="width: 1px; height: 14px; background: #C1BDB4;"></span>
    <span
      lang="bg"
      style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: #4F4B45;"
      >БГ</span
    >
  </div>
  <p
    style="position: absolute; left: 28px; top: 76px; width: 338px; margin: 0; font-family: Playfair, Georgia, serif; font-optical-sizing: auto; font-weight: 500; font-size: 56px; line-height: 58px; letter-spacing: -0.015em; color: #121614;"
  >
    Avela<br />Resort
  </p>
  <div
    style="position: absolute; left: 28px; top: 212px; width: 338px; height: 2px; background: #121614;"
  ></div>
  <div
    style="position: absolute; left: 28px; top: 217px; width: 338px; height: 1px; background: #121614;"
  ></div>
  <p
    style="position: absolute; left: 28px; top: 238px; width: 338px; margin: 0; font-family: Playfair, Georgia, serif; font-optical-sizing: auto; font-weight: 400; font-size: 26px; line-height: 32px; color: #121614;"
  >
    How was your experience?
  </p>
  <div style="position: absolute; left: 28px; top: 290px; display: flex; gap: 8px;">
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#807B72"
        stroke-width="1.2"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#807B72"
        stroke-width="1.2"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#807B72"
        stroke-width="1.2"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#807B72"
        stroke-width="1.2"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
    <span
      style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;"
      ><svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#807B72"
        stroke-width="1.2"
        stroke-linejoin="round"
      >
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
        /></svg
    ></span>
  </div>
  <span
    style="position: absolute; left: 28px; top: 352px; font-size: 13px; line-height: 18px; color: #625D56;"
    >Poor</span
  >
  <span
    style="position: absolute; left: 240px; top: 352px; width: 100px; text-align: right; font-size: 13px; line-height: 18px; color: #625D56;"
    >Excellent</span
  >
  <div
    style="position: absolute; left: 28px; top: 418px; width: 338px; height: 52px; border-radius: 2px; background: #121614; color: #F2ECE1; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 17px; line-height: 20px;"
  >
    Send privately
  </div>
  <p
    style="position: absolute; left: 28px; top: 482px; width: 338px; margin: 0; font-size: 14px; line-height: 20px; color: #4F4B45;"
  >
    Shared privately with Avela Resort.
  </p>
  <div
    style="position: absolute; left: 28px; top: 534px; width: 338px; height: 1px; background: #C1BDB4;"
  ></div>
  <p
    style="position: absolute; left: 28px; top: 550px; width: 338px; margin: 0; font-size: 14px; line-height: 20px; color: #4F4B45;"
  >
    This page counts visits for Avela Resort. No ads or third-party trackers.
  </p>
  <div
    style="position: absolute; left: 28px; top: 594px; width: 338px; height: 44px; display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 14px; line-height: 20px; color: #7A5C33;"
  >
    <span style="text-decoration: underline; text-underline-offset: 3px;"
      >Privacy notice</span
    ><span>Got it</span>
  </div>
  <p
    style="position: absolute; left: 28px; top: 670px; width: 338px; margin: 0; font-size: 18px; line-height: 28px; color: #4F4B45;"
  >
    Stone, olive shade and water that keeps the last of the light. Thank you for spending
    part of your day with us.
  </p>
  <div
    style="position: absolute; left: 28px; top: 806px; width: 338px; height: 2px; background: #121614;"
  ></div>
  <div
    style="position: absolute; left: 28px; top: 811px; width: 338px; height: 1px; background: #121614;"
  ></div>
  <p
    style="position: absolute; left: 28px; top: 824px; margin: 0; font-family: Playfair, Georgia, serif; font-weight: 500; font-size: 20px; line-height: 26px; color: #121614;"
  >
    Avela Resort
  </p>
</div>
```

Its wrapper background is `#F2ECE1`. For The Harbor Hotel's own Folio swap
the values: paper `#F3EEE4`, ink `#1D2528`, text 2 `#4A5356`, text 3
`#5F676A`, accent (stars, kicker, links, underline) `#1F5E78`, idle star
`#7D7F7D`, rules `#CCC3B3`, masthead "The Harbor / Hotel". A selected
Folio star is `fill` and `stroke` in the accent at `stroke-width="1.4"`.

Table Card (C) previews follow `brief-C.json` with the same frame rules; no
reusable block is given here because only ADM08 draws it.
