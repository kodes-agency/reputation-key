# Folio (B): component reference

This is the vocabulary set by `B1-arrival.dc.html` (validated). Copy the snippets as written. Change only the copy, the star count and the colours listed in section 16 (night edition). Every value here was fitted to the brief's y positions. Where the brief's own numbers do not add up (B4), section 13 gives fit-checked positions.

---

## 0. Invariants (every Folio board)

- **Column.** x28–366 (338px). The root padding is `12px 24px 0 28px`. Every rule, panel, button and list spans the full column. Nothing is centred; everything is flush-left.
- **Structure.** No cards, no shadows and no fills, except the inline confirm box. Radius 2 on buttons and star labels only.
- **Families.**
  - Sans: `'Sofia Sans', system-ui, sans-serif`. Everything that is not serif.
  - Serif: `'Playfair', Georgia, serif`. Used only at 20px and above: wordmark 56, question and 'Thank you.' 26, Google title 24, letter title 22, colophon name 20.
- **Inheritance.** The root sets the sans family and #1D2528. `<p>`, `<span>`, `<label>` and `<li>` inherit it. `<button>`, `<textarea>` and `<input>` do NOT inherit fonts, so always write their `font-family` inline.
- **Box sizing.** Every `<button>` carries `box-sizing: border-box` inline. `width: 100%` plus padding must never overflow the column.
- **Spacing.**
  - Sibling spacing is always `gap` on a flex column or row.
  - Section offsets are `padding-top` on the section wrapper.
  - The only negative margins are optical overhangs: nav `-12px`, 'Got it' `-8px`, and the footer link's hit area.
- **Validator traps.**
  - Never self-close `<feTurbulence>` or `<feColorMatrix>`; write explicit close tags. Only path, circle, rect, line and similar leaf shapes may self-close.
  - Never type the glyph ↗ or any other arrow character. Many are Extended_Pictographic and fail the emoji check. Use the SVG icon.
  - Never write the words innerHTML, appendChild or createElement anywhere, including comments.
  - Never write a clock time that looks like a fake status bar.
- **Handler.** The only template hole used is `onSubmit="{{ holdSubmit }}"` on the rating form (B1 and B5), so Play mode never navigates. Other boards need no holes. Keep the script block anyway, with `renderVals() { return {}; }` when there is no handler.

---

## 1. Page frame

### Head

```html
<!doctype html>
<html lang="en">
  <!-- "bg" on B5 -->
  <head>
    <meta charset="utf-8" />
    <title>The Harbor Hotel — Arrival</title>
    <!-- the artboard's title from the brief -->
    <script src="./support.js"></script>
  </head>
  <body>
    <x-dc>
      <helmet>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Playfair:opsz,wght@5..1200,400..600&family=Sofia+Sans:wght@400;600&display=swap"
        />
        <style>
          /* DAY helmet: every Folio board except B5. Paste verbatim. */
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
            color: #1f5e78;
          }
          a:hover {
            color: #174a5f;
          }
          :focus-visible {
            outline: 2px solid #1f5e78;
            outline-offset: 3px;
          }
          input[type='radio']:focus-visible + label {
            outline: 2px solid #1f5e78;
            outline-offset: 2px;
          }
          [tabindex='-1']:focus-visible {
            outline: none;
          }
          .fo-star svg {
            transition:
              transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1),
              stroke 120ms linear;
          }
          .fo-star:hover svg[fill='none'] {
            stroke: #1d2528;
          }
          .fo-star:active svg {
            transform: scale(0.94);
          }
          .fo-primary {
            transition: background-color 120ms linear;
          }
          .fo-primary:hover {
            background: #2c373b !important;
          }
          .fo-primary:active {
            transform: translateY(1px);
          }
          .fo-outline:hover {
            background: #f8f4ec !important;
          }
          .fo-outline:active {
            background: #ece5d8 !important;
          }
          .fo-text:hover {
            color: #174a5f !important;
          }
          .fo-row:hover {
            background: #ece5d8;
          }
          textarea::placeholder {
            color: #5f676a;
            opacity: 1;
          }
          @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
              transition-duration: 0s !important;
              animation-duration: 0s !important;
              animation-iteration-count: 1 !important;
            }
            .fo-star:active svg,
            .fo-primary:active {
              transform: none;
            }
          }
        </style>
      </helmet></x-dc
    >
  </body>
</html>
```

### NIGHT helmet (B5)

Same `<link>` lines. The `<style>` is:

```css
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
  color: #e3a597;
}
a:hover {
  color: #f0c3b8;
}
:focus-visible {
  outline: 2px solid #f0c3b8;
  outline-offset: 3px;
}
input[type='radio']:focus-visible + label {
  outline: 2px solid #f0c3b8;
  outline-offset: 2px;
}
[tabindex='-1']:focus-visible {
  outline: none;
}
.fo-star svg {
  transition:
    transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1),
    stroke 120ms linear;
}
.fo-star:hover svg[fill='none'] {
  stroke: #ede5d8;
}
.fo-star:active svg {
  transform: scale(0.94);
}
.fo-primary {
  transition: background-color 120ms linear;
}
.fo-primary:hover {
  background: #d8cfc1 !important;
}
.fo-primary:active {
  transform: translateY(1px);
}
.fo-outline:hover {
  background: #221e1c !important;
}
.fo-outline:active {
  background: #2a2523 !important;
}
.fo-text:hover {
  color: #f0c3b8 !important;
}
.fo-row:hover {
  background: #221e1c;
}
textarea::placeholder {
  color: #a09585;
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
  }
  .fo-star:active svg,
  .fo-primary:active {
    transform: none;
  }
}
```

### Why these helmet rules exist

- Inline styles beat stylesheet rules. Hover fills and colours on inline-styled elements therefore need `!important`.
- The star hover works through the SVG presentation attribute `fill="none"`. A selected star (`fill="#1F5E78"`) never hover-darkens.
- Classes:
  - `fo-primary`: graphite filled buttons and the Google link-button.
  - `fo-outline`: outline buttons.
  - `fo-text`: accent text buttons and links.
  - `fo-row`: index rows and the 'Your response' disclosure row.
  - `fo-star`: star labels.

### Root, grain and script

```html
<main style="width: 390px; height: 844px; box-sizing: border-box; overflow: hidden; position: relative; isolation: isolate; display: flex; flex-direction: column; padding: 12px 24px 0 28px; background: #F3EEE4; color: #1D2528; font-family: 'Sofia Sans', system-ui, sans-serif; font-optical-sizing: auto; font-kerning: normal;">
  <svg aria-hidden="true" focusable="false" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .03; mix-blend-mode: multiply; z-index: -1;"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"></feTurbulence><feColorMatrix type="saturate" values="0"></feColorMatrix></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>
  <!-- letterhead, body wrapper, … -->
</main>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
```

- **Height.** Replace both 844s (root `height` and `$preview.height`) with the board height: B2 930, B3 1400, B4 1300, B5 844, B6 1060.
- **Grain.**
  - `isolation: isolate` on the root plus `z-index: -1` on the grain keeps the grain above the paper but beneath all content, as the brief requires.
  - Night: root `background: #1A1716; color: #EDE5D8;`. Grain `opacity: .04; mix-blend-mode: screen;`.
- **Rating boards (B1, B5).** The script returns the handler:

  ```js
  return {
    holdSubmit: function (event) {
      event.preventDefault()
    },
  }
  ```

---

## 2. Board skeletons and y-maps

The letterhead occupies 12–218 on every board. Everything after it sits in ONE body wrapper.

**Arrival (B1, B5):**

```html
<div
  style="display: flex; flex-direction: column; gap: 32px; padding-top: 20px; flex: none;"
>
  [rating form] [analytics section] [B5 only: standfirst]
</div>
[B1 only: figure with padding-top 50]
```

- B1:
  - Form 238–502.
  - Analytics 534–638.
  - Figure 688–844.
- B5:
  - Legend on 2 lines, 238–302.
  - Stars 322–378.
  - Endpoints 384–402.
  - Error 410–434.
  - Submit 450–502.
  - Privacy 514–534.
  - Hairline 566.
  - Analytics text 582–642 (3 lines).
  - Row 646–690.
  - Standfirst 722.

**After rating (B2, B3, B4, B6):**

```html
<div
  style="display: flex; flex-direction: column; gap: 24px; padding-top: 20px; flex: none;"
>
  [stub] [google panel] …
</div>
```

| Board     | Blocks in order (EN y)                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2 (930)  | Stub 238–378 · Google 402–633 · Letter collapsed 657–825 · Your response collapsed 849–905                                                                                                        |
| B3 (1400) | Stub · Google · Your response collapsed 657–713 · Figure (`padding-top: 8px`) img 745–901 · Standfirst 925–1009 · Index (`padding-top: 36px`) head 1069–1085, rows 1093–1301 · Colophon 1325–1393 |
| B4 (1300) | Stub · Google · Note-sent line 657–701 · Your response expanded 725–1296 (see section 13)                                                                                                         |
| B6 (1060) | Stub · Google · Letter expanded 657–1025                                                                                                                                                          |

The Google panel's box is 402–633 on B2, B3, B4 and B6. It is never moved or restyled.

---

## 3. Letterhead: B.top, wordmark and Oxford rule (12–218)

```html
<header style="display: flex; flex-direction: column; gap: 20px; flex: none;">
  <div
    style="display: flex; align-items: center; justify-content: space-between; height: 44px;"
  >
    <h1
      style="margin: 0; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 12px; line-height: 16px; letter-spacing: 0.16em; text-transform: uppercase; color: #1F5E78;"
    >
      The Terrace
    </h1>
    <nav
      aria-label="Language"
      style="display: flex; align-items: center; margin-right: -12px;"
    >
      <a
        href="#"
        hreflang="en"
        aria-current="true"
        style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 14px; line-height: 20px; color: #1D2528; text-decoration: underline; text-decoration-color: #1F5E78; text-decoration-thickness: 1px; text-underline-offset: 5px;"
        >EN<span class="sr-only"> English</span></a
      >
      <span
        aria-hidden="true"
        style="width: 1px; height: 14px; background: #CCC3B3;"
      ></span>
      <a
        href="#"
        hreflang="bg"
        lang="bg"
        style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 14px; line-height: 20px; color: #4A5356; text-decoration: none;"
        >БГ<span class="sr-only"> Български</span></a
      >
    </nav>
  </div>
  <p
    translate="no"
    style="margin: 0; font-family: 'Playfair', Georgia, serif; font-weight: 500; font-size: 56px; line-height: 58px; letter-spacing: -0.015em; color: #1D2528; text-wrap: balance;"
  >
    The Harbor<br />Hotel
  </p>
  <div
    aria-hidden="true"
    style="box-sizing: border-box; height: 6px; border-top: 2px solid #1D2528; border-bottom: 1px solid #1D2528;"
  ></div>
</header>
```

- **Kicker.** Type 'The Terrace' in title case. CSS sets the capitals, so screen readers do not spell it out. The kicker is the page's only h1.
- **Nav overhang.** The `-12px` pulls the centred 'БГ' glyphs flush with x366 while keeping 44×44 targets.
- **Wordmark.** Always a `<p translate="no">` with an explicit `<br>` at the balanced break.
- **Oxford rule.** 2px line, 3px gap, 1px line = 6px (212–218).
- **B5 (night, BG):**
  - Kicker text `Дегустационна зала`, colour #E3A597.
  - `<nav aria-label="Език">`.
  - The EN link loses `aria-current`, gains `lang="en"`, colour #B9AE9F, `text-decoration: none`.
  - The БГ link gets `aria-current="true"`, colour #EDE5D8, underline colour #D98E7E.
  - Divider #3C3835.
  - Wordmark `Винарна<br>Велмира` in #EDE5D8.
  - Oxford rule borders #EDE5D8.

---

## 4. Rating block (form)

This is exactly as in B1. The form sits first inside the arrival body wrapper.

```html
<form
  onSubmit="{{ holdSubmit }}"
  style="display: flex; flex-direction: column; gap: 12px;"
>
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <fieldset style="margin: 0; padding: 0; border: 0; min-width: 0;">
      <legend
        style="padding: 0 0 20px; font-family: 'Playfair', Georgia, serif; font-weight: 400; font-size: 26px; line-height: 32px; color: #1D2528; text-wrap: balance;"
      >
        How was your experience?
      </legend>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="position: relative; display: flex; gap: 8px;">
          <!-- ×5, n = 1..5 -->
          <input type="radio" name="rating" value="1" id="r1" class="sr-only" />
          <label
            for="r1"
            class="fo-star"
            style="display: flex; align-items: center; justify-content: center; flex: none; width: 56px; height: 56px; border-radius: 2px; cursor: pointer;"
            ><svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#7D7F7D"
              stroke-width="1.2"
              stroke-linejoin="round"
              stroke-linecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
              /></svg
            ><span class="sr-only">1 star, Poor</span></label
          >
          <!-- … r2 "2 stars, Fair", r3 "3 stars, Good", r4 "4 stars, Very good", r5 "5 stars, Excellent" -->
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div
            aria-hidden="true"
            style="display: flex; justify-content: space-between; width: 312px; font-size: 13px; line-height: 18px; color: #5F676A;"
          >
            <span>Poor</span><span>Excellent</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; height: 24px;">
            <!-- CAPTION SLOT: see the states below -->
            <p
              id="rating-error"
              role="alert"
              style="display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 600; font-size: 14px; line-height: 20px; color: #1D2528;"
            ></p>
          </div>
        </div>
      </div>
    </fieldset>
    <button
      type="submit"
      class="fo-primary"
      aria-describedby="privacy-line"
      style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; height: 52px; padding: 0 24px; border: 0; border-radius: 2px; background: #1D2528; color: #F3EEE4; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 17px; line-height: 20px; cursor: pointer;"
    >
      Send privately
    </button>
  </div>
  <p
    id="privacy-line"
    style="margin: 0; font-size: 14px; line-height: 20px; color: #4A5356;"
  >
    Shared privately with The Harbor Hotel.
  </p>
</form>
```

**Geometry (EN).**

| Element      | y                         |
| ------------ | ------------------------- |
| Legend       | 238–270 (plus 20 padding) |
| Stars        | 290–346                   |
| Endpoints    | 352–370                   |
| Caption slot | 378–402                   |
| Submit       | 418–470                   |
| Privacy      | 482–502                   |

- **Star row.** Labels x28–340 (5×56 + 4×8). Endpoints span the same 312px.
- **BG legend.** `Как беше<br>преживяването ви?` becomes 2 lines (+32), and everything below moves +32.

### States

**Idle.** As above. SVG `fill="none" stroke="#7D7F7D" stroke-width="1.2"`. The caption slot holds only the empty alert `<p>`.

**Selected** (example: 4 = Very good).

- Add `checked` to `#r4`.
- Stars 1–4 become `fill="#1F5E78" stroke="#1F5E78" stroke-width="1.4"`. Star 5 stays idle.
- Put this BEFORE the empty alert `<p>` in the slot:

```html
<span
  aria-hidden="true"
  style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; line-height: 16px; letter-spacing: 0.14em; text-transform: uppercase; color: #1F5E78;"
  ><span style="width: 16px; height: 1px; background: #1F5E78;"></span>Very good</span
>
```

**Error** (B5, nothing selected, send pressed).

- Every radio gets `aria-invalid="true" aria-describedby="rating-error"`.
- The alert `<p>` is filled. Night colours are shown; day uses icon #1F5E78 and text #1D2528.

```html
<p
  id="rating-error"
  role="alert"
  style="display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 600; font-size: 14px; line-height: 20px; color: #EDE5D8;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#E3A597"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    style="flex: none;"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" /></svg
  >Изберете оценка от 1 до 5 звезди.
</p>
```

**BG copy (B5).**

- sr labels: '1 звезда, Слабо', '2 звезди, Задоволително', '3 звезди, Добро', '4 звезди, Много добро', '5 звезди, Отлично'.
- Endpoints: 'Слабо' / 'Отлично'.
- Submit: 'Изпрати поверително'.
- Privacy line: 'Споделя се поверително с Винарна Велмира.'

**Night colours (B5).**

- Idle stroke #8E8881.
- Legend #EDE5D8.
- Endpoints #A09585.
- Submit bg #EDE5D8, label #1A1716.
- Privacy line #B9AE9F.

---

## 5. Analytics region (534–638 on B1)

```html
<section
  aria-label="Portal analytics information"
  style="display: flex; flex-direction: column; gap: 4px; padding-top: 15px; border-top: 1px solid #CCC3B3;"
>
  <p
    style="margin: 0; font-size: 14px; line-height: 20px; color: #4A5356; text-wrap: pretty;"
  >
    This page counts visits for The Harbor Hotel. No ads or third-party trackers.
  </p>
  <div
    style="display: flex; align-items: center; justify-content: space-between; height: 44px;"
  >
    <a
      href="#"
      class="fo-text"
      style="display: flex; align-items: center; height: 44px; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 14px; line-height: 20px; color: #1F5E78; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px;"
      >Privacy notice</a
    >
    <button
      type="button"
      class="fo-text"
      style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 44px; height: 44px; padding: 0 8px; margin-right: -8px; border: 0; background: transparent; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 14px; line-height: 20px; color: #1F5E78; cursor: pointer;"
    >
      Got it
    </button>
  </div>
</section>
```

- **Layout.** Hairline at the section's top edge. Text starts 16 below it. The action row follows 4 below the text.
- **B5 (night, BG):**
  - `aria-label="Информация за отчитането на посещенията"`. Localized, because the whole page follows the chosen language.
  - Border #3C3835.
  - Text #B9AE9F, 3 lines: 'Тази страница отчита посещенията за Винарна Велмира. Без реклами и без проследяване от трети страни.'
  - Link 'Поверителност' #E3A597.
  - Button 'Разбрах' #E3A597.
- **After-rating boards** omit the region (dismissed).

---

## 6. Text-button vocabulary

| Name                                 | Used for                                        | Style                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Text action** (underlined)         | 'Change', 'Remove', 'Remove…'                   | `class="fo-text"`; `flex: none; box-sizing: border-box; min-width: 44px; height: 44px; padding: 0; border: 0; background: transparent; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; color: #1F5E78; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: pointer;` |
| **Quiet text button** (no underline) | 'Got it' 14px, 'Not now' 16px, 'Keep them' 15px | as above without the underline, `padding: 0 8px`, and `margin-right: -8px` when it ends a row flush right                                                                                                                                                                                                                                                                |
| **Link** (underlined)                | 'Privacy notice'                                | as the analytics link                                                                                                                                                                                                                                                                                                                                                    |

Accessible names extend the visible label with sr-only text:

- `Change<span class="sr-only"> your rating</span>`
- `Remove<span class="sr-only"> your note</span>`
- `Remove…<span class="sr-only"> your rating and note</span>`

---

## 7. Buttons

```html
<!-- PRIMARY 52 (submit, Send note privately). Width 100% for submit; auto with padding 0 24px otherwise. -->
<button
  type="button"
  class="fo-primary"
  style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; height: 52px; padding: 0 24px; border: 0; border-radius: 2px; background: #1D2528; color: #F3EEE4; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 17px; line-height: 20px; cursor: pointer;"
>
  Send note privately
</button>

<!-- PRIMARY 48 compact (inline confirm only) -->
<button
  type="button"
  class="fo-primary"
  style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; height: 48px; padding: 0 18px; border: 0; border-radius: 2px; background: #1D2528; color: #F3EEE4; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 15px; line-height: 20px; cursor: pointer;"
>
  Remove rating and note
</button>

<!-- OUTLINE 48, full column (Write a private note, Start over on this device) -->
<button
  type="button"
  class="fo-outline"
  style="display: flex; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; width: 100%; height: 48px; padding: 0 20px; border: 1px solid #1D2528; border-radius: 2px; background: transparent; color: #1D2528; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; cursor: pointer;"
>
  [16px icon, stroke #1D2528]Label
</button>
```

---

## 8. Stub: 'Thank you.' and the receipt row (238–378)

```html
<section
  aria-labelledby="stub-title"
  style="display: flex; flex-direction: column; flex: none;"
>
  <div
    aria-hidden="true"
    style="height: 1px; background: repeating-linear-gradient(90deg, #1D2528 0 4px, transparent 4px 8px);"
  ></div>
  <div style="display: flex; flex-direction: column; gap: 16px; padding: 23px 0;">
    <h2
      id="stub-title"
      tabindex="-1"
      style="margin: 0; font-family: 'Playfair', Georgia, serif; font-weight: 400; font-size: 26px; line-height: 32px; color: #1D2528;"
    >
      Thank you.
    </h2>
    <p role="status" class="sr-only">Rating sent privately</p>
    <div style="display: flex; align-items: center; gap: 10px; height: 44px;">
      <span aria-hidden="true" style="display: flex; gap: 2px; flex: none;">
        <!-- FILLED mini star (repeat for 1..n) -->
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="#1F5E78"
          stroke="#1F5E78"
          stroke-width="1.6"
          stroke-linejoin="round"
          focusable="false"
        >
          <path
            d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
          />
        </svg>
        <!-- IDLE mini star (repeat for n+1..5) -->
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#7D7F7D"
          stroke-width="1.6"
          stroke-linejoin="round"
          focusable="false"
        >
          <path
            d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"
          />
        </svg>
      </span>
      <p
        style="flex: 1; min-width: 0; margin: 0; font-size: 16px; line-height: 22px; color: #1D2528;"
      >
        Fair · sent privately
      </p>
      <button
        type="button"
        class="fo-text"
        style="flex: none; box-sizing: border-box; min-width: 44px; height: 44px; padding: 0; border: 0; background: transparent; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; color: #1F5E78; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: pointer;"
      >
        Change<span class="sr-only"> your rating</span>
      </button>
    </div>
  </div>
  <div
    aria-hidden="true"
    style="height: 1px; background: repeating-linear-gradient(90deg, #1D2528 0 4px, transparent 4px 8px);"
  ></div>
</section>
```

- **Positions.**
  - Perforations at 238 and 377.
  - h2 262–294.
  - Receipt 310–354.
  - Box 238–378.
- **Status line.** The sr-only status is absolutely positioned, so it adds no gap.
- **Receipt word by score.** B2, B4 and B6: 2 filled, 'Fair'. B3: 5 filled, 'Excellent'.
- **No date or time, ever.**

---

## 9. Google panel (402–633, identical on B2, B3, B4 and B6)

```html
<section
  aria-labelledby="google-title"
  style="display: flex; flex-direction: column; gap: 20px; flex: none; padding: 20px 0 21px; border-top: 3px double #1D2528; border-bottom: 3px double #1D2528;"
>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <h2
      id="google-title"
      style="margin: 0; font-family: 'Playfair', Georgia, serif; font-weight: 500; font-size: 24px; line-height: 30px; color: #1D2528;"
    >
      Share your experience on Google
    </h2>
    <p
      style="margin: 0; font-size: 16px; line-height: 24px; color: #4A5356; text-wrap: pretty;"
    >
      If you’d like, you can also leave a public review on Google.
    </p>
  </div>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <a
      href="#"
      target="_blank"
      rel="noopener noreferrer"
      class="fo-primary"
      style="display: flex; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; height: 52px; padding: 0 24px; border-radius: 2px; background: #1D2528; color: #F3EEE4; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 17px; line-height: 20px; text-decoration: none;"
      >Continue to Google<svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#F3EEE4"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
        style="flex: none;"
      >
        <path d="M7 17L17 7M9 7h8v8" /></svg
      ><span class="sr-only"> (opens Google)</span></a
    >
    <p style="margin: 0; font-size: 13px; line-height: 18px; color: #5F676A;">
      Opens Google · you may need to sign in
    </p>
  </div>
</section>
```

- **Positions.**
  - Double rules 402–405 and 630–633.
  - h2 425–455.
  - Body 463–511 (2 lines).
  - Button 531–583.
  - Subline 591–609.
  - Total 231.
- **Title.** The brief measured it as one line. Never add `white-space: nowrap`.
- **Invariance.** The panel takes no score input. The same markup appears on every board.

### Degraded (same slot and frame, no link, no URL, no disabled control)

```html
<section
  aria-labelledby="google-title"
  style="display: flex; flex-direction: column; gap: 8px; flex: none; box-sizing: border-box; min-height: 231px; padding: 20px 0 21px; border-top: 3px double #1D2528; border-bottom: 3px double #1D2528;"
>
  <h2
    id="google-title"
    style="margin: 0; font-family: 'Playfair', Georgia, serif; font-weight: 500; font-size: 24px; line-height: 30px; color: #1D2528; text-wrap: balance;"
  >
    Google can’t be opened from here right now
  </h2>
  <p style="margin: 0; font-size: 16px; line-height: 24px; color: #4A5356;">
    Your rating reached The Harbor Hotel privately. Thank you.
  </p>
</section>
```

`min-height: 231px` holds the slot, so nothing below moves between the live and degraded states.

---

## 10. Private note: the letter

### Collapsed (657–825, 3 stars or below only, always after Google)

```html
<section
  aria-labelledby="letter-title"
  style="display: flex; flex-direction: column; gap: 20px; padding-bottom: 20px; flex: none;"
>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <h2
      id="letter-title"
      style="margin: 0; font-family: 'Playfair', Georgia, serif; font-weight: 500; font-size: 22px; line-height: 28px; color: #1D2528;"
    >
      Add a private note for the team
    </h2>
    <p style="margin: 0; font-size: 15px; line-height: 22px; color: #4A5356;">
      Optional.<br />Shared privately with The Harbor Hotel.
    </p>
  </div>
  <button
    type="button"
    class="fo-outline"
    aria-expanded="false"
    aria-controls="note-composer"
    style="display: flex; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; width: 100%; height: 48px; padding: 0 20px; border: 1px solid #1D2528; border-radius: 2px; background: transparent; color: #1D2528; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; cursor: pointer;"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#1D2528"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      style="flex: none;"
    >
      <path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg
    >Write a private note
  </button>
</section>
```

- **Positions.** h2 657–685, body 693–737 (the `<br>` guarantees the 2 lines the brief budgets), button 757–805, and 20 below.

### Expanded composer (B6, from 657; ends 1025)

```html
<section
  id="note-composer"
  aria-labelledby="letter-title"
  style="display: flex; flex-direction: column; gap: 16px; flex: none;"
>
  <h2
    id="letter-title"
    style="margin: 0; font-family: 'Playfair', Georgia, serif; font-weight: 500; font-size: 22px; line-height: 28px; color: #1D2528;"
  >
    Add a private note for the team
  </h2>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <label
      for="note"
      style="font-weight: 600; font-size: 14px; line-height: 20px; color: #1D2528;"
      >Your note (optional)</label
    >
    <textarea
      id="note"
      name="note"
      rows="6"
      maxlength="2000"
      placeholder="What should the team know?"
      aria-describedby="note-helper"
      style="display: block; box-sizing: border-box; width: 100%; height: 192px; margin: 0; padding: 0 0 0 2px; border: 0; border-top: 1px solid #1D2528; border-bottom: 1px solid #1D2528; border-radius: 0; background-color: transparent; background-image: repeating-linear-gradient(180deg, transparent 0 31px, #CCC3B3 31px 32px); font-family: 'Sofia Sans', system-ui, sans-serif; font-size: 17px; line-height: 32px; color: #1D2528; resize: none; outline: 2px solid #1F5E78; outline-offset: 4px;"
    >
The room was lovely. Breakfast ran out of fresh bread by half past nine, and the terrace tables weren’t cleared until late.</textarea>
    <p
      id="note-helper"
      style="margin: 0; font-size: 14px; line-height: 20px; color: #5F676A;"
    >
      No need to include your name.
    </p>
  </div>
  <div style="display: flex; align-items: center; gap: 16px; padding-top: 8px;">
    <button
      type="button"
      class="fo-primary"
      style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; height: 52px; padding: 0 24px; border: 0; border-radius: 2px; background: #1D2528; color: #F3EEE4; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 17px; line-height: 20px; cursor: pointer;"
    >
      Send note privately
    </button>
    <button
      type="button"
      class="fo-text"
      style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 44px; height: 44px; padding: 0 8px; border: 0; background: transparent; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; color: #1F5E78; cursor: pointer;"
    >
      Not now
    </button>
  </div>
</section>
```

- **Positions.**
  - h2 657–685.
  - Label 701–721.
  - Textarea 729–921: rules at 761, 793, 825, 857 and 889, with the bottom border as the sixth baseline.
  - Helper 929–949.
  - Actions 973–1025.
- **Focus.** The ring is drawn inline (`outline … offset 4px`) because the board depicts focus. Remove it on any board where the textarea is not focused.
- **Counter.** Hidden (under 1,800 characters). When shown, it goes in the helper row, right-aligned, 14/20 #5F676A: '{n} characters left'.
- **No contact fields.**

### Note-sent line (B4, 657–701)

```html
<p
  role="status"
  style="display: flex; align-items: flex-start; gap: 10px; margin: 0; flex: none; font-size: 15px; line-height: 22px; color: #1D2528;"
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#1F5E78"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    style="flex: none; margin-top: 3px;"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" /></svg
  ><span>Your note was sent privately to The Harbor Hotel.</span>
</p>
```

---

## 11. 'Your response' disclosure

### Collapsed (56px; B2 849–905, B3 657–713)

```html
<div style="flex: none;">
  <h2 style="margin: 0; font: inherit;">
    <button
      type="button"
      class="fo-row"
      aria-expanded="false"
      aria-controls="yr-panel"
      style="display: flex; align-items: center; justify-content: space-between; gap: 16px; box-sizing: border-box; width: 100%; height: 56px; padding: 0; border: 0; border-top: 1px solid #CCC3B3; border-bottom: 1px solid #CCC3B3; background: transparent; text-align: left; cursor: pointer; font-family: 'Sofia Sans', system-ui, sans-serif; color: #1D2528;"
    >
      <span style="display: flex; flex-direction: column;">
        <span
          style="font-weight: 600; font-size: 16px; line-height: 24px; color: #1D2528;"
          >Your response</span
        >
        <span
          style="font-weight: 400; font-size: 14px; line-height: 20px; color: #5F676A;"
          >Change, remove or start over</span
        >
      </span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1F5E78"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
        style="flex: none;"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  </h2>
</div>
```

### Expanded (B4, from 725)

```html
<div style="display: flex; flex-direction: column; flex: none;">
  <h2 style="margin: 0; font: inherit;">
    <button
      type="button"
      class="fo-row"
      aria-expanded="true"
      aria-controls="yr-panel"
      style="display: flex; align-items: center; justify-content: space-between; gap: 16px; box-sizing: border-box; width: 100%; height: 44px; padding: 0; border: 0; border-top: 1px solid #CCC3B3; background: transparent; text-align: left; cursor: pointer; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 24px; color: #1D2528;"
    >
      Your response<svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1F5E78"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
        style="flex: none; transform: rotate(180deg);"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  </h2>
  <ul
    id="yr-panel"
    role="list"
    style="margin: 0; padding: 0; list-style: none; border-bottom: 1px solid #CCC3B3;"
  >
    <!-- ROW WITH ACTION (69px) -->
    <li
      style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid #CCC3B3;"
    >
      <div style="display: flex; flex-direction: column; min-width: 0;">
        <p
          style="margin: 0; font-weight: 600; font-size: 16px; line-height: 24px; color: #1D2528;"
        >
          Change your rating
        </p>
        <p style="margin: 0; font-size: 14px; line-height: 20px; color: #5F676A;">
          Until 15:32 today, Sofia time
        </p>
      </div>
      <button
        type="button"
        class="fo-text"
        style="flex: none; box-sizing: border-box; min-width: 44px; height: 44px; padding: 0; border: 0; background: transparent; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; color: #1F5E78; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: pointer;"
      >
        Change<span class="sr-only"> your rating</span>
      </button>
    </li>

    <!-- Row 2: same shape. 'Remove your note' · 'Until 14:32 tomorrow' · Remove<span class="sr-only"> your note</span> -->

    <!-- ROW WITH INLINE CONFIRM OPEN (the 'Remove…' action is replaced by the box) -->
    <li
      style="display: flex; flex-direction: column; gap: 12px; padding: 12px 0; border-top: 1px solid #CCC3B3;"
    >
      <div style="display: flex; flex-direction: column;">
        <p
          style="margin: 0; font-weight: 600; font-size: 16px; line-height: 24px; color: #1D2528;"
        >
          Remove your rating and note
        </p>
        <p style="margin: 0; font-size: 14px; line-height: 20px; color: #5F676A;">
          Until 14:32 tomorrow
        </p>
      </div>
      <div
        role="group"
        aria-labelledby="yr-confirm-text"
        style="display: flex; flex-direction: column; gap: 12px; padding: 16px; background: #F8F4EC; border-left: 2px solid #1D2528;"
      >
        <p
          id="yr-confirm-text"
          style="margin: 0; font-size: 15px; line-height: 22px; color: #1D2528;"
        >
          Remove both? The Harbor Hotel will no longer see your rating or note. Anything
          you posted on Google isn’t affected.
        </p>
        <div style="display: flex; align-items: center; gap: 16px;">
          <button
            type="button"
            class="fo-primary"
            style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; height: 48px; padding: 0 18px; border: 0; border-radius: 2px; background: #1D2528; color: #F3EEE4; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 15px; line-height: 20px; cursor: pointer;"
          >
            Remove rating and note
          </button>
          <button
            type="button"
            class="fo-text"
            style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 44px; height: 44px; padding: 0 4px; border: 0; background: transparent; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 15px; line-height: 20px; color: #1F5E78; cursor: pointer; outline: 2px solid #1F5E78; outline-offset: 3px;"
          >
            Keep them
          </button>
        </div>
      </div>
    </li>

    <!-- SHARED-DEVICE ROW -->
    <li
      style="display: flex; flex-direction: column; gap: 12px; padding: 12px 0; border-top: 1px solid #CCC3B3;"
    >
      <div style="display: flex; flex-direction: column;">
        <p
          style="margin: 0; font-weight: 600; font-size: 16px; line-height: 24px; color: #1D2528;"
        >
          Shared phone or tablet?
        </p>
        <p style="margin: 0; font-size: 14px; line-height: 20px; color: #5F676A;">
          Start over so the next guest begins with a fresh page.
        </p>
      </div>
      <button
        type="button"
        class="fo-outline"
        style="display: flex; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; width: 100%; height: 48px; padding: 0 20px; border: 1px solid #1D2528; border-radius: 2px; background: transparent; color: #1D2528; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 16px; line-height: 20px; cursor: pointer;"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#1D2528"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
          style="flex: none;"
        >
          <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg
        >Start over on this device
      </button>
    </li>
  </ul>
</div>
```

- **Confirm closed.** Use the "row with action" shape with `Remove…<span class="sr-only"> your rating and note</span>`. Its meta is 'Until 14:32 tomorrow. Anything you posted on Google isn’t affected.'
- **Keep them.** It carries a drawn focus ring because focus moves there when the confirm opens. Remove the inline outline elsewhere.
- **Start-over done state** (not drawn in B). The row's content is replaced by `<p role="status">` with a check icon and 'This device is ready for the next guest.'

---

## 12. Index: useful links (B3: head 1069–1085, rows 1093–1301)

```html
<section
  aria-labelledby="index-title"
  style="display: flex; flex-direction: column; gap: 8px; padding-top: 36px; flex: none;"
>
  <div style="display: flex; align-items: center; gap: 12px;">
    <h2
      id="index-title"
      style="margin: 0; flex: none; font-family: 'Sofia Sans', system-ui, sans-serif; font-weight: 600; font-size: 12px; line-height: 16px; letter-spacing: 0.16em; text-transform: uppercase; color: #5F676A;"
    >
      Also useful
    </h2>
    <span aria-hidden="true" style="flex: 1; height: 1px; background: #CCC3B3;"></span>
  </div>
  <ol role="list" style="margin: 0; padding: 0; list-style: none;">
    <li>
      <a
        href="#"
        class="fo-row"
        style="display: flex; align-items: center; gap: 8px; box-sizing: border-box; height: 52px; border-bottom: 1px solid #CCC3B3; color: #1D2528; text-decoration: none;"
        ><span
          aria-hidden="true"
          style="flex: none; width: 24px; font-weight: 600; font-size: 13px; line-height: 16px; font-variant-numeric: tabular-nums; color: #1F5E78;"
          >01</span
        ><span
          style="flex: none; font-weight: 600; font-size: 17px; line-height: 24px; color: #1D2528;"
          >Breakfast &amp; bar menu</span
        ><span
          aria-hidden="true"
          style="flex: 1; min-width: 16px; height: 0; border-bottom: 1px dotted #9C9486;"
        ></span
        ><span style="flex: none; font-size: 14px; line-height: 20px; color: #4A5356;"
          >Menu</span
        ><svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#1F5E78"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
          style="flex: none;"
        >
          <path d="M7 17L17 7M9 7h8v8" /></svg
      ></a>
    </li>
    <!-- 02 Book your next stay · Booking | 03 Getting here · Map | 04 Harbour walks · Guide -->
  </ol>
</section>
```

- **Numeral cell.** 24 wide plus the 8 gap gives the 32px numeral column, so labels start at x60.
- **Leader.** It sits on the row's centre line, about 6px above the label baseline.
- **Wrapped label.** If a label wraps, drop the leader span and stack the category under the label. The row then grows and loses its fixed height.
- **Padding.** `padding-top: 36px` is B3's section break. It is a gap of 24 plus 36, which equals 60.

---

## 13. B4 fit-checked positions (Your response expanded)

The brief's numbers put the confirm box at 961. That leaves no room for the row's title and meta lines (944–964 at minimum). With 12px row padding, the whole panel fits inside 1300 and keeps the brief's order:

| Element                           | y                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Note-sent line                    | 657–701                                                                                                            |
| Header row                        | 725–769 (hairline at 725)                                                                                          |
| Row 'Change your rating'          | 769–838                                                                                                            |
| Row 'Remove your note'            | 838–907                                                                                                            |
| Row 'Remove your rating and note' | 907–1146: title 920–944, meta 944–964, confirm box 976–1134 (padding 16, 3 text lines 992–1058, actions 1070–1118) |
| Row 'Shared phone or tablet?'     | 1146–1295: title 1159–1183, meta 1183–1223 (2 lines), button 1235–1283                                             |
| Panel bottom hairline             | 1295–1296                                                                                                          |
| Board end                         | 1300                                                                                                               |

---

## 14. Figure and standfirst

```html
<!-- B1: padding-top 50px (688–844). B3: padding-top 8px (745–901). -->
<figure style="margin: 0; padding-top: 8px; flex: none;">
  <img
    src="/_blob/b3a88efd1b67797584d1b92e821185d4"
    alt="Sea-view terrace at The Harbor Hotel"
    width="338"
    height="156"
    style="display: block; width: 338px; height: 156px; object-fit: cover; object-position: 50% 50%;"
  />
</figure>

<!-- Standfirst. Day #4A5356; night #B9AE9F. -->
<p
  style="margin: 0; flex: none; font-size: 18px; line-height: 28px; color: #4A5356; text-wrap: pretty;"
>
  Twelve rooms above the old harbour, a terrace that faces the island, and coffee until
  the last boat comes in.
</p>
```

- **B5 standfirst:** `Малки изби, дълги вечери и чаша за всеки въпрос. Благодарим, че седнахте при нас.` It is the third child of the arrival wrapper (gap 32, starting at 722). Do not give it a fixed height.

---

## 15. Colophon / footer (B3: 1325–1393)

```html
<footer style="display: flex; flex-direction: column; gap: 12px; flex: none;">
  <div
    aria-hidden="true"
    style="box-sizing: border-box; height: 6px; border-top: 2px solid #1D2528; border-bottom: 1px solid #1D2528;"
  ></div>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <p
      translate="no"
      style="margin: 0; font-family: 'Playfair', Georgia, serif; font-weight: 500; font-size: 20px; line-height: 26px; color: #1D2528;"
    >
      The Harbor Hotel
    </p>
    <p style="margin: 0; font-size: 12px; line-height: 16px; color: #5F676A;">
      <a
        href="#"
        class="fo-text"
        style="display: inline-block; padding: 14px 0; margin: -14px 0; color: #5F676A; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px;"
        >Privacy notice</a
      >
      · Made with Reputation Key
    </p>
  </div>
</footer>
```

- **Positions.** Oxford rule 1325–1331, name 1343–1369, line 1377–1393.
- **Tap target.** The link's `padding 14 / margin -14` gives a 44px-tall target without moving the 16px line.

---

## 16. Night edition: colour substitutions (B5)

Keep the geometry and markup identical and swap only these values.

| Role                                                               | Day                                                   | Night                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| Stage (root bg)                                                    | #F3EEE4                                               | #1A1716                                               |
| Grain                                                              | .03 multiply                                          | .04 screen                                            |
| Text, Oxford / double rules, perforations, outline borders         | #1D2528                                               | #EDE5D8                                               |
| Text 2: standfirst, body, privacy, analytics                       | #4A5356                                               | #B9AE9F                                               |
| Text 3: endpoints, meta, sublines, footer                          | #5F676A                                               | #A09585                                               |
| Accent strokes: selected stars, icons, caption rule                | #1F5E78                                               | #D98E7E                                               |
| Accent text: kicker, links, text buttons, caption word, error icon | #1F5E78                                               | #E3A597                                               |
| Idle star                                                          | #7D7F7D                                               | #8E8881                                               |
| Hairline                                                           | #CCC3B3                                               | #3C3835                                               |
| Leader                                                             | #9C9486                                               | #6B645C                                               |
| Primary fill / label                                               | #1D2528 / #F3EEE4                                     | #EDE5D8 / #1A1716                                     |
| Primary hover                                                      | #2C373B                                               | #D8CFC1                                               |
| Confirm box / raised                                               | #F8F4EC                                               | #221E1C                                               |
| Pressed                                                            | #ECE5D8                                               | #2A2523                                               |
| Focus ring                                                         | #1F5E78                                               | #F0C3B8                                               |
| Language nav                                                       | current #1D2528 with #1F5E78 underline; other #4A5356 | current #EDE5D8 with #D98E7E underline; other #B9AE9F |

---

## 17. Icon strings

All icons use 24 viewBox, stroke 1.5, round caps and joins, `aria-hidden="true" focusable="false"`, and are shown at 16px.

| Icon                          | Markup                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| external / arrow-up-right     | `<path d="M7 17L17 7M9 7h8v8"/>`                                                                         |
| chevron                       | `<path d="M6 9l6 6 6-6"/>` (up = `style="transform: rotate(180deg);"`)                                   |
| pencil                        | `<path d="M4 20h4L19 9l-4-4L4 16v4z"/>`                                                                  |
| alert / info                  | `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`                                           |
| check                         | `<path d="M5 12.5l4.5 4.5L19 7.5"/>`                                                                     |
| rotate-left                   | `<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>`                                                            |
| star (rating 36px, mini 14px) | `<path d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z"/>` |
