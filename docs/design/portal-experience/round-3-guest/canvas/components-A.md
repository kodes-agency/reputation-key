# Carved Stillness (A): component reference

Source of truth: `canvas/project/A1-arrival.dc.html` (validated). Every snippet below is written in
the same form as A1, so boards A2 to A6 can be assembled from it and match A1 to the pixel. Copy
snippets as written. Change only the copy the brief gives, the rating count, and (for A5) colours
using the thermal map in section 2.

Widths were measured from the served Google font files (advance widths, 1 em = 1000 units).
Cormorant Garamond ascent .924 / descent .287. Ysabeau Office ascent 1.054 / descent .289. Both
use typo metrics.

---

## 0. Validator and runtime traps (these fail silently)

- Keep A1's `<head>`: `<script src="./support.js"></script>` exactly as written, then `<x-dc>`, then `<helmet>`.
- **The SVG filter primitives must NOT self-close.** Write `<feTurbulence …></feTurbulence>` and
  `<feColorMatrix …></feColorMatrix>`. The validator only lets `path`, `circle`, `rect`, `line`,
  `polyline`, `polygon`, `ellipse`, `stop` and `use` self-close.
- Write `&` in copy as `&amp;` (for example `Colonnade Pool &amp; Terrace`, `Spa &amp; treatments`).
- Never put the strings `9:41` or `status-bar` anywhere in the file. Do not use `©`, which the emoji
  check flags. The characters `·`, `…` and `’` are fine.
- Any `<form>` gets `onSubmit="{{ holdSubmit }}"`, and the script returns
  `holdSubmit: (event) => event.preventDefault()`. This stops Play mode from navigating away. No
  other holes are needed. Write all copy as literal text.
- The root is a `<div>` holding `<header>`, `<main>` and `<footer>` landmarks, not `<main>` itself.
  The validator reads the first styled element after `<helmet>` as the root. Keep `width: Wpx;` and
  `height: Hpx;` in it, matching `$preview`.
- There is one grain SVG per board, with filter `id="g"`. A second one on the same board would
  need `id="g2"`.
- Radios use ids `r1` to `r5`, and the error slot uses `id="rating-error"`. Keep these ids.

## 1. Page frame and helmet (Avela, used on A1 to A4 and A6)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Avela Resort — After a 2-star rating</title>
    <script src="./support.js"></script>
  </head>
  <body>
    <x-dc>
      <helmet>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&amp;family=Ysabeau+Office:wght@400;600&amp;display=swap"
        />
        <style>
          body {
            margin: 0;
            background: #121614;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
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
            color: #d9be8c;
          }
          a:hover {
            color: #ebd6a8;
          }
          button,
          label,
          a {
            -webkit-tap-highlight-color: transparent;
          }
          textarea::placeholder {
            color: #9d968a;
            opacity: 1;
          }
          :focus-visible {
            outline: 2px solid #ebd6a8;
            outline-offset: 3px;
          }
          input[type='radio']:focus-visible + label {
            outline: 2px solid #ebd6a8;
            outline-offset: 2px;
          }
          [tabindex='-1']:focus {
            outline: none;
          }
          .a-star svg,
          .a-btn-primary,
          .a-link-row svg {
            transition: transform 90ms cubic-bezier(0.2, 0.8, 0.2, 1);
          }
          .a-star:active svg {
            transform: scale(0.94);
          }
          .a-btn-primary:active {
            background-color: #c9a96f !important;
            transform: translateY(1px);
          }
          .a-btn-outline:active,
          .a-row-btn:active {
            background-color: rgba(205, 174, 120, 0.14) !important;
          }
          @media (hover: hover) and (pointer: fine) {
            .a-star:hover svg[fill='none'] {
              stroke: #f2ece1;
            }
            .a-btn-primary:hover {
              background-color: #dfc38f !important;
            }
            .a-btn-outline:hover,
            .a-row-btn:hover {
              background-color: rgba(205, 174, 120, 0.08) !important;
            }
            .a-text-btn:hover {
              color: #ebd6a8 !important;
            }
            .a-link-row:hover svg {
              transform: translate(2px, -2px);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            * {
              transition: none !important;
              animation: none !important;
            }
          }
        </style>
      </helmet>
      <div
        style="position: relative; display: flex; flex-direction: column; width: 390px; height: 980px; box-sizing: border-box; overflow: hidden; background: #121614; color: #F2ECE1; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 400; font-size: 16px; line-height: 24px;"
      >
        <header>…section 3…</header>
        <main
          style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 32px; padding: 16px 24px 0;"
        >
          …
        </main>
        <footer>…section 17 (omit where the brief says the board ends before it)…</footer>
      </div>
    </x-dc>
    <script
      type="text/x-dc"
      data-dc-script
      data-props='{"$preview":{"width":390,"height":980}}'
    >
      class Component extends DCLogic {
        renderVals() {
          return {
            holdSubmit: (event) => event.preventDefault()
          };
        }
      }
    </script>
  </body>
</html>
```

The class hooks exist only for interaction states that inline style cannot express:

- `a-star`: rating label.
- `a-btn-primary`: filled champagne button or link.
- `a-btn-outline`: 1px champagne outline button.
- `a-text-btn`: champagne text button.
- `a-row-btn`: the "Your response" disclosure header.
- `a-link-row`: a useful-links row.

Every `!important` in the helmet is there only to beat an inline `background-color` or `color`.
The `:focus-visible` rules, the sr-only rule and the reduced-motion rule are the shared ones.
`[tabindex="-1"]:focus` removes the ring from the programmatically focused "Thank you." heading.

## 2. Tokens and the thermal map (A5)

| Role                                                                                       | Avela                                        | A5 thermal (Хотел Сарива Спа)                           |
| ------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------- |
| Stage (page, band base)                                                                    | #121614                                      | #0F1619                                                 |
| Raised (Google card, open panel)                                                           | #1A1F1C                                      | #162024                                                 |
| Field (textarea)                                                                           | #232925                                      | #1D292E                                                 |
| Hairline                                                                                   | #363835                                      | #33393B                                                 |
| Primary text                                                                               | #F2ECE1                                      | #EEF1EE                                                 |
| Description, inactive language link over the scrim                                         | #D6CFC3                                      | #CFD6D4 (A5's inactive 'EN' uses #AEB9BA, per its spec) |
| Secondary: card body, receipt, privacy                                                     | #B8B0A3                                      | #AEB9BA                                                 |
| Meta: endpoints, subline, footer, analytics                                                | #9D968A                                      | #93A0A2                                                 |
| Accent: star fill and stroke, icons, outline borders, underline under the current language | #CDAE78                                      | #6FC3DF                                                 |
| Accent text: h1, links, Change, caption word                                               | #D9BE8C                                      | #8ED0E6                                                 |
| Primary button, then hover, then active                                                    | #D4B57E, #DFC38F, #C9A96F                    | #7CC8E2, #97D4E9, #68BCD8                               |
| Button label                                                                               | #121614                                      | #0F1619                                                 |
| Idle star                                                                                  | #8D8C85                                      | #8A8E8E                                                 |
| Focus ring                                                                                 | #EBD6A8                                      | #B5E3F2                                                 |
| Language divider                                                                           | rgba(214,207,195,.4)                         | rgba(207,214,212,.4)                                    |
| Outline hover tint, then active tint                                                       | rgba(205,174,120,.08), rgba(205,174,120,.14) | rgba(111,195,223,.08), rgba(111,195,223,.14)            |

A5 helmet: the same as section 1 with every value swapped by this table. The rules that change are:

- `body` background → #0F1619.
- `a` → #8ED0E6, `a:hover` → #B5E3F2.
- `textarea::placeholder` → #93A0A2.
- Both focus rules → #B5E3F2.
- `.a-btn-primary:active` → #68BCD8, `:hover` → #97D4E9.
- The tints → rgba(111,195,223,…).
- The star hover stroke → #EEF1EE.
- `.a-text-btn:hover` → #B5E3F2.

Contrast checks:

- The textarea border #8D8C85 is 5.4:1 on #121614 and 4.4:1 on #232925.
- The placeholder #9D968A is 5.1:1 on #232925.
- The hover and active button labels are 8.2:1 or better in both palettes.

## 3. Header band (0–232) with identity strip (0–56): photo version

This is copied verbatim from A1 and is identical on A1 to A4 and A6. Layer order:

1. Photo.
2. Two scrims.
3. The textured layer, whose first child is the grain and whose second child is the strip. The strip is `position: relative`, so it paints above the grain.

```html
<header
  style="position: relative; flex-shrink: 0; height: 232px; overflow: hidden; isolation: isolate; background: #121614;"
>
  <img
    src="/_blob/b1b75f289468fdb59ca2e65c1a80cd3f"
    alt=""
    width="390"
    height="232"
    fetchpriority="high"
    style="position: absolute; top: 0; left: 0; display: block; width: 390px; height: 232px; object-fit: cover; object-position: 50% 40%;"
  />
  <div
    aria-hidden="true"
    style="position: absolute; top: 0; left: 0; width: 390px; height: 116px; background: linear-gradient(180deg, rgba(18,22,20,.82) 0px, rgba(18,22,20,.82) 52px, rgba(18,22,20,0) 116px);"
  ></div>
  <div
    aria-hidden="true"
    style="position: absolute; top: 150px; left: 0; width: 390px; height: 82px; background: linear-gradient(180deg, rgba(18,22,20,0), #121614);"
  ></div>
  <div style="position: absolute; inset: 0;">
    <svg
      aria-hidden="true"
      style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.05;mix-blend-mode:overlay"
    >
      <filter id="g">
        <feTurbulence
          type="fractalNoise"
          baseFrequency=".85"
          numOctaves="2"
          stitchTiles="stitch"
        ></feTurbulence>
        <feColorMatrix type="saturate" values="0"></feColorMatrix>
      </filter>
      <rect width="100%" height="100%" filter="url(#g)" />
    </svg>
    <div
      style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 24px;"
    >
      <p
        style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 14px; line-height: 20px; letter-spacing: .28em; text-transform: uppercase; color: #F2ECE1;"
      >
        Avela Resort
      </p>
      <nav aria-label="Language" style="display: flex; align-items: center;">
        <a
          href="#"
          hreflang="en"
          aria-current="page"
          style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 14px; line-height: 20px; color: #F2ECE1; text-decoration-line: underline; text-decoration-color: #CDAE78; text-decoration-thickness: 1px; text-underline-offset: 6px;"
          >EN<span class="sr-only"> English</span></a
        >
        <span
          aria-hidden="true"
          style="display: block; width: 1px; height: 14px; background: rgba(214,207,195,.4);"
        ></span>
        <a
          href="#"
          hreflang="bg"
          lang="bg"
          style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 14px; line-height: 20px; color: #D6CFC3; text-decoration: none;"
          >БГ<span class="sr-only"> Български</span></a
        >
      </nav>
    </div>
  </div>
</header>
```

Measured:

- The wordmark is 148.5px wide, and its cap band sits at y23.7–32.5, centred on 28.
- The language group runs x277–366: 44 + 1 + 44.
- The underline sits 6px below the baseline, at about y39, on the 82% scrim.

## 4. Header band: no-photo carved initial (A5, thermal, BG)

```html
<header
  style="position: relative; flex-shrink: 0; height: 232px; overflow: hidden; isolation: isolate; background: radial-gradient(120% 90% at 50% 38%, #173039 0%, #0F1619 72%);"
>
  <span
    aria-hidden="true"
    style="position: absolute; top: 52px; left: 0; width: 390px; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 176px; line-height: 176px; text-align: center; color: #142A31; text-shadow: 0 -1px 0 rgba(0,0,0,.55), 0 1px 0 rgba(238,241,238,.08);"
    >С</span
  >
  <div style="position: absolute; inset: 0;">
    [grain svg exactly as in section 3]
    <div
      style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 24px;"
    >
      <p
        style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 14px; line-height: 20px; letter-spacing: .24em; text-transform: uppercase; color: #EEF1EE;"
      >
        Хотел Сарива Спа
      </p>
      <nav aria-label="Език" style="display: flex; align-items: center;">
        <a
          href="#"
          hreflang="en"
          lang="en"
          style="…same box as section 3…; color: #AEB9BA; text-decoration: none;"
          >EN<span class="sr-only"> English</span></a
        >
        <span
          aria-hidden="true"
          style="display: block; width: 1px; height: 14px; background: rgba(207,214,212,.4);"
        ></span>
        <a
          href="#"
          hreflang="bg"
          aria-current="page"
          style="…same box…; color: #EEF1EE; text-decoration-line: underline; text-decoration-color: #6FC3DF; text-decoration-thickness: 1px; text-underline-offset: 6px;"
          >БГ<span class="sr-only"> Български</span></a
        >
      </nav>
    </div>
  </div>
</header>
```

Notes:

- The glyph's baseline is at y196. The math: with `line-height: 176px`, the baseline sits 144px below the box top, so the box top is 52. The glyph's ink runs y84 to y198, clear of the strip.
- The C is optically centred: its side bearings are 8.6px and 7.6px.
- The wordmark measures 192.3px at .24em.
- The page is `lang="bg"`, so the 'EN' link carries `lang="en"`.
- The nav's accessible name is localised to 'Език', because the whole page follows the chosen language.
- Avela's own no-photo band would use centre #26302B and glyph #1E2622 over #121614.
- Never add a ring, border, check or badge to the glyph.

## 5. Placement line (h1, 248–264)

```html
<h1
  style="margin: 0; padding-left: .18em; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 12px; line-height: 16px; letter-spacing: .18em; text-transform: uppercase; text-align: center; color: #D9BE8C;"
>
  Colonnade Pool &amp; Terrace
</h1>
```

`padding-left: .18em` cancels the trailing tracking so the centred caps are optically centred. The
line is 231px wide. BG A5: 'Минерални басейни' in #8ED0E6, 176px wide.

## 6. Rating fieldset: idle (A1, EN; legend 276–314 … caption 420–446)

The form is a flex column with gap 16: the fieldset, then the submit group (section 7).

```html
<form
  action="#"
  method="post"
  onSubmit="{{ holdSubmit }}"
  style="display: flex; flex-direction: column; gap: 16px; margin: 0;"
>
  <fieldset style="min-width: 0; margin: 0; padding: 0; border: 0;">
    <legend
      style="width: 100%; margin: 0; padding: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 32px; line-height: 38px; letter-spacing: -0.005em; text-align: center; text-wrap: balance; color: #F2ECE1;"
    >
      How was your experience?
    </legend>
    <div
      style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 20px;"
    >
      <div
        style="position: relative; display: flex; justify-content: center; gap: 10px; height: 56px;"
      >
        <input type="radio" name="rating" value="1" id="r1" class="sr-only" />
        <label
          for="r1"
          class="a-star"
          style="display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 56px; height: 56px; border-radius: 6px; cursor: pointer;"
        >
          <svg
            aria-hidden="true"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8D8C85"
            stroke-width="1.1"
            stroke-linejoin="round"
            style="display: block;"
          >
            <path
              d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
            />
          </svg>
          <span class="sr-only">1 star, Poor</span>
        </label>
        … r2 '2 stars, Fair', r3 '3 stars, Good', r4 '4 stars, Very good', r5 '5 stars,
        Excellent' (identical markup) …
      </div>
      <div
        aria-hidden="true"
        style="display: flex; justify-content: space-between; width: 320px; height: 18px; font-size: 13px; line-height: 18px; color: #9D968A;"
      >
        <span>Poor</span>
        <span>Excellent</span>
      </div>
      <div
        style="display: flex; align-items: center; justify-content: center; width: 342px; height: 26px;"
      >
        <p
          aria-hidden="true"
          style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; font-weight: 500; font-size: 22px; line-height: 26px; color: #D9BE8C;"
        ></p>
        <p
          id="rating-error"
          role="alert"
          style="display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 600; font-size: 14px; line-height: 20px; color: #F2ECE1;"
        ></p>
      </div>
    </div>
  </fieldset>
  [section 7 submit group]
</form>
```

Geometry:

- The stars run x35–355 (5×56 + 4×10).
- The endpoints are flush to x35 and x355.
- Fieldset height = 38 legend + 20 + 56 + 6 + 18 + 6 + 26 = 170.
- The EN question is 328.5px, one line.

**Selected state** (A5 shows 4 of 5):

- Add `checked` to input 4.
- Stars 1 to n swap their svg attributes to `fill="#CDAE78" stroke="#CDAE78" stroke-width="1.4"`. In A5 that is `#6FC3DF` for both.
- Stars above n keep the idle attributes. In A5 the idle stroke is `#8A8E8E`.
- The caption `<p aria-hidden>` gets the word (`Very good`, or `Много добро` in #8ED0E6 on A5). It is centred in the 26px slot and is 79px wide (Много добро 101.7px).
- Nothing else moves.

**Error state:** the alert `<p>` gets `<svg 16 alert, stroke #CDAE78>Choose a rating from 1 to 5 stars.`
(196.6px). Every radio gets `aria-describedby="rating-error"`.

**BG (A5):**

- The legend is 'Как беше преживяването ви?'. Greedy wrapping gives the widow 'Как беше преживяването / ви?', so `text-wrap: balance` is required. It gives 'Как беше' (122px) / 'преживяването ви?' (246px), and the legend spans 276–352.
- Everything below moves +38: stars 372–428, endpoints 434–452, caption 458–484, submit 500–552, privacy 564–584.
- Endpoints: 'Слабо' / 'Отлично'.
- sr labels: '1 звезда, Слабо', '2 звезди, Задоволително', '3 звезди, Добро', '4 звезди, Много добро', '5 звезди, Отлично'.

## 7. Submit group: submit (462–514) and privacy line (526–546)

```html
<div style="display: flex; flex-direction: column; gap: 12px;">
  <button
    type="submit"
    class="a-btn-primary"
    style="display: flex; align-items: center; justify-content: center; width: 342px; height: 52px; padding: 0 24px; border: 0; border-radius: 4px; background-color: #D4B57E; color: #121614; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 17px; line-height: 20px; letter-spacing: .01em; cursor: pointer;"
  >
    Send privately
  </button>
  <p
    style="display: flex; align-items: center; justify-content: center; gap: 6px; height: 20px; margin: 0; font-size: 14px; line-height: 20px; color: #B8B0A3;"
  >
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#CDAE78"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="display: block; flex-shrink: 0;"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
    <span>Shared privately with Avela Resort.</span>
  </p>
</div>
```

- Sending state: the label becomes `Sending…` and the button stays enabled and the same width.
- A5: background #7CC8E2, label #0F1619 'Изпрати поверително' (160px).
- A5 privacy line: 'Споделя се поверително с Хотел Сарива Спа.' in #AEB9BA with the lock in #6FC3DF (271.6px, one line). Use 'с', not 'със', because Х is not С or З.

## 8. Analytics region (arrival only; hairline at 578, text 594–632, actions 636–680)

```html
<section
  aria-label="Portal analytics information"
  style="display: flex; flex-direction: column; gap: 4px; padding-top: 15px; border-top: 1px solid #363835;"
>
  <p
    style="margin: 0; font-size: 13px; line-height: 19px; text-wrap: balance; color: #9D968A;"
  >
    This page counts visits for Avela Resort. No ads or third-party trackers.
  </p>
  <div
    style="display: flex; align-items: center; justify-content: space-between; height: 44px;"
  >
    <a
      href="#"
      style="display: flex; align-items: center; height: 44px; font-weight: 600; font-size: 14px; line-height: 20px; text-decoration-line: underline; text-decoration-thickness: 1px; text-underline-offset: 3px;"
      >Privacy notice</a
    >
    <button
      type="button"
      class="a-text-btn"
      style="display: flex; align-items: center; justify-content: flex-end; width: 72px; height: 44px; padding: 0; border: 0; background: transparent; color: #D9BE8C; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 14px; line-height: 20px; cursor: pointer;"
    >
      Got it
    </button>
  </div>
</section>
```

- `text-wrap: balance` is required. Greedy wrapping leaves 'trackers.' alone on line 2, while balance breaks at the sentence.
- 'Got it' is right-aligned inside its 72×44 box, so its ink ends on the x366 grid line.
- The link colour comes from the helmet `a` rule. Do not inline it.
- In the main stack, the analytics section and the description form a flex column with gap 24, and main's gap 32 separates that group from the form.
- A5 BG: 'Тази страница отчита посещенията за Хотел Сарива Спа. Без реклами и без проследяване от трети страни.' in #93A0A2 measures 590px, which balances to 2 lines (632–670), not 3. So the actions row lands at 674–718 and the description at 742–820, about 16px above the spec's figures, which assumed 3 lines.
- A5 actions: 'Поверителност' link (92.6px) and 'Разбрах' button (48px, fits in 72).

## 9. Description

```html
<p
  style="margin: 0; font-size: 17px; line-height: 26px; text-align: center; text-wrap: balance; color: #D6CFC3;"
>
  Stone, olive shade and water that keeps the last of the light. Thank you for spending
  part of your day with us.
</p>
```

- 770px of text gives 3 lines (78px tall) in 342. Balance evens the lines out; greedy wrapping would leave 'your day with us.' short.
- A5: #CFD6D4, 'Топла минерална вода, борова сянка и тишина. Благодарим ви, че прекарахте част от деня си при нас.', 3 lines.

## 10. Main stack recipes (these reproduce the brief's y positions exactly)

**Arrival (A1, and A5 with +38):**

```
main (gap 32, padding 16 24 0)
├─ div (gap 12)
│  ├─ h1 (248–264)
│  └─ form (gap 16) [fieldset 276–446, submit group 462–546]
└─ div (gap 24)
   ├─ analytics (578–680)
   └─ description (704–782)
```

**After rating (A2, A3, A4, A6):**

```
main (gap 32, padding 16 24 0)
├─ div (gap 24)
│  ├─ div (gap 12)
│  │  ├─ h1 248–264
│  │  ├─ h2 'Thank you.' 276–314
│  │  ├─ p role=status (sr-only)
│  │  └─ receipt row 326–370
│  ├─ div (gap 16)
│  │  ├─ Google card 394–658, or degraded card 394–558
│  │  └─ [private card]
│  └─ Your response
├─ description
└─ links section
footer
```

Resulting positions:

- A2: Google 394–658, private 674–866, Your response 890–946. The board ends at 980; omit the description, links and footer.
- A3: Google 394–658, Your response 682–738, description 770–848, links label 880–896, rows 904–1072. The footer box is 1104–1180 (section 17b); main's `flex: 1` absorbs the slack.
- A4: Google 394–658, open panel 682–1058, description 1090–1168. The board ends at 1190; omit the links and footer.
- A6: degraded 394–558, private 574–766, Your response 790–846. The board ends at 870.

## 11. Receipt block (the first div above; 'Thank you.' 276–314, row 326–370)

```html
<div style="display: flex; flex-direction: column; gap: 12px;">
  [h1 from section 5]
  <h2
    tabindex="-1"
    style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 32px; line-height: 38px; letter-spacing: -0.005em; text-align: center; color: #F2ECE1;"
  >
    Thank you.
  </h2>
  <p role="status" class="sr-only">Rating sent privately</p>
  <div
    style="position: relative; display: flex; align-items: center; justify-content: center; gap: 12px; height: 44px;"
  >
    <p class="sr-only">Your rating: 2 out of 5, Fair. Sent privately.</p>
    <span aria-hidden="true" style="display: flex; gap: 3px;">
      [n filled mini stars, then 5−n idle mini stars]
    </span>
    <span
      aria-hidden="true"
      style="font-size: 15px; line-height: 20px; white-space: nowrap; color: #B8B0A3;"
      >Fair · sent privately</span
    >
    <button
      type="button"
      class="a-text-btn"
      style="display: flex; align-items: center; height: 44px; padding: 0; border: 0; background: transparent; color: #D9BE8C; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 15px; line-height: 20px; text-decoration-line: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: pointer;"
    >
      Change<span class="sr-only"> your rating</span>
    </button>
  </div>
</div>
```

Mini stars (16px):

- Filled: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#CDAE78" stroke="#CDAE78" stroke-width="1.4" stroke-linejoin="round" style="display: block;"><path d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"/></svg>`
- Idle: the same, with `fill="none" stroke="#8D8C85" stroke-width="1.5"`. The heavier stroke gives a 1px line at this size.

Row widths: 92 for the stars, then 12, the text, 12, and 'Change' (47):

- 'Fair · sent privately' 119.7, row 282.7.
- 'Good · sent privately' 129.6.
- 'Very good · sent privately' 159.5, row 322.5.
- 'Excellent · sent privately' 151.9.

All fit in 342 on one line. The 'Change' button has no padding. Its ink is 47px wide and it is 44 tall, which meets the 44×44 target.

sr-only sentences:

- 'Your rating: 5 out of 5, Excellent. Sent privately.'
- 'Your rating: 4 out of 5, Very good. Sent privately.'
- 'Your rating: 3 out of 5, Good. Sent privately.'

## 12. Google card (394–658, 264 tall; identical on A2, A3 and A4)

```html
<section
  aria-labelledby="google-title"
  style="display: flex; flex-direction: column; gap: 20px; box-sizing: border-box; width: 342px; padding: 23px; border: 1px solid #363835; border-radius: 4px; background-color: #1A1F1C;"
>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <h2
      id="google-title"
      style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 24px; line-height: 30px; text-wrap: balance; color: #F2ECE1;"
    >
      Share your experience on Google
    </h2>
    <p
      style="margin: 0; font-size: 16px; line-height: 24px; text-wrap: pretty; color: #B8B0A3;"
    >
      If you’d like, you can also leave a public review on Google.
    </p>
  </div>
  <div style="display: flex; flex-direction: column; gap: 10px;">
    <a
      href="#"
      class="a-btn-primary"
      style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 294px; height: 52px; box-sizing: border-box; border-radius: 4px; background-color: #D4B57E; color: #121614; font-weight: 600; font-size: 17px; line-height: 20px; letter-spacing: .01em; text-decoration: none;"
      >Continue to Google<svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#121614"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="display: block; flex-shrink: 0;"
      >
        <path d="M7 17L17 7M9 7h8v8" /></svg
      ><span class="sr-only"> (opens Google)</span></a
    >
    <p
      style="margin: 0; font-size: 13px; line-height: 18px; text-align: center; color: #9D968A;"
    >
      Opens Google · you may need to sign in
    </p>
  </div>
</section>
```

Geometry and rules:

- The 23px padding plus the 1px border puts the content 24px in, so the inner width is 294.
- h2 418–478. Balance gives 'Share your experience / on Google'; greedy wrapping would leave 'Google' alone.
- Body 486–534, 2 lines.
- Link-button 554–606.
- Subline 616–634.
- 23px + 1px below the subline brings the card to 658.
- The card takes no score input and has no stars, no logo and no entrance animation in the mockup. Boards draw the settled end state; the production rise of 8px with an opacity fade over 220ms at +60ms is not drawn.

## 13. Degraded card (394–558, 164 tall; the same slot and surface)

```html
<section
  aria-labelledby="google-title"
  style="display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: 342px; padding: 23px; border: 1px solid #363835; border-radius: 4px; background-color: #1A1F1C;"
>
  <h2
    id="google-title"
    style="display: flex; align-items: flex-start; gap: 10px; margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 24px; line-height: 30px; color: #F2ECE1;"
  >
    <span
      aria-hidden="true"
      style="display: flex; align-items: center; flex-shrink: 0; height: 30px;"
      ><svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#CDAE78"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="display: block;"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" /></svg
    ></span>
    <span>Google can’t be opened from here right now</span>
  </h2>
  <p style="margin: 0; font-size: 16px; line-height: 24px; color: #B8B0A3;">
    Your rating reached Avela Resort privately. Thank you.
  </p>
</section>
```

- The title wraps naturally to 'Google can’t be opened / from here right now' (266px text column).
- The body wraps to 'Your rating reached Avela Resort privately. / Thank you.'
- There is no `<a>`, no button and no URL anywhere in the file.

## 14. Private-note card (collapsed; A2 674–866, A6 574–766; 192 tall)

```html
<section
  aria-labelledby="note-title"
  style="display: flex; flex-direction: column; gap: 16px; box-sizing: border-box; width: 342px; padding: 23px; border: 1px solid #363835; border-radius: 4px; background-color: transparent;"
>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <h2
      id="note-title"
      style="margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 22px; line-height: 28px; color: #F2ECE1;"
    >
      Add a private note for the team
    </h2>
    <p style="margin: 0; font-size: 15px; line-height: 22px; color: #B8B0A3;">
      Optional.<br />Shared privately with Avela Resort.
    </p>
  </div>
  <button
    type="button"
    class="a-btn-outline"
    aria-expanded="false"
    style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 294px; height: 48px; box-sizing: border-box; padding: 0 16px; border: 1px solid #CDAE78; border-radius: 4px; background-color: transparent; color: #D9BE8C; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; cursor: pointer;"
  >
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#CDAE78"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="display: block; flex-shrink: 0;"
    >
      <path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg
    >Write a private note
  </button>
</section>
```

- The title is 273.7px, one line.
- The body is only 283.5px, so it would sit on ONE line and leave the card at 170, not 192. The `<br>` after 'Optional.' makes the 2 lines the brief measures (44px) and reads as a deliberate break. The words are unchanged.
- Height: 24 + 28 + 8 + 44 + 16 + 48 + 24 = 192.
- The button is never filled, and the card always sits below the Google or degraded card.

## 15. Note composer (the private card opened; not drawn in A1–A6, reference only)

The trigger is replaced by the composer and focus moves to the textarea. 'Not now' restores the
collapsed card and returns focus to the trigger.

```html
<section aria-labelledby="note-title" style="…same card shell as section 14…">
  [the same title and body div]
  <form
    id="note-composer"
    action="#"
    method="post"
    onSubmit="{{ holdSubmit }}"
    style="display: flex; flex-direction: column; gap: 16px; margin: 0;"
  >
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <label
        for="note"
        style="font-weight: 600; font-size: 15px; line-height: 20px; color: #F2ECE1;"
        >Your note (optional)</label
      >
      <textarea
        id="note"
        name="note"
        rows="5"
        maxlength="2000"
        aria-describedby="note-help"
        placeholder="What should the team know?"
        style="display: block; box-sizing: border-box; width: 294px; height: 144px; padding: 12px 14px; border: 1px solid #8D8C85; border-radius: 4px; background-color: #232925; color: #F2ECE1; font-family: 'Ysabeau Office', system-ui, sans-serif; font-size: 16px; line-height: 24px; resize: none;"
      ></textarea>
      <div
        style="display: flex; justify-content: space-between; gap: 12px; font-size: 13px; line-height: 18px; color: #9D968A;"
      >
        <p id="note-help" style="margin: 0;">No need to include your name.</p>
        <p aria-live="polite" style="margin: 0; white-space: nowrap;"></p>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 12px;">
      <button
        type="submit"
        class="a-btn-outline"
        style="flex: 1 1 auto; height: 48px; box-sizing: border-box; padding: 0 16px; border: 1px solid #CDAE78; border-radius: 4px; background-color: transparent; color: #D9BE8C; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; cursor: pointer;"
      >
        Send note privately
      </button>
      <button
        type="button"
        class="a-text-btn"
        style="flex-shrink: 0; width: 88px; height: 48px; padding: 0; border: 0; background: transparent; color: #D9BE8C; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; cursor: pointer;"
      >
        Not now
      </button>
    </div>
  </form>
</section>
```

- The open card is 406 tall: 24 + 80 header + 16 + 198 field block + 16 + 48 + 24.
- From 1,800 characters, the counter `<p>` reads '187 characters left'.
- The send button stays an outline. The private card never carries a filled button.
- Note-sent state: the card body becomes `<p role="status" style="display: flex; gap: 10px; align-items: flex-start; margin: 0; font-size: 16px; line-height: 24px; text-wrap: balance; color: #F2ECE1;">` holding a 24px-tall span with a 16px check (`M5 12.5l4.5 4.5L19 7.5`, stroke #CDAE78) and 'Your note was sent privately to Avela Resort.' Balance is required, or 'Resort.' is orphaned.

## 16. "Your response"

**Collapsed (56 tall; A2 890–946, A3 682–738, A6 790–846):**

```html
<h2 style="margin: 0;">
  <button
    type="button"
    class="a-row-btn"
    aria-expanded="false"
    style="display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 342px; height: 56px; box-sizing: border-box; padding: 0; border: 0; border-top: 1px solid #363835; border-bottom: 1px solid #363835; background-color: transparent; color: #F2ECE1; font-family: 'Ysabeau Office', system-ui, sans-serif; text-align: left; cursor: pointer;"
  >
    <span style="display: flex; flex-direction: column;">
      <span style="font-weight: 600; font-size: 16px; line-height: 20px; color: #F2ECE1;"
        >Your response</span
      >
      <span style="font-weight: 400; font-size: 13px; line-height: 18px; color: #9D968A;"
        >Change, remove or start over</span
      >
    </span>
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#CDAE78"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="display: block; flex-shrink: 0;"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>
</h2>
```

**Expanded (A4 682–1058, 376 tall = 1 + 55 + 76 + 92 + 151 + 1):**

```html
<section
  aria-labelledby="your-response-title"
  style="box-sizing: border-box; width: 342px; border: 1px solid #363835; border-radius: 4px; background-color: #1A1F1C; overflow: hidden;"
>
  <h2 style="margin: 0;">
    <button
      id="your-response-title"
      type="button"
      class="a-row-btn"
      aria-expanded="true"
      aria-controls="your-response-panel"
      style="display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; height: 55px; box-sizing: border-box; padding: 0 16px; border: 0; background-color: transparent; color: #F2ECE1; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; text-align: left; cursor: pointer;"
    >
      <span>Your response</span>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#CDAE78"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="display: block; flex-shrink: 0;"
      >
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  </h2>
  <div id="your-response-panel">
    <div
      style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; background-image: linear-gradient(#363835, #363835); background-size: calc(100% - 32px) 1px; background-position: 16px 0; background-repeat: no-repeat;"
    >
      <div
        style="display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; max-width: 200px;"
      >
        <p
          style="margin: 0; font-weight: 600; font-size: 15px; line-height: 20px; color: #F2ECE1;"
        >
          Change your rating
        </p>
        <p style="margin: 0; font-size: 13px; line-height: 18px; color: #9D968A;">
          Until 15:32 today, Sofia time
        </p>
      </div>
      <button
        type="button"
        class="a-btn-outline"
        style="flex-shrink: 0; width: 88px; height: 44px; box-sizing: border-box; padding: 0; border: 1px solid #CDAE78; border-radius: 4px; background-color: transparent; color: #D9BE8C; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 15px; line-height: 20px; cursor: pointer;"
      >
        Change<span class="sr-only"> your rating</span>
      </button>
    </div>
    <div style="…same row shell as above…">
      <div style="…same text column…">
        <p style="…title…">Remove your rating</p>
        <p style="…meta…">
          Until 14:32 tomorrow. Anything you posted on Google isn’t affected.
        </p>
      </div>
      <button
        type="button"
        class="a-btn-outline"
        style="…same as Change but width: 96px…"
      >
        Remove<span class="sr-only"> your rating</span>…
      </button>
    </div>
    <div
      style="display: flex; flex-direction: column; gap: 12px; padding: 16px 16px 15px; background-image: linear-gradient(#363835, #363835); background-size: calc(100% - 32px) 1px; background-position: 16px 0; background-repeat: no-repeat;"
    >
      <div style="display: flex; flex-direction: column; gap: 4px; max-width: 200px;">
        <p
          style="margin: 0; font-weight: 600; font-size: 15px; line-height: 20px; color: #F2ECE1;"
        >
          Shared phone or tablet?
        </p>
        <p style="margin: 0; font-size: 13px; line-height: 18px; color: #9D968A;">
          Start over so the next guest begins with a fresh page.
        </p>
      </div>
      <button
        type="button"
        class="a-btn-outline"
        style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 48px; box-sizing: border-box; padding: 0 16px; border: 1px solid #CDAE78; border-radius: 4px; background-color: transparent; color: #D9BE8C; font-family: 'Ysabeau Office', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; cursor: pointer;"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#CDAE78"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="display: block; flex-shrink: 0;"
        >
          <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg
        >Start over on this device
      </button>
    </div>
  </div>
</section>
```

Row heights:

- Change row: 16 + 44 + 16 = 76, spanning 738–814.
- Remove row: 16 + (20 + 4 + 36) + 16 = 92, spanning 814–906. Its meta measures 'Until 14:32 tomorrow. Anything you' (198.7) / 'posted on Google isn’t affected.' (172): 2 lines in 200. Do NOT shrink the text column below 200, or it breaks into 3 lines.
- Start-over row: 16 + 60 + 12 + 48 + 15 = 151, spanning 906–1057, plus the 1px border to 1058. Its meta is 'Start over so the next guest begins' / 'with a fresh page.'

The inset hairlines are background-image lines, so they take no layout height.

Optional rows and states (not drawn in A1–A6):

- 'Remove your note' / 'Until 14:32 tomorrow' / 'Remove…' uses the same 76-tall row.
- The two-step confirm replaces the Remove row content: `<div role="group" aria-labelledby="confirm-text" style="display: flex; flex-direction: column; gap: 12px; padding: 16px; [inset hairline]">`.
  - First `<p id="confirm-text">` in 15/22 #F2ECE1: 'Remove both? Avela Resort will no longer see your rating or note. Anything you posted on Google isn’t affected.' (3 lines).
  - Then a row with gap 12: the outline 'Remove rating and note' (flex 1, 44 tall) and the text button 'Keep them' (44 tall, padding 0 12px).
- Done after start over: `<p role="status">This device is ready for the next guest.</p>` in 15/22 #B8B0A3, in the start-over row.

## 17. Useful links (A3; label 880–896, rows 904–1072)

```html
<section
  aria-labelledby="links-title"
  style="display: flex; flex-direction: column; gap: 8px;"
>
  <h2
    id="links-title"
    style="margin: 0; font-weight: 600; font-size: 12px; line-height: 16px; letter-spacing: .18em; text-transform: uppercase; color: #D9BE8C;"
  >
    Also useful
  </h2>
  <ul role="list" style="margin: 0; padding: 0; list-style: none;">
    <li>
      <a
        href="#"
        class="a-link-row"
        style="display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 56px; font-weight: 600; font-size: 17px; line-height: 24px; color: #F2ECE1; text-decoration: none;"
        >Spa &amp; treatments<svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#CDAE78"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="display: block; flex-shrink: 0;"
        >
          <path d="M7 17L17 7M9 7h8v8" /></svg
      ></a>
    </li>
    <li style="border-top: 1px solid #363835;">
      <a href="#" class="a-link-row" style="…same, but height: 55px…"
        >Dinner at Olea[arrow]</a
      >
    </li>
    <li style="border-top: 1px solid #363835;">
      <a href="#" class="a-link-row" style="…height: 55px…">Getting here[arrow]</a>
    </li>
  </ul>
</section>
```

- Hairlines run between rows only, at 960 and 1016.
- There are no sublines, no tel: links and no photos.
- The arrow nudges 2px up and to the right on hover.

**17a. Footer, flush (A1: hairline at 800, row 800–844, the board's last pixels).** The hairline is a
background line, so the link keeps a full 44px target:

```html
<footer style="flex-shrink: 0; padding: 0 24px;">
  <div
    style="display: flex; align-items: center; justify-content: space-between; height: 44px; background-image: linear-gradient(#363835, #363835); background-size: 100% 1px; background-position: 0 0; background-repeat: no-repeat;"
  >
    <a
      href="#"
      style="display: flex; align-items: center; height: 44px; font-weight: 600; font-size: 13px; line-height: 16px; text-decoration-line: underline; text-decoration-thickness: 1px; text-underline-offset: 3px;"
      >Privacy notice</a
    >
    <p style="margin: 0; font-size: 12px; line-height: 16px; color: #9D968A;">
      Made with Reputation Key
    </p>
  </div>
</footer>
```

**17b. Footer, full page (A3: hairline at 1104, row 1112–1156, board bottom 1180):**

```html
<footer style="flex-shrink: 0; padding: 0 24px 24px;">
  <div style="padding-top: 7px; border-top: 1px solid #363835;">
    <div
      style="display: flex; align-items: center; justify-content: space-between; height: 44px;"
    >
      [same link and p as 17a]
    </div>
  </div>
</footer>
```

## 18. Icon set (24 viewBox, 1.5 stroke, round caps and joins, aria-hidden, `display: block; flex-shrink: 0`)

Shell: `<svg aria-hidden="true" width="S" height="S" viewBox="0 0 24 24" fill="none" stroke="C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display: block; flex-shrink: 0;">…</svg>`

| Icon              | Inner markup                                                                                                          | Where used (size / colour)                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| external arrow    | `<path d="M7 17L17 7M9 7h8v8"/>`                                                                                      | Google button 16 / #121614; link rows 16 / #CDAE78 |
| arrow right       | `<path d="M5 12h14M13 6l6 6-6 6"/>`                                                                                   | (spare)                                            |
| chevron down / up | `<path d="M6 9l6 6 6-6"/>` / `<path d="M6 15l6-6 6 6"/>`                                                              | Your response 16 / #CDAE78                         |
| lock              | `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`                                | privacy line 14 / #CDAE78                          |
| pencil            | `<path d="M4 20h4L19 9l-4-4L4 16v4z"/>`                                                                               | Write a private note 16 / #CDAE78                  |
| info / alert      | `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`                                                        | degraded title 18; rating error 16 / #CDAE78       |
| check             | `<path d="M5 12.5l4.5 4.5L19 7.5"/>`                                                                                  | note sent 16 / #CDAE78                             |
| rotate-left       | `<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>`                                                                         | Start over 16 / #CDAE78                            |
| book              | `<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>`                      | (spare)                                            |
| calendar          | `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`                                  | (spare)                                            |
| map pin           | `<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>`                       | (spare)                                            |
| camera            | `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7l1.5-2.5h3L15 7"/><circle cx="12" cy="13.5" r="3.5"/>` | (spare)                                            |

The star is the only filled glyph, and it never appears near the word Google.

## 19. Focus, sr-only and grain

- Focus: a 2px #EBD6A8 ring at offset 3px (radio labels at offset 2px, following their 6px radius). It is defined only in the helmet (section 1). Over the photo it always falls on the 82% scrim.
- sr-only: the helmet rule in section 1. It is used for the radios, the star names, the language full names, the Google '(opens Google)' suffix, the 'your rating' suffixes, the receipt sentence and the status line.
- Grain: the shared snippet at `opacity:.05; mix-blend-mode:overlay`, on the band only. It is the first child of the band's absolutely positioned textured layer, beneath the strip. Its filter primitives are explicitly closed (section 0). It is never a `data:` URI.
