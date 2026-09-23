# Direction C "Table Card": component reference

The source of truth is `canvas/project/C1-arrival.dc.html`. Copy blocks from this
file exactly. Only the copy, the `checked` state, the stars that are filled and
the ids listed below may change. Every measurement was checked with HarfBuzz
against Sofia Sans (wght 400/600/700) at 342px (plate) or 302px (card inner).

Coordinates are board y values. The x grid runs 24–366 (342px). Everything is
left-aligned. The poster runs 0–280 on every C board and is pixel-identical in
every state.

---

## 0. Page shell (every C board)

Head, helmet and script are identical on every C board (Forma). C5 swaps the
colour values listed in §17. Change only `<title>`, `lang`, the root `height`
and the matching `$preview.height`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Forma Kitchen — Arrival</title>
    <script src="./support.js"></script>
  </head>
  <body>
    <x-dc>
      <helmet>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sofia+Sans+Extra+Condensed:wght@800&family=Sofia+Sans:wght@400;600;700&display=swap"
        />
        <style>
          body {
            margin: 0;
            background: #faf5ec;
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
            color: #b53a26;
          }
          a:hover {
            color: #221a16;
          }
          :focus-visible {
            outline: 2px solid #221a16;
            outline-offset: 3px;
          }
          input[type='radio']:focus-visible + label {
            outline: 2px solid #221a16;
            outline-offset: 2px;
          }
          .c-star .is-idle {
            transition: stroke 150ms ease-out;
          }
          .c-star:hover .is-idle {
            stroke: #221a16;
          }
          .c-star svg {
            transition: transform 100ms ease-out;
          }
          .c-star:active {
            background-color: #f1eadf;
          }
          .c-star:active svg {
            transform: scale(0.94);
          }
          .c-primary {
            transition: background-color 150ms ease-out;
          }
          .c-primary:hover {
            background-color: #b53a26 !important;
          }
          .c-primary:active {
            transform: translateY(1px);
          }
          .c-outline {
            transition: background-color 150ms ease-out;
          }
          .c-outline:hover,
          .c-outline:active {
            background-color: #f1eadf !important;
          }
          .c-quiet:hover {
            color: #b53a26 !important;
          }
          .c-textlink:hover {
            color: #221a16 !important;
          }
          .c-row .c-chev,
          .c-linkrow .c-arrow {
            transition: transform 150ms ease-out;
          }
          .c-row:hover .c-chev {
            transform: translateY(2px);
          }
          .c-linkrow:hover .c-arrow {
            transform: translateX(3px);
          }
          .c-enter {
            animation: c-fade 200ms ease-out both;
          }
          @keyframes c-fade {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
              transition: none !important;
              animation: none !important;
            }
          }
        </style>
      </helmet>
      <main
        style="width:390px;height:844px;box-sizing:border-box;overflow:hidden;position:relative;display:flex;flex-direction:column;background:#FAF5EC;color:#221A16;font-family:'Sofia Sans', system-ui, sans-serif;font-size:16px;line-height:24px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale"
      >
        <!-- POSTER (§1) -->
        <!-- PLATE (§2) holding the board's content -->
      </main>
    </x-dc>
    <script
      type="text/x-dc"
      data-dc-script
      data-props='{"$preview":{"width":390,"height":844}}'
    >
      class Component extends DCLogic {
        renderVals() {
          return {
            hold: function (event) {
              if (event && event.preventDefault) {
                event.preventDefault();
              }
            }
          };
        }
      }
    </script>
  </body>
</html>
```

Rules:

- Keep `width:390px;height:NNNpx` as the first two declarations of the root
  style, because the validator reads them there.
- `hold` is only used as `onSubmit="{{ hold }}"` on a `<form>`, so a submit in
  Play never navigates the sandbox. Boards without a form keep the same script.
- Why the state classes exist: element styling is inline, and inline styles
  beat helmet rules. Hover and active states that must override an inline value
  therefore use `!important` on a `c-*` class. Never add other classes.
  - `c-star`: rating labels.
  - `c-primary`: filled tomato buttons or links.
  - `c-outline`: 1.5px espresso outline buttons.
  - `c-quiet`: the "Got it" text button.
  - `c-textlink`: a `<button>` styled as a tomato link.
  - `c-row` + `c-chev`: the "Your response" disclosure and its chevron.
  - `c-linkrow` + `c-arrow`: useful-link rows and their arrow.
  - `c-enter`: the 200ms plate crossfade, identical for every score (optional
    in static boards).
- Plate text links (`<a>` on the plate) carry NO inline colour; they inherit
  `a{color:#B53A26}` and hover to espresso. Links on the poster, filled
  buttons and link rows DO set an inline colour so `a:hover` can't touch them.
- Never use emoji, arrow characters (↗ → ↓), © or ®. Icons are inline SVG (§16).
- SVG leaf elements (`path`, `rect`, `circle`) may self-close. `feTurbulence`
  and `feColorMatrix` must be written with explicit closing tags, or the
  validator fails them.

### Tokens

| Role                                             | Hex       | Contrast (measured)           |
| ------------------------------------------------ | --------- | ----------------------------- |
| Poster / brand primary                           | `#C8402A` | 4.58 on plate                 |
| On poster                                        | `#FFFFFF` | 4.97 on tomato                |
| Plate                                            | `#FAF5EC` | –                             |
| Card                                             | `#FFFFFF` | –                             |
| Plate field (pressed, textarea)                  | `#F1EADF` | –                             |
| Crease                                           | `#E2D8C9` | decorative                    |
| Hairline                                         | `#E6DDD0` | decorative                    |
| Espresso (text, outline, focus)                  | `#221A16` | 15.75                         |
| Espresso 2 (body, privacy, receipt, description) | `#5A4E47` | 7.39                          |
| Espresso 3 (meta, endpoints, footer)             | `#6E625A` | 5.44 on plate / 5.90 on white |
| Tomato text (links, Change)                      | `#B53A26` | 5.37 on plate / 5.84 on white |
| Idle star                                        | `#837D76` | 3.75 on plate / 4.07 on white |

Type (Sofia Sans unless noted; all `font-family:inherit` on buttons and inputs):

| Use                  | Spec                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| h1 place line        | 700 12/16, `letter-spacing:.14em`, `text-transform:uppercase`                                            |
| Wordmark             | Extra Condensed 800 96/84, `letter-spacing:-0.005em`                                                     |
| Question, Thank you. | 700 28/32, `letter-spacing:-0.01em`                                                                      |
| Caption word         | Extra Condensed 800 30/32                                                                                |
| Google title         | 700 21/26, `letter-spacing:-0.01em` (EN measures 299.8px in a 302px column, so the tracking is required) |
| Private title        | 700 19/24, `letter-spacing:-0.005em`                                                                     |
| Body / card body     | 400 16/24                                                                                                |
| Description          | 400 17/25                                                                                                |
| Submit               | 700 18/22. Card buttons are 700 17/22 (Google) and 700 16/20 (outline)                                   |
| Link row label       | 600 17/22                                                                                                |
| Privacy line         | 400 14/20. The receipt is 400 15/20                                                                      |
| Analytics text       | 400 13/19                                                                                                |
| Endpoints            | 600 13/18                                                                                                |
| Meta / subline       | 400 13/18                                                                                                |
| Footer               | link 600 13/20, credit 400 12/16                                                                         |

---

## 1. Poster: header 0–280 (identical on every C board)

```html
<header
  style="position:relative;flex:none;box-sizing:border-box;height:280px;display:flex;flex-direction:column;gap:20px;padding-top:12px;overflow:hidden;background:#C8402A;color:#FFFFFF"
>
  <svg
    aria-hidden="true"
    style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.05;mix-blend-mode:multiply"
  >
    <filter id="grain-poster">
      <feTurbulence
        type="fractalNoise"
        baseFrequency=".85"
        numOctaves="2"
        stitchTiles="stitch"
      ></feTurbulence>
      <feColorMatrix type="saturate" values="0"></feColorMatrix>
    </filter>
    <rect width="100%" height="100%" filter="url(#grain-poster)" />
  </svg>

  <div
    style="position:relative;display:flex;align-items:center;justify-content:space-between;height:44px;padding:0 10px 0 24px"
  >
    <h1
      style="margin:0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#FFFFFF"
    >
      Dining room
    </h1>
    <nav aria-label="Language" style="display:flex;align-items:center">
      <a
        href="#"
        hreflang="en"
        aria-current="true"
        style="display:block;width:44px;height:44px;line-height:44px;text-align:center;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px;border-radius:4px;outline-color:#FFFFFF"
        >EN<span class="sr-only"> English</span></a
      >
      <span
        aria-hidden="true"
        style="display:block;width:1px;height:14px;background:rgba(255,255,255,.4)"
      ></span>
      <a
        href="#"
        hreflang="bg"
        lang="bg"
        style="display:block;width:44px;height:44px;line-height:44px;text-align:center;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:4px;outline-color:#FFFFFF"
        >БГ<span class="sr-only"> Български</span></a
      >
    </nav>
  </div>

  <p
    style="position:relative;margin:0;padding:0 24px 0 21px;font-family:'Sofia Sans Extra Condensed', 'Sofia Sans', system-ui, sans-serif;font-size:96px;line-height:84px;font-weight:800;letter-spacing:-0.005em;color:#FFFFFF"
  >
    <span style="display:block">Forma</span> <span style="display:block">Kitchen</span>
  </p>

  <span
    aria-hidden="true"
    style="position:absolute;left:0;right:0;bottom:0;height:1px;background:rgba(0,0,0,.14)"
  ></span>
</header>
```

Geometry:

- Top row 12–56. The h1 text box sits at 26–42 at x24.
- The nav's hit boxes run 291–379. The right padding is 10, not 24, so the
  БГ glyphs end at about x366 on the gutter.
- The wordmark runs 76–244, two lines of 84. Caps run from about 84 to 147;
  the second baseline is about 231.
- The edge line is at 279.

Optical offsets:

- The wordmark box starts at x21, not x24. The Extra Condensed 800 stem of a
  straight-sided initial (F, H, K, В, Б) then lands on the same visual edge as
  the h1 and the question (about x26).
- Use `padding-left:24px` when the name starts with a diagonal or round letter
  (Х, A, V, O, C), which has no side bearing to cancel.

Poster links:

- `outline-color` is set inline on purpose. The helmet `:focus-visible` rule
  supplies the style and width, and the inline value makes the ring white on
  the poster.
- On a БГ board, move `aria-current="true"` and the underline declarations
  (`text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px`)
  to the БГ link. EN gets `text-decoration:none`.
- Keep `lang="bg"` on the БГ link in every language. On a lang="bg" board, add
  `lang="en"` to the EN link.

The poster never changes with state or score. Never animate it.

---

## 2. Plate and fold

The plate is the second child of `<main>`: a flex column (`flex:1 1 auto`)
whose first three children are absolutely positioned. Grain comes first, then
the crease (y280) and the fold shade (281–297). Content wrappers after them
carry `position:relative` so they paint above the grain.

```html
<div
  style="position:relative;flex:1 1 auto;display:flex;flex-direction:column;gap:32px;padding:32px 24px 0;background:#FAF5EC"
>
  <svg
    aria-hidden="true"
    style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.03;mix-blend-mode:multiply"
  >
    <filter id="grain-plate">
      <feTurbulence
        type="fractalNoise"
        baseFrequency=".85"
        numOctaves="2"
        stitchTiles="stitch"
      ></feTurbulence>
      <feColorMatrix type="saturate" values="0"></feColorMatrix>
    </filter>
    <rect width="100%" height="100%" filter="url(#grain-plate)" />
  </svg>
  <span
    aria-hidden="true"
    style="position:absolute;left:0;right:0;top:0;height:1px;background:#E2D8C9"
  ></span>
  <span
    aria-hidden="true"
    style="position:absolute;left:0;right:0;top:1px;height:16px;background:linear-gradient(180deg, rgba(34,26,22,.08), rgba(34,26,22,0));pointer-events:none"
  ></span>
  <!-- content groups, each with position:relative -->
</div>
```

The first content line is always at 312 (plate padding-top 32). The `gap` value
changes per board (§18). There is no radius, no overlap and no shadow.

---

## 3. Rating core (arrival boards), form 312–588

```html
<form
  onSubmit="{{ hold }}"
  style="position:relative;display:flex;flex-direction:column;gap:16px"
>
  <fieldset style="margin:0;padding:0;border:0;min-width:0">
    <legend
      style="display:block;width:100%;margin:0;padding:0;font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.01em;color:#221A16"
    >
      How was your experience?
    </legend>
    <div style="display:flex;flex-direction:column;gap:6px;padding-top:20px">
      <div style="display:flex;gap:10px">
        <!-- 5 × (input + label), §3a -->
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div
          aria-hidden="true"
          style="display:flex;justify-content:space-between;width:320px;font-size:13px;line-height:18px;font-weight:600;color:#6E625A"
        >
          <span>Poor</span><span>Excellent</span>
        </div>
        <div style="display:flex;align-items:center;height:32px">
          <!-- caption slot content, §3b -->
          <p
            role="alert"
            style="margin:0;display:flex;align-items:center;gap:8px;font-size:15px;line-height:20px;font-weight:700;color:#221A16"
          ></p>
        </div>
      </div>
    </div>
  </fieldset>

  <div style="display:flex;flex-direction:column;gap:12px">
    <!-- submit, §4 -->
    <!-- privacy line, §5 -->
  </div>
</form>
```

EN layout:

| Element      | y       |
| ------------ | ------- |
| Legend       | 312–344 |
| Stars        | 364–420 |
| Endpoints    | 426–444 |
| Caption slot | 452–484 |
| Submit       | 500–556 |
| Privacy line | 568–588 |

On BG the legend is two lines (312–376) and everything below moves +32.

### 3a. Star (repeat for n = 1..5)

The sr texts are '1 star, Poor', '2 stars, Fair', '3 stars, Good',
'4 stars, Very good' and '5 stars, Excellent'. The labels run x24–344 (5×56
plus 4×10). Each input immediately precedes its label.

Idle:

```html
<input type="radio" name="rating" value="1" id="r1" class="sr-only" />
<label
  for="r1"
  class="c-star"
  style="flex:none;display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:6px;cursor:pointer"
  ><svg
    aria-hidden="true"
    width="42"
    height="42"
    viewBox="0 0 24 24"
    style="display:block"
  >
    <path
      class="is-idle"
      d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
      fill="none"
      stroke="#837D76"
      stroke-width="1.3"
      stroke-linejoin="round"
    /></svg
  ><span class="sr-only">1 star, Poor</span></label
>
```

Selected state for rating n:

- Add `checked` to input n only.
- Stars 1..n replace the path with the one below. Remove `class="is-idle"`, so
  hover never recolours a chosen star. The heavier stroke, 1.7 against 1.3, is
  the non-hue cue.
  ```html
  <path
    d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
    fill="#C8402A"
    stroke="#C8402A"
    stroke-width="1.7"
    stroke-linejoin="round"
  />
  ```
- Stars n+1..5 stay idle.

### 3b. Caption slot (always 32px, always present)

- **Empty (arrival):** only the empty `<p role="alert" …></p>` shown above.
- **Chosen:** put this before the empty alert paragraph:
  ```html
  <p
    aria-hidden="true"
    style="margin:0;font-family:'Sofia Sans Extra Condensed', 'Sofia Sans', system-ui, sans-serif;font-size:30px;line-height:32px;font-weight:800;color:#C8402A"
  >
    Very good
  </p>
  ```
- **Error:** no caption word, stars idle, and the alert paragraph filled. It
  is never red.
  ```html
  <p
    role="alert"
    style="margin:0;display:flex;align-items:center;gap:8px;font-size:15px;line-height:20px;font-weight:700;color:#221A16"
  >
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#221A16"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="flex:none;display:block"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" /></svg
    >Choose a rating from 1 to 5 stars.
  </p>
  ```

---

## 4. Submit button, 500–556 (342×56)

```html
<button
  type="submit"
  class="c-primary"
  aria-describedby="c1-privacy"
  style="box-sizing:border-box;width:342px;height:56px;padding:0 20px;border:0;border-radius:6px;background:#C8402A;color:#FFFFFF;font-family:inherit;font-size:18px;line-height:22px;font-weight:700;cursor:pointer"
>
  Send privately
</button>
```

- **Pending:** the same button with the text `Sending…`. It stays enabled,
  with no spinner.
- **Save failed:** insert this directly after the button, inside the same
  gap-12 column and before the privacy line:
  ```html
  <div role="alert" style="display:flex;flex-direction:column;gap:8px">
    <p
      style="margin:0;display:flex;align-items:flex-start;gap:8px;font-size:15px;line-height:20px;font-weight:700;color:#221A16"
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#221A16"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="flex:none;display:block;margin-top:1px"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" /></svg
      >Your rating wasn’t sent. Check your connection and try again.
    </p>
    <button
      type="button"
      class="c-outline"
      style="box-sizing:border-box;align-self:flex-start;height:44px;padding:0 16px;border:1.5px solid #221A16;border-radius:6px;background:transparent;color:#221A16;font-family:inherit;font-size:15px;line-height:20px;font-weight:700;cursor:pointer"
    >
      Try again
    </button>
  </div>
  ```
- **Ochre (C5):** see §17.

---

## 5. Privacy line, 568–588

The 16px lock and the 6px gap put the text at x46. The lock's body lands at
about x27, on the visual edge.

```html
<p
  id="c1-privacy"
  style="margin:0;display:flex;align-items:center;gap:6px;font-size:14px;line-height:20px;color:#5A4E47"
>
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#5A4E47"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="flex:none;display:block"
  >
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg
  >Shared privately with Forma Kitchen.
</p>
```

Give the paragraph a board-unique id and point the submit's
`aria-describedby` at it.

---

## 6. Analytics region, 620–720 (arrival boards only)

The hairline is at 620 and the text at 636–674 (EN measures 2 lines). The
action row runs 676–720. The row's `margin-right:-12px` lets the "Got it" hit
box run to x378 while its glyphs end on the x366 gutter.

```html
<section
  aria-label="Portal analytics information"
  style="display:flex;flex-direction:column;gap:2px;padding-top:15px;border-top:1px solid #E6DDD0"
>
  <p style="margin:0;font-size:13px;line-height:19px;color:#6E625A">
    This page counts visits for Forma Kitchen. No ads or third-party trackers.
  </p>
  <div
    style="display:flex;align-items:center;justify-content:space-between;height:44px;margin-right:-12px"
  >
    <a
      href="#"
      style="display:inline-block;padding:12px 0;font-size:14px;line-height:20px;font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px"
      >Privacy notice</a
    >
    <button
      type="button"
      class="c-quiet"
      style="height:44px;min-width:44px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:#221A16;font-family:inherit;font-size:14px;line-height:20px;font-weight:700;cursor:pointer"
    >
      Got it
    </button>
  </div>
</section>
```

After-rating boards omit it (assumed dismissed).

---

## 7. Description, max 3 lines

```html
<p style="margin:0;font-size:17px;line-height:25px;color:#5A4E47">
  Fresh pasta, a wood fire and small-producer wine. Thanks for eating with us.
</p>
```

EN measures 2 lines (50px).

---

## 8. Receipt block, 312–400 (after-rating boards)

- `Thank you.` runs 312–344, then a 12px gap, then the row at 356–400.
- The status paragraph is `sr-only` (absolute), so it takes no flex space.
- Mini stars run x24–112; the text starts at x122. `Change` is pushed to the
  gutter, with its glyphs ending at x366.

```html
<section
  aria-labelledby="c-thanks"
  style="position:relative;display:flex;flex-direction:column;gap:12px"
>
  <h2
    id="c-thanks"
    tabindex="-1"
    style="margin:0;font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.01em;color:#221A16"
  >
    Thank you.
  </h2>
  <p role="status" class="sr-only">Rating sent privately</p>
  <div style="display:flex;align-items:center;gap:10px;height:44px">
    <span aria-hidden="true" style="flex:none;display:flex;gap:2px">
      <!-- 5 mini stars: filled for 1..n, idle for n+1..5 -->
      <svg width="16" height="16" viewBox="0 0 24 24" style="display:block">
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
          fill="#C8402A"
          stroke="#C8402A"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
      <svg width="16" height="16" viewBox="0 0 24 24" style="display:block">
        <path
          d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
          fill="none"
          stroke="#837D76"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <p
      style="flex:1 1 auto;min-width:0;margin:0;font-size:15px;line-height:20px;color:#5A4E47"
    >
      Fair · sent privately
    </p>
    <button
      type="button"
      class="c-textlink"
      style="flex:none;height:44px;padding:0;border:0;background:transparent;color:#B53A26;font-family:inherit;font-size:15px;line-height:20px;font-weight:700;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer"
    >
      Change<span class="sr-only"> your rating</span>
    </button>
  </div>
</section>
```

The word is Fair (2), Good (3) or Excellent (5). Never print the time.

---

## 9. Google card, 424–644 (identical in C2, C3 and C4; no score input)

- The card is 342 wide, with a 1px border plus 19px padding, which gives a
  302px inner column (x44–346).
- Title 444–470; body 478–526 (EN 2 lines); button 546–598; subline 606–624.

```html
<section
  aria-labelledby="c-google"
  style="position:relative;box-sizing:border-box;display:flex;flex-direction:column;gap:20px;padding:19px;border:1px solid #E6DDD0;border-radius:8px;background:#FFFFFF"
>
  <div style="display:flex;flex-direction:column;gap:8px">
    <h2
      id="c-google"
      style="margin:0;font-size:21px;line-height:26px;font-weight:700;letter-spacing:-0.01em;color:#221A16"
    >
      Share your experience on Google
    </h2>
    <p style="margin:0;font-size:16px;line-height:24px;color:#5A4E47">
      If you’d like, you can also leave a public review on Google.
    </p>
  </div>
  <div style="display:flex;flex-direction:column;gap:8px">
    <a
      href="#"
      class="c-primary"
      style="box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;width:302px;height:52px;padding:0 20px;border-radius:6px;background:#C8402A;color:#FFFFFF;font-size:17px;line-height:22px;font-weight:700;text-decoration:none"
      >Continue to Google<span class="sr-only"> (opens Google)</span
      ><svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#FFFFFF"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="flex:none;display:block"
      >
        <path d="M7 17L17 7M9 7h8v8" /></svg
    ></a>
    <p style="margin:0;font-size:13px;line-height:18px;color:#6E625A">
      Opens Google · you may need to sign in
    </p>
  </div>
</section>
```

- Never add stars, a logo, a count or score-dependent styling.
- If it enters with motion, use `class="c-enter"` on the section. It is
  identical for every score.

### 9b. Degraded Google card (same slot, same chrome, no link, no button)

EN measures a 2-line title (52) and a 2-line body (48), so the card is 424–572.

```html
<section
  aria-labelledby="c-google"
  role="status"
  style="position:relative;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:19px;border:1px solid #E6DDD0;border-radius:8px;background:#FFFFFF"
>
  <h2
    id="c-google"
    style="margin:0;font-size:21px;line-height:26px;font-weight:700;letter-spacing:-0.01em;color:#221A16"
  >
    Google can’t be opened from here right now
  </h2>
  <p style="margin:0;font-size:16px;line-height:24px;color:#5A4E47">
    Your rating reached Forma Kitchen privately. Thank you.
  </p>
</section>
```

---

## 10. Private-note card, 660–840 (rating 3 or lower only; after Google; outline only)

- Transparent background, 1px border, 19px padding, 302px inner column.
- Title 680–704; body 712–756 (two deliberate lines); button 772–820.
- The body's line break is typographic (two statements); the copy is
  unchanged.

```html
<section
  aria-labelledby="c-note"
  style="position:relative;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:19px;border:1px solid #E6DDD0;border-radius:8px;background:transparent"
>
  <div style="display:flex;flex-direction:column;gap:8px">
    <h2
      id="c-note"
      style="margin:0;font-size:19px;line-height:24px;font-weight:700;letter-spacing:-0.005em;color:#221A16"
    >
      Add a private note for the team
    </h2>
    <p style="margin:0;font-size:15px;line-height:22px;color:#5A4E47">
      <span style="display:block">Optional.</span>
      <span style="display:block">Shared privately with Forma Kitchen.</span>
    </p>
  </div>
  <button
    type="button"
    class="c-outline"
    aria-expanded="false"
    style="box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;padding:0 16px;border:1.5px solid #221A16;border-radius:6px;background:transparent;color:#221A16;font-family:inherit;font-size:16px;line-height:20px;font-weight:700;cursor:pointer"
  >
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#221A16"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="flex:none;display:block"
    >
      <path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg
    >Write a private note
  </button>
</section>
```

### 10b. Note composer (the expanded card; the button is replaced)

- The card's top group is unchanged; the composer takes the button's place.
- Composer: label 20, gap 8, textarea 120, gap 8, helper row 18, gap 16,
  Send 48, gap 4, Not now 44. That is 286px, so the card runs about 660–1078.
- BG 'Изпрати бележката поверително' measures 255px, so the buttons stay
  stacked in both languages.

```html
<form onSubmit="{{ hold }}" style="display:flex;flex-direction:column;gap:8px">
  <label
    for="c-note-text"
    style="font-size:15px;line-height:20px;font-weight:700;color:#221A16"
    >Your note (optional)</label
  >
  <textarea
    id="c-note-text"
    name="note"
    rows="4"
    maxlength="2000"
    placeholder="What should the team know?"
    aria-describedby="c-note-help"
    style="box-sizing:border-box;display:block;width:100%;height:120px;padding:10px 14px;border:1.5px solid #837D76;border-radius:6px;background:#F1EADF;color:#221A16;font-family:inherit;font-size:16px;line-height:24px;resize:vertical"
  ></textarea>
  <div
    style="display:flex;justify-content:space-between;gap:12px;font-size:13px;line-height:18px;color:#6E625A"
  >
    <p id="c-note-help" style="margin:0">No need to include your name.</p>
    <p aria-live="polite" style="margin:0;font-variant-numeric:tabular-nums"></p>
  </div>
  <div style="display:flex;flex-direction:column;gap:4px;padding-top:8px">
    <button
      type="submit"
      class="c-outline"
      style="box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:48px;padding:0 16px;border:1.5px solid #221A16;border-radius:6px;background:transparent;color:#221A16;font-family:inherit;font-size:16px;line-height:20px;font-weight:700;cursor:pointer"
    >
      Send note privately
    </button>
    <button
      type="button"
      class="c-quiet"
      style="align-self:flex-start;height:44px;padding:0;border:0;background:transparent;color:#221A16;font-family:inherit;font-size:15px;line-height:20px;font-weight:700;cursor:pointer"
    >
      Not now
    </button>
  </div>
</form>
```

- While the composer shows, the card's pencil button is gone. If a toggle
  stays visible, it carries `aria-expanded="true"`.
- The counter paragraph is empty until 1,800 characters. It then reads
  `200 characters left`.
- Placeholder #6E625A on #F1EADF is 4.94:1. The textarea boundary #837D76 is
  3.75:1 against the plate.

### 10c. Note-sent line, 660–716 (replaces the private card after sending)

```html
<div
  role="status"
  style="position:relative;display:flex;align-items:center;gap:10px;padding:17px 0 16px;border-bottom:1px solid #E6DDD0"
>
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#C8402A"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="flex:none;display:block"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
  <p style="margin:0;font-size:15px;line-height:22px;color:#221A16">
    Your note was sent privately to Forma Kitchen.
  </p>
</div>
```

It measures 297.9px plus 28 for the icon and gap: one line within 342.

---

## 11. "Your response"

### 11a. Collapsed: one 56px row (hairlines top and bottom), the whole row is the button

```html
<h2 style="position:relative;margin:0">
  <button
    type="button"
    class="c-row"
    aria-expanded="false"
    aria-controls="c-yr-panel"
    style="box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;height:56px;padding:0;border:0;border-top:1px solid #E6DDD0;border-bottom:1px solid #E6DDD0;background:transparent;color:#221A16;text-align:left;font-family:inherit;cursor:pointer"
  >
    <span style="display:flex;flex-direction:column">
      <span style="font-size:16px;line-height:20px;font-weight:700;color:#221A16"
        >Your response</span
      >
      <span style="font-size:14px;line-height:18px;font-weight:400;color:#6E625A"
        >Change, remove or start over</span
      >
    </span>
    <svg
      class="c-chev"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#C8402A"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="flex:none;display:block"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>
</h2>
```

### 11b. Expanded: a white card (C4: 740–1168)

- Header 740–796: the 1px card border plus a 55px button.
- Rows: 796–868 (72), 868–940 (72), 940–1028 (88) and 1028–1168 (139 plus
  the 1px card border).
- Right buttons are a fixed 96×44, so the text column is 200px. The Remove
  meta measures 2 lines at 200px (195.8 and 177.3).
- Expanded keeps the same two-line label, with the chevron pointing up and no
  `c-chev` class.

```html
<section
  style="position:relative;box-sizing:border-box;border:1px solid #E6DDD0;border-radius:8px;background:#FFFFFF;overflow:hidden"
>
  <h2 style="margin:0">
    <button
      type="button"
      aria-expanded="true"
      aria-controls="c-yr-panel"
      style="box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;height:55px;padding:0 16px;border:0;background:transparent;color:#221A16;text-align:left;font-family:inherit;cursor:pointer"
    >
      <span style="display:flex;flex-direction:column">
        <span style="font-size:16px;line-height:20px;font-weight:700;color:#221A16"
          >Your response</span
        >
        <span style="font-size:14px;line-height:18px;font-weight:400;color:#6E625A"
          >Change, remove or start over</span
        >
      </span>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#C8402A"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="flex:none;display:block"
      >
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  </h2>
  <div id="c-yr-panel">
    <!-- action row: height 72 (or 88 for the two-line meta) -->
    <div
      style="box-sizing:border-box;display:flex;align-items:center;gap:12px;height:72px;padding:0 16px;border-top:1px solid #E6DDD0"
    >
      <div style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px">
        <p style="margin:0;font-size:15px;line-height:20px;font-weight:700;color:#221A16">
          Change your rating
        </p>
        <p style="margin:0;font-size:13px;line-height:18px;color:#6E625A">
          Until 15:32 today, Sofia time
        </p>
      </div>
      <button
        type="button"
        class="c-outline"
        style="box-sizing:border-box;flex:none;width:96px;height:44px;padding:0;border:1.5px solid #221A16;border-radius:6px;background:transparent;color:#221A16;font-family:inherit;font-size:15px;line-height:20px;font-weight:700;cursor:pointer"
      >
        Change<span class="sr-only"> your rating</span>
      </button>
    </div>
    <!-- row 2: 'Remove your note' / 'Until 14:32 tomorrow' / Remove<span class="sr-only"> your note</span> (height 72) -->
    <!-- row 3: 'Remove your rating and note' / 'Until 14:32 tomorrow. Anything you posted on Google isn’t affected.' / Remove<span class="sr-only"> your rating and note</span>… (height 88) -->
    <div
      style="box-sizing:border-box;display:flex;flex-direction:column;gap:20px;height:139px;padding:15px 16px;border-top:1px solid #E6DDD0"
    >
      <div style="display:flex;flex-direction:column;gap:2px">
        <p style="margin:0;font-size:15px;line-height:20px;font-weight:700;color:#221A16">
          Shared phone or tablet?
        </p>
        <p style="margin:0;font-size:13px;line-height:18px;color:#6E625A">
          Start over so the next guest begins with a fresh page.
        </p>
      </div>
      <button
        type="button"
        class="c-outline"
        style="box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;padding:0 16px;border:1.5px solid #221A16;border-radius:6px;background:transparent;color:#221A16;font-family:inherit;font-size:16px;line-height:20px;font-weight:700;cursor:pointer"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#221A16"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="flex:none;display:block"
        >
          <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg
        >Start over on this device
      </button>
    </div>
  </div>
</section>
```

Row 3's button text is written `Remove<span class="sr-only"> your rating and note</span>…`,
so the visible label is "Remove…" and the accessible name is
"Remove your rating and note…".

**Inline confirm** (not drawn in C; the two-step replacement of row 3's
content). The destructive action is espresso, never red:

```html
<div
  role="group"
  aria-labelledby="c-yr-confirm"
  style="box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;border-top:1px solid #E6DDD0;background:#FAF5EC"
>
  <p id="c-yr-confirm" style="margin:0;font-size:15px;line-height:22px;color:#221A16">
    Remove both? Forma Kitchen will no longer see your rating or note. Anything you posted
    on Google isn’t affected.
  </p>
  <div style="display:flex;flex-direction:column;gap:8px">
    <button
      type="button"
      style="box-sizing:border-box;width:100%;height:48px;border:0;border-radius:6px;background:#221A16;color:#FFFFFF;font-family:inherit;font-size:16px;line-height:20px;font-weight:700;cursor:pointer"
    >
      Remove rating and note
    </button>
    <button
      type="button"
      class="c-outline"
      style="box-sizing:border-box;width:100%;height:48px;border:1.5px solid #221A16;border-radius:6px;background:transparent;color:#221A16;font-family:inherit;font-size:16px;line-height:20px;font-weight:700;cursor:pointer"
    >
      Keep them
    </button>
  </div>
</div>
```

**Start-over done** (replaces the start-over button):

```html
<p
  role="status"
  style="margin:0;display:flex;align-items:center;gap:10px;font-size:15px;line-height:22px;color:#221A16"
>
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#C8402A"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="flex:none;display:block"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" /></svg
  >This device is ready for the next guest.
</p>
```

---

## 12. Useful links (C3 after rating; C6 proposal from arrival)

- The label is 16px, then an 8px gap, then 4 rows × 60 = 240.
- Icon at x24; the label at x60 (24 + 24 + 12 gap); the 20px arrow ends at
  x366.
- There are no sublines, no `tel:` links and at most 4 rows.

```html
<nav
  aria-labelledby="c-links"
  style="position:relative;display:flex;flex-direction:column;gap:8px"
>
  <h2
    id="c-links"
    style="margin:0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6E625A"
  >
    Also useful
  </h2>
  <ul
    role="list"
    style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column"
  >
    <li>
      <a
        href="#"
        class="c-linkrow"
        style="box-sizing:border-box;display:flex;align-items:center;gap:12px;height:60px;border-bottom:1px solid #E6DDD0;color:#221A16;text-decoration:none;font-size:17px;line-height:22px;font-weight:600"
        ><svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#221A16"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="flex:none;display:block"
        >
          <path
            d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"
          /></svg
        ><span style="flex:1 1 auto">Menu</span
        ><svg
          class="c-arrow"
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#C8402A"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="flex:none;display:block"
        >
          <path d="M5 12h14M13 6l6 6-6 6" /></svg
      ></a>
    </li>
    <!-- Book a table: calendar icon; Directions: map pin; Photos from the kitchen: camera (§16) -->
  </ul>
</nav>
```

---

## 13. Footer

The hairline spans the gutter (x24–366). The row is 44 tall: `Privacy notice`
on the left, and the credit ends at x366.

Variant F0 (C1, C6): the hairline is drawn on the top edge of the 44px row,
so the row's y equals the hairline's y (C1: 800–844).

```html
<footer
  style="position:relative;display:flex;align-items:center;justify-content:space-between;height:44px"
>
  <span
    aria-hidden="true"
    style="position:absolute;left:0;right:0;top:0;height:1px;background:#E6DDD0"
  ></span>
  <a
    href="#"
    style="position:relative;display:inline-block;padding:12px 0;font-size:13px;line-height:20px;font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px"
    >Privacy notice</a
  >
  <p style="position:relative;margin:0;font-size:12px;line-height:16px;color:#6E625A">
    Made with Reputation Key
  </p>
</footer>
```

Variant F8 (C3: hairline 1134, row 1142–1186): the same children, without
the absolute hairline span, on:

```html
<footer
  style="position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;height:52px;padding-top:7px;border-top:1px solid #E6DDD0"
></footer>
```

---

## 14. Focus, sr-only and states (already in the §0 helmet)

- Plate focus: 2px #221A16 ring, offset 3. Radios ring their label at offset 2.
- Poster focus: the same ring, recoloured by the inline `outline-color:#FFFFFF`.
- Text inputs always match `:focus-visible`, so the textarea gets the
  espresso ring.
- Hover and press:
  - Idle stars hover to #221A16 and press to scale(.94) on #F1EADF.
  - The primary hovers to #B53A26 and presses to translateY(1px).
  - Outline buttons hover and press to #F1EADF.
  - Link-row arrows nudge 3px; the "Your response" chevron nudges 2px.
- Under reduced motion, every transition and animation is off.

## 15. Grain

- Poster: opacity .05, multiply, filter id `grain-poster`.
- Plate: opacity .03, multiply, filter id `grain-plate`.
- Each is the first child of its layer. Filter ids must be unique per board;
  never reuse `g`.

## 16. Icon library

Base attributes:
`aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="COLOUR" stroke-linecap="round" stroke-linejoin="round" style="flex:none;display:block"`

Stroke weight:

- At 24px, `stroke-width="1.5"` (link-row icons).
- At 16–20px, `stroke-width="2"`, which renders about 1.3–1.7px and matches
  the weight of the bold labels beside it.

Icons:

- External arrow `<path d="M7 17L17 7M9 7h8v8"/>`
- Arrow right `<path d="M5 12h14M13 6l6 6-6 6"/>`
- Chevron down `<path d="M6 9l6 6 6-6"/>`
- Chevron up `<path d="M6 15l6-6 6 6"/>`
- Lock `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`
- Pencil `<path d="M4 20h4L19 9l-4-4L4 16v4z"/>`
- Info / alert `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`
- Check `<path d="M5 12.5l4.5 4.5L19 7.5"/>`
- Rotate-left `<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>`
- Book (Menu) `<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>`
- Calendar (Book a table) `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`
- Map pin (Directions) `<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>`
- Camera (Photos from the kitchen) `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7l1.5-2.5h3L15 7"/><circle cx="12" cy="13.5" r="3.5"/>`

---

## 17. C5 flex (Хотел Вардела, ochre, lang="bg")

These are colour and copy swaps only; the structure is identical.

Helmet: replace these values in the §0 block.

| Rule                                 | C5 value                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `body` background                    | `#F7F4EE`                                                                     |
| `a`                                  | `#835A08`                                                                     |
| `a:hover`                            | `#1C1A17`                                                                     |
| Both focus rules                     | `#1C1A17`                                                                     |
| `.c-star:hover .is-idle`             | `stroke:#1C1A17`                                                              |
| `.c-star:active`                     | `background-color:#EEEAE2`                                                    |
| `.c-primary:hover`                   | `background-color:#D89C17 !important` (ochre −0.03 OKLab L; ink label 7.18:1) |
| `.c-outline:hover,.c-outline:active` | `#EEEAE2`                                                                     |
| `.c-quiet:hover`                     | `#835A08`                                                                     |
| `.c-textlink:hover`                  | `#1C1A17`                                                                     |

Root: `background:#F7F4EE;color:#1C1A17`.

Poster:

- Background `#E2A529`; every `#FFFFFF` becomes `#1C1A17`, including the
  links' `outline-color`.
- The divider is `rgba(28,26,23,.4)`; grain .05 multiply; edge line unchanged.
- h1 `Лоби бар` (uppercased by CSS).
- БГ is current and carries the 2px underline; EN gets `lang="en"`.
- Wordmark `<span style="display:block">Хотел</span> <span style="display:block">Вардела</span>`
  with `padding:0 24px`. There is no optical offset, because Х has almost no
  side bearing. Check that no line exceeds 342px. If one does, step the size
  down (auto-fit) and keep line-height at 0.875em.

Plate:

- Plate `#F7F4EE`.
- Ink `#1C1A17`, ink 2 `#55504A`, ink 3 `#69635C`, idle star `#7F7C78`.

Rating:

- Legend: `Как беше<br>преживяването ви?`. A forced break is needed: greedy
  wrapping leaves 'ви?' alone, because 'Как беше преживяването' measures
  328px.
- Stars: all 5 selected, fill and stroke `#9A6A0C`, stroke-width 1.7;
  `checked` on r5. The sr texts are '1 звезда, Слабо', '2 звезди,
  Задоволително', '3 звезди, Добро', '4 звезди, Много добро' and
  '5 звезди, Отлично'.
- Endpoints `Слабо` / `Отлично`.
- Caption `Отлично` in `#9A6A0C`.

Submit:

```html
<button
  type="submit"
  class="c-primary"
  aria-describedby="c5-privacy"
  style="box-sizing:border-box;width:342px;height:56px;padding:0 20px;border:1.5px solid #9A6A0C;border-radius:6px;background:#E2A529;color:#1C1A17;font-family:inherit;font-size:18px;line-height:22px;font-weight:700;cursor:pointer"
>
  Изпрати поверително
</button>
```

Privacy: `Споделя се поверително с Хотел Вардела.` in `#55504A`, with a lock
in `#55504A`. It measures one line.

Analytics:

- The Bulgarian text measures 2 lines (668–706).
- Keep the spec's action row at 726–770 by giving the text paragraph
  `min-height:57px` (three reserved lines) and the section `gap:1px`.
- `Поверителност` is the link; `Разбрах` is the button.
- The plate's second group uses `gap:20px`, which puts the description at
  790–840 (measured 2 lines).

---

## 18. Board recipes (plate gaps that land on the brief's y values)

All boards: plate `padding:32px 24px 0`.

**C1** (844):

| Plate child        | y       |
| ------------------ | ------- |
| form               | 312–588 |
| group: analytics   | 620–720 |
| group: description | 744–794 |
| group: footer F0   | 800–844 |

- Plate `gap:32px` between the form and the group.
- The group is `display:flex;flex-direction:column;gap:24px` of [analytics]
  and [description + footer, `gap:6px`].

**C6** (1190): plate `gap:32px`.

| Plate child                              | y         |
| ---------------------------------------- | --------- |
| form                                     | 312–588   |
| analytics                                | 620–720   |
| links nav (label 752–768, rows 776–1016) | 752–1016  |
| description                              | 1048–1098 |
| footer F0                                | 1130–1174 |

**After-rating boards** (C2, C3, C4):

- The plate is `gap:24px` of [receipt §8], [Google group] and [tail group].
- The Google group is `display:flex;flex-direction:column;gap:16px`, holding
  [Google §9] plus [private §10 or note-sent §10c].
- The tail group is `display:flex;flex-direction:column;gap:32px`.

| Board     | Tail group contents and y                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| C2 (950)  | Google 424–644; private 660–840; tail = [YR collapsed 864–920] [description 952 onward, clipped by the board edge] |
| C3 (1200) | Google 424–644; tail = [YR collapsed 668–724] [description 756–806] [links 838–1102] [footer F8 1134–1186]         |
| C4 (1270) | Google 424–644; note-sent 660–716; tail = [YR expanded 740–1168] [description 1200–1250]                           |

**C5** (844):

| Plate child        | y       |
| ------------------ | ------- |
| form               | 312–620 |
| group: analytics   | 652–770 |
| group: description | 790–840 |

- Plate `gap:32px`; the group is `gap:20px`, with no footer.
- In the form, the legend is 312–376, stars 396–452, endpoints 458–476,
  caption 484–516, submit 532–588 and privacy 600–620.

Ids must be unique per board. Use c-thanks, c-google, c-note, c-note-text,
c-note-help, c-yr-panel, c-yr-confirm, c-links, grain-poster, grain-plate,
r1–r5, and a board-prefixed privacy id (c1-privacy, c5-privacy, c6-privacy).
