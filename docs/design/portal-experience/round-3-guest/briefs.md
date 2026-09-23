# Round 3 build briefs

> Amended after review. The Bulgarian A5 property is now "Сарива Спа", so its carved initial is С. The glossary also changed: the Google-unavailable body drops the second thank-you, and every deadline carries ", Sofia time". See "Decided during review" in [README.md](README.md#decided-during-review). The specs below are as written before the boards were built.

These are the specs the boards were built from. The shared rules come first, then one section per direction. Positions are CSS px on a 390-wide phone.

## Shared rules

- **Canvas.** Every artboard is 390 CSS px wide. Each arrival board is exactly 390x844, with its root element fixed to the board size (matching $preview) and overflow hidden. Other boards may be taller, up to 1400. Never draw a status bar, keyboard, notch or device frame. Use the file names given (A1-arrival.dc.html and so on). <html lang> matches the copy (en or bg).
- **First-screen gate.** On every arrival board the question, all five stars, the endpoint words, the caption slot and the submit button are fully visible, and the submit's bottom edge is at y640 or less. Safari on a 390x844 phone shows about 664px. The production gate is 548px or less at 375x667 with Safari toolbars, and 320px width, in EN and BG. Only property identity and the placement line may sit above the question: no gate, splash, overlay, platform grid or video.
- **One rating core.** A <fieldset> whose <legend> is the question. Five sr-only radios (name="rating"), each with a visible 56x56 or larger <label> holding a star SVG and sr-only text ('1 star, Poor'). Endpoint words are visible and aria-hidden. A caption slot is always reserved so nothing shifts. Tapping a star never submits, redirects or opens Google. The explicit submit is always enabled. Selected stars show fill plus a heavier stroke (never hue alone). Idle outlines are at least 3:1 against their surface.
- **Shared star path.** viewBox 0 0 24 24, stroke-linejoin round:
  `M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z`
  Mini receipt stars reuse it at 14–16px.
- **Shared icon set.** 24px viewBox, 1.5 stroke, round caps and joins, aria-hidden, always next to real text:
  - external arrow: `M7 17L17 7M9 7h8v8`
  - arrow right: `M5 12h14M13 6l6 6-6 6`
  - chevron: `M6 9l6 6 6-6`
  - lock: rect x5 y11 w14 h9 rx2 plus `M8 11V8a4 4 0 0 1 8 0v3`
  - pencil: `M4 20h4L19 9l-4-4L4 16v4z`
  - info and alert: circle r9 plus `M12 11v5M12 8h.01`
  - check: `M5 12.5l4.5 4.5L19 7.5`
  - rotate-left: `M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4`
  - book: `M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z`
  - calendar: rect x4 y5 w16 h15 rx2 plus `M4 10h16M9 3v4M15 3v4`
  - map pin: `M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z` plus circle cx12 cy11 r2
  - camera: rect x3 y7 w18 h13 rx2 plus `M9 7l1.5-2.5h3L15 7` plus circle cx12 cy13.5 r3.5

  Never use emoji, platform logos or a Google logo.

- **Copy is identical in every composition.** Every guest string comes from this glossary or from admin content (displayName, localized title, description, link labels, category titles). Compositions change type and colour, never words.
- **EN glossary, rating.**
  - Question: 'How was your experience?'
  - Words: 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'.
  - Submit: 'Send privately' / 'Sending…'.
  - Validation: 'Choose a rating from 1 to 5 stars.'
  - Save failed: 'Your rating wasn’t sent. Check your connection and try again.' with a 'Try again' button.
  - Privacy line: 'Shared privately with {name}.'
  - Analytics: 'This page counts visits for {name}. No ads or third-party trackers.' with 'Privacy notice' and 'Got it'.
- **EN glossary, after rating.**
  - Heading: 'Thank you.' (status: 'Rating sent privately').
  - Receipt: '{word} · sent privately' with 'Change' (accessible name 'Change your rating').
  - Google title: 'Share your experience on Google'.
  - Google body: 'If you’d like, you can also leave a public review on Google.'
  - Google button: 'Continue to Google' (sr-only '(opens Google)').
  - Google subline: 'Opens Google · you may need to sign in'.
  - Degraded: 'Google can’t be opened from here right now' / 'Your rating reached {name} privately. Thank you.'
  - Private card: 'Add a private note for the team' / 'Optional. Shared privately with {name}.' / 'Write a private note'.
  - Composer: label 'Your note (optional)', placeholder 'What should the team know?', helper 'No need to include your name.', buttons 'Send note privately' and 'Not now'.
  - Counter (from 1,800 of 2,000 characters): '{n} characters left'.
  - Note sent: 'Your note was sent privately to {name}.'
- **EN glossary, Your response.**
  - Summary: 'Your response' · 'Change, remove or start over'.
  - 'Change your rating' · 'Until {hh:mm} today, Sofia time' · 'Change'.
  - 'Remove your note' · 'Until {hh:mm} tomorrow' · 'Remove'.
  - 'Remove your rating' (or 'Remove your rating and note') · 'Until {hh:mm} tomorrow. Anything you posted on Google isn’t affected.' · 'Remove…'.
  - Confirm: 'Remove both? {name} will no longer see your rating or note. Anything you posted on Google isn’t affected.' with 'Remove rating and note' and 'Keep them'.
  - Shared device: 'Shared phone or tablet?' · 'Start over so the next guest begins with a fresh page.' · 'Start over on this device'. Done: 'This device is ready for the next guest.'
  - Section label: 'Also useful'.
  - Footer: 'Privacy notice' · 'Made with Reputation Key'.
  - Mock times assume a rating sent at 14:32 on Saturday 19 September: change until 15:32 today, remove until 14:32 tomorrow.
- **BG glossary.** Needs native-speaker review before shipping.
  - Question: 'Как беше преживяването ви?'
  - Words: 'Слабо', 'Задоволително', 'Добро', 'Много добро', 'Отлично'. sr labels: '1 звезда, Слабо' … '5 звезди, Отлично'.
  - Submit: 'Изпрати поверително' / 'Изпращане…'.
  - Validation: 'Изберете оценка от 1 до 5 звезди.'
  - Privacy line: 'Споделя се поверително с {name}.' Use 'със' when the name starts with С or З.
  - Analytics: 'Тази страница отчита посещенията за {name}. Без реклами и без проследяване от трети страни.' with 'Поверителност' and 'Разбрах'.
  - Heading: 'Благодарим ви.' Receipt: '{word} · изпратено поверително' with 'Промени'.
  - Google: 'Споделете преживяването си в Google' / 'Ако желаете, можете да оставите и публичен отзив в Google.' / 'Продължи към Google' / 'Отваря Google · може да се наложи да влезете в профила си'.
  - Private card: 'Поверителна бележка за екипа' / 'По желание. Споделя се поверително с {name}.' / 'Напишете бележка'. Note submit: 'Изпрати бележката поверително'. 'Не сега'.
  - Your response: 'Вашият отговор'. Start over: 'Започни отначало на това устройство'.
  - Section label: 'Още полезно'. Language link names: 'English', 'Български'.
- **Google action invariance.** The Google action is one component with no score input. It has the same copy, slot (identical y in boards 2, 3 and 4 of a direction), size, colour, icon and entrance motion for ratings 1 to 5.
  - Never decorate it with stars or pre-fill anything.
  - Never say or imply a review was posted.
  - Never reward, and never celebrate differently by score.
  - Its link exists only when the verified destination is available. Otherwise the same slot shows the degraded copy with no link, URL or disabled control.
- **Private note.** Offered only at or below the property's threshold (default 3), always after the Google action, and equal to it or quieter (an outline button, never a filled primary before Google). It is optional, its accessible name is distinct from the rating submit ('Send note privately'), and it collects no personal data. There are no contact fields anywhere, and no promise of a reply.
- **Page order after rating** in every direction:
  1. 'Thank you.' heading, which receives focus.
  2. The one-line receipt with 'Change'.
  3. The Google action.
  4. The private note (3 or lower).
  5. 'Your response' (collapsed by default).
  6. Description.
  7. Useful links.
  8. Footer.

  The receipt never prints the submission time. Deadlines appear only inside 'Your response', in local time with a zone label. Withdrawal uses an inline two-step confirm. There is a calm shared-device reset, and no auto-reset timer.

- **Useful links.** A subordinate list of at most 4 visible rows. In the drawn baseline they appear only after rating. Showing them from arrival is a PROPOSAL, drawn only in C6 and labelled as such outside guest copy.
  - No fact-like sublines (hours, prices, handles).
  - No tel: links.
  - No photo link cards.
  - Tripadvisor or Booking only as plain 'Find us on…' rows, never styled as review asks.
- **Analytics disclosure.** An inline <section aria-label="Portal analytics information"> placed after the privacy line, with 'Privacy notice' and a 'Got it' button. It is never fixed, sticky or overlaying. After-rating boards may assume it was dismissed. 'No ads or third-party trackers' and the removal of the sessionStorage marker both need counsel sign-off before shipping.
- **Language switch.** Top-right <nav aria-label="Language"> with two 44x44 text links, 'EN' and 'БГ'. Each has hreflang, lang on the БГ link, aria-current on the active one, and an sr-only full name ('English', 'Български'). No flags. The whole page, including admin content, is in the chosen language.
- **Accessibility as drawn.**
  - Every target is at least 44x44 (stars 56x56).
  - Text contrast is at least 4.5:1, or 3:1 at 24px and above. Idle stars, focus rings and input boundaries are at least 3:1. All pairs are verified per palette.
  - Visible :focus-visible rings are defined in <helmet>.
  - Headings: one h1 (the placement / localized title), then h2s for 'Thank you.', the Google action, the private note and sections.
  - Status messages use role="status" and errors role="alert".
  - Never rely on colour alone.
  - Include @media (prefers-reduced-motion: reduce) and the sr-only utility in <helmet>.
- **Motion.** Motion only explains cause and effect, and it is identical for every score: no confetti, burst, badge, 'Congratulations' or score-based colour. Use compositor-friendly properties only (transform, opacity, clip-path; the perforation stroke draw is the one paint exception, 300ms, once). Reduced motion falls back to a 100ms crossfade or none.
- **Forbidden everywhere.**
  - Emoji and 'verified' seals or rings.
  - Ratings averages, review counts, testimonials or social proof.
  - Platform grids, and pre-filled or 'Rate us' star lockups.
  - Gamification: rewards, leaderboards, badges.
  - Guest names, rooms or reservations.
  - Implementation words in guest copy: threshold, eligible, snapshot, destination, telemetry.
  - Real businesses. Only the fictional names used here.
- **Photos.** Use only the three supplied fictional photos, by their /_blob/ URLs, with alt, width and height. Render at 390px wide or less, never upscaled beyond natural width, cropped with object-fit cover and object-position. Text never sits on a raw photo; use a solid-enough scrim or place text off the image. Every direction has at least one board with no photo, and every design must look finished without one. Photos stand for the legacy hero or a future owned upload, never video or a carousel.
- **Fonts and assets.** Each board loads exactly one Google Fonts css2 <link> (its direction's URL, with only the needed weights) and no other network assets except the photo blobs. Never use Inter, Roboto, Arial or Fraunces, and never list them in fallbacks. Set lang="bg" on the Cyrillic parts so Bulgarian letterforms activate.
- **Grain (mockup stand-in).** Production uses a ~2KB PNG tile. In mockups, the first child of the textured layer is:
  `<svg aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.05;mix-blend-mode:overlay"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`
  Content sits above it. Use the opacity and blend mode each direction specifies.
- **Unavailable portal.** Not drawn. It is brand-free, identical for every reason, and bilingual by Accept-Language: 'This page isn’t available right now. Please check back later.' / 'Тази страница не е достъпна в момента. Моля, опитайте отново по-късно.' Sofia Sans 400 on #F6F4F0, no property name, no colours, no links.
- **Colour roles (production).** Colour roles are derived from the Brand Profile's three hex values and checked at publish; admins get no new colour pickers:
  - Accent: primary shifted in OKLab lightness only, to 3:1 for stars, rules and focus, and 4.5:1 for small accent text.
  - Idle star: text mixed 55% into the surface.
  - Button label: black or white, whichever passes.

  Stage polarity follows the brand. Fonts are self-hosted with unicode-range splits. /p ignores the app theme script.

## A. Carved Stillness

**The owner's Signature Stay, rebuilt so it does not depend on photography. It uses a dark tonal stage from the property's own colours, a carved Garamond, and one metal accent, and the private rating is the hero of the first screen.**

- Axis: Polarity: dark ink stage. Composition: centred column under a 232px atmosphere band. Identity carrier: atmosphere, meaning the property's photo or, with no photo, its initial carved tone-on-tone into the stage. Voice: quiet luxury through restraint.
- Property: **Avela Resort (brand flex: Хотел Сарива Спа)**. Premium resort with pool and spa. The brand flex is a mountain thermal-spa hotel with a non-gold (thermal blue) brand. Fictional southern-coast resort: stone colonnade, olive trees, a dusk pool. The flex is a fictional hotel in a Rhodope spa town. Both names are invented. Voice: Unhurried and warm, first-person plural, short sentences, no exclamation marks. Example: 'Stone, olive shade and water that keeps the last of the light. Thank you for spending part of your day with us.'

### Typography

- **display**: Cormorant Garamond. Weight 600 for the wordmark (spaced capitals), the question and card titles. 500 italic for the chosen-word caption only, the single italic on the page. Fallback: 'Cormorant Garamond', Georgia, serif.
- **body**: Ysabeau Office 400/600 for body, buttons, placement line, meta and receipt. It is by the same designer as Cormorant (Christian Thalmann), so the pairing is native. Fallback: 'Ysabeau Office', system-ui, sans-serif. Never list Inter, Roboto or Arial.
- **scale**: - Wordmark: Cormorant 600, 14px, uppercase, letter-spacing .28em.
  - Placement line (h1): Ysabeau 600, 12/16, uppercase, .18em.
  - Question and 'Thank you.': Cormorant 600, 32/38, letter-spacing -0.005em.
  - Google and degraded card title: Cormorant 600, 24/30.
  - Private card title: Cormorant 600, 22/28.
  - Caption word: Cormorant 500 italic, 22/26.
  - Description: Ysabeau 400, 17/26.
  - Card body: Ysabeau 400, 16/24.
  - Buttons: Ysabeau 600, 17/20 (secondary 15–16).
  - Receipt and privacy: Ysabeau 400, 14–15/20.
  - Endpoints and meta: Ysabeau 400, 13/18.
  - Section label: Ysabeau 600, 12/16, uppercase, .18em.
  - Footer: 12/16.
  - No text below 12px. Body on dark is never lighter than weight 400.
- **cyrillicNote**: Both families ship Cyrillic through Google's unicode-range subsets and carry a Bulgarian (BGR) locl. Put lang="bg" on <html> for BG boards, and on every Cyrillic span in EN boards (the 'БГ' link), so Bulgarian letterforms activate.

  Google-served Cormorant has no smcp feature. Make 'small caps' with text-transform uppercase plus letter-spacing; never use font-variant: small-caps, which would be synthesized.

  Measured with HarfBuzz:
  - EN question at 32px = 332px, one line in 342.
  - BG 'Как беше преживяването ви?' at 32px = 394px, two lines (balanced).
  - 'Изпрати поверително' at 17/600 = 173px.
  - 'ХОТЕЛ САРИВА СПА' at 14px/.24em = 192px, which fits beside the language control.

  In production, self-host with the Bulgarian forms as default so a Cyrillic name renders correctly on an EN page.

- css2: `https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Ysabeau+Office:wght@400;600&display=swap`

### Palette

| Token                          | Hex       | Role                                                                                                                                         |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ink stage                      | `#121614` | Avela page background and band base                                                                                                          |
| Ink raised                     | `#1A1F1C` | Google and degraded card, expanded 'Your response' panel (tonal step 1)                                                                      |
| Ink field                      | `#232925` | Pressed states, textarea, no-photo band field (tonal step 2)                                                                                 |
| Hairline                       | `#363835` | 1px rules, card borders, row separators (16% bone into ink)                                                                                  |
| Bone                           | `#F2ECE1` | Primary text: 15.5:1 on stage, 14.2:1 on raised                                                                                              |
| Linen                          | `#D6CFC3` | Description text (11.8:1) and the inactive language link over the photo scrim (5.8:1 or better)                                              |
| Stone                          | `#B8B0A3` | Secondary text: card bodies, receipt, privacy line (8.5:1 on stage, 7.8:1 on raised)                                                         |
| Ash                            | `#9D968A` | Meta, endpoints, subline, footer (6.2:1 on stage, 5.7:1 on raised)                                                                           |
| Champagne                      | `#CDAE78` | Selected star fill and stroke, icons, outline-button borders, rules (8.6:1)                                                                  |
| Champagne text                 | `#D9BE8C` | Small accent text: placement line, links, 'Change', caption word (10.2:1)                                                                    |
| Champagne button               | `#D4B57E` | Primary buttons (Send privately, Continue to Google); label #121614 at 9.3:1; hover #DFC38F; active #C9A96F                                  |
| Idle star                      | `#8D8C85` | Unselected star outline and mini-star outline (5.4:1: 55% bone into ink)                                                                     |
| Focus                          | `#EBD6A8` | 2px focus ring, offset 3px (12.8:1)                                                                                                          |
| Carved field (Avela, no photo) | `#26302B` | Radial centre of the no-photo band. Carved glyph #1E2622.                                                                                    |
| Flex: thermal ink              | `#0F1619` | Сарива stage. Raised #162024, field #1D292E, hairline #33393B.                                                                               |
| Flex: thermal text             | `#EEF1EE` | Сарива primary text (16:1). Secondary #AEB9BA (9.1:1), meta #93A0A2 (6.8:1), description #CFD6D4.                                            |
| Flex: thermal blue             | `#6FC3DF` | Сарива accent for stars and icons (9.2:1). Accent text #8ED0E6. Button #7CC8E2 with label #0F1619 (9.8:1). Idle star #8A8E8E. Focus #B5E3F2. |
| Flex: carved field             | `#173039` | Сарива band radial centre. Carved glyph #142A31.                                                                                             |

### Imagery

**A1–A4 and A6 (Avela)** use resort-colonnade (/_blob/b1b75f289468fdb59ca2e65c1a80cd3f, 414x280) in the band.

- Box: <img width="390" height="232" alt="">, object-fit cover, object-position 50% 40%. It renders at 390x264, trimming 32px of height, never upscaled beyond natural width. alt is empty because the property name is real text.
- Top scrim (0–116): linear-gradient(180deg, rgba(18,22,20,.82) 0px, rgba(18,22,20,.82) 52px, rgba(18,22,20,0) 116px).
- Bottom scrim (150–232): linear-gradient(180deg, rgba(18,22,20,0), #121614).
- Only the identity strip sits over the photo, and only on the 82% scrim. The h1 starts below the band.
- The photo stands for the legacy hero_image_url or a post-SAFE-01 owned photo: one image, never video or a carousel.

**A5 (no photo)** shows the carved initial.

- Band: radial-gradient(120% 90% at 50% 38%, #173039 0%, #0F1619 72%).
- Glyph: the first letter of displayName ('С'), Cormorant 600 176px, colour #142A31, text-shadow 0 -1px 0 rgba(0,0,0,.55), 0 1px 0 rgba(238,241,238,.08). Centred horizontally with its baseline at y196. aria-hidden.
- Never add a ring, check, border or badge; it must not read as a seal.
- Avela's own no-photo band would use centre #26302B and glyph #1E2622.

**Grain** (shared snippet) at 5% overlay on the band only, beneath the text layer.

### Layout system

**Grid.** 390 wide, 24px gutters (content x24–366, 342px), 8px rhythm with gaps of 12, 16, 20, 24 and 32. The question, stars, receipt and 'Thank you.' are centred. Card contents are left-aligned. Radius 4 on buttons, cards and panels. No shadows. Depth comes only from tonal steps: stage #121614, then raised #1A1F1C, then field #232925. Hairlines are 1px #363835.

**Components** (y positions in the EN artboard):

- **A.band 0–232:** full-bleed photo or carved initial, plus grain.
- **A.strip 0–56**, overlaid on the band:
  - Wordmark (displayName via CSS uppercase) at x24, vertically centred: Cormorant 600, 14px, .28em, #F2ECE1. It is a <p>, not a link.
  - Right: <nav aria-label="Language"> with two 44x44 links, 'EN' and 'БГ' (lang="bg", hreflang, sr-only suffix ' English' / ' Български'). Ysabeau 600 14px.
  - Current link: #F2ECE1 with aria-current="page" and a 1px #CDAE78 underline 6px below. Other link: #D6CFC3. A 1x14 divider in rgba(214,207,195,.4) sits between them. The group ends at x366.
- **A.h1 248–264:** the portal's localized title (placement line), centred.
- **A.rating:** legend 276–314, stars 334–390, endpoints 396–414, caption slot 420–446, submit 462–514, privacy line 526–546. BG: the legend is 2 lines (276–352) and everything below moves +38.
- **A.analytics** (arrival, until 'Got it'):
  - Hairline at y578.
  - Text 594–632: Ysabeau 400 13/19 #9D968A, left-aligned.
  - Actions row 636–680: 'Privacy notice' link on the left (14/600 #D9BE8C, underline offset 3). 'Got it' <button> on the right (text only, 14/600 #D9BE8C, 44x72).
  - The region is <section aria-label="Portal analytics information">.
- **A.description:** Ysabeau 400 17/26 #D6CFC3, centred, 3 lines maximum.
- **A.receipt** (after rating):
  - h2 'Thank you.' at 276–314: Cormorant 600 32/38, centred, tabindex=-1. It receives focus programmatically, with no ring drawn.
  - A visually hidden role=status 'Rating sent privately'.
  - Receipt row 326–370, centred and 44 tall: five 16px mini stars (gap 3; filled #CDAE78, the rest outlined #8D8C85; aria-hidden). Then, 12px gaps apart, '{word} · sent privately' (Ysabeau 400 15/20 #B8B0A3) and a 'Change' <button> (Ysabeau 600 15 #D9BE8C, underlined, 44 tall, accessible name 'Change your rating').
  - sr-only line: 'Your rating: n out of 5, {word}. Sent privately.'
- **A.google 394–658:** <section aria-labelledby>, bg #1A1F1C, 1px #363835 border, radius 4, padding 24, x24–366.
  - h2 418–478: 'Share your experience on Google', Cormorant 600 24/30 #F2ECE1, left, 2 lines.
  - Body 486–534: Ysabeau 400 16/24 #B8B0A3.
  - Link-button 554–606: <a href="#"> 294x52, bg #D4B57E, radius 4, label 'Continue to Google' Ysabeau 600 17 #121614, plus a 16px external-arrow icon in #121614 and sr-only '(opens Google)'.
  - Subline 616–634: Ysabeau 400 13/18 #9D968A, centred.
  - This card is the same for every score.
- **A.degraded:** same slot and surface, 394–558.
  - An 18px info icon (#CDAE78) sits inline before the title.
  - Title: Cormorant 600 24/30, 2 lines.
  - Body: 16/24 #B8B0A3.
  - No button, no link, no disabled control.
- **A.private** (rating 3 or lower only; 16px below the Google or degraded card, 192 tall):
  - Transparent background, 1px #363835 border, radius 4, padding 24.
  - Title: Cormorant 600 22/28 #F2ECE1, 1 line.
  - Body: Ysabeau 400 15/22 #B8B0A3, 2 lines.
  - A 48px full-inner-width outline button (1px #CDAE78): 'Write a private note', Ysabeau 600 16 #D9BE8C, with a 16px pencil icon, aria-expanded="false".
- **A.yourResponse (collapsed):** a 56px row with hairlines above and below. The whole row is a <button aria-expanded="false">.
  - Left: 'Your response' (Ysabeau 600 16 #F2ECE1), then the meta 'Change, remove or start over' (13 #9D968A).
  - Right: a 16px chevron-down in #CDAE78.
- **A.yourResponse (expanded):** a #1A1F1C panel, 1px #363835 border, radius 4, with rows separated by inset hairlines:
  - Header row: 56.
  - Each action row: 16px padding. Title Ysabeau 600 15/20 #F2ECE1. Meta 13/18 #9D968A, max width 200. Action button on the right: 44 tall, 1px #CDAE78 outline, radius 4, label 15/600 #D9BE8C.
  - 'Start over' row: a full-width 48px outline button with a 16px rotate-left icon.
- **A.links:**
  - Label 'ALSO USEFUL': Ysabeau 600 12/16 .18em #D9BE8C, left.
  - Rows 56px tall, each an <a>: label Ysabeau 600 17/24 #F2ECE1 on the left, a 16px arrow-up-right in #CDAE78 on the right, hairline #363835 between rows.
  - No sublines and no fake facts.
- **A.footer:** a hairline, then a 44px row: 'Privacy notice' on the left (13/600 #D9BE8C, underlined); 'Made with Reputation Key' on the right (12/16 #9D968A).

**Page order after rating:** receipt, Google, private (3 or lower), Your response, description, links, footer.

**Production:**

- Band = min(30svh, 232px).
- Submit bottom at or below 548px at 375x667 with Safari toolbars, and at 320px width, in EN and BG.
- No fixed heights; everything reflows at 200% text.

### Rating control

**Structure.** A <fieldset> (no border, padding 0). Its <legend> is the question: 'How was your experience?' / 'Как беше преживяването ви?', Cormorant 600 32/38 #F2ECE1, centred, width 342, text-wrap balance.

**Radios and labels.** Five <input type="radio" name="rating" class="sr-only" id="r1"…"r5">, each followed by a <label for> of 56x56 (flex-centred, radius 6).

- Each label holds a 40x40 star SVG (viewBox 0 0 24 24, shared star path, stroke-linejoin round) and sr-only text: '1 star, Poor', '2 stars, Fair', '3 stars, Good', '4 stars, Very good', '5 stars, Excellent'. BG: '1 звезда, Слабо' … '5 звезди, Отлично'.
- The row is centred with a 10px gap (x35–355).

**Star states:**

- Idle: fill none, stroke #8D8C85 (5.4:1), stroke-width 1.1 (about 1.8px).
- Selected (stars 1..n of the checked value, with `checked` on input n): fill #CDAE78, stroke #CDAE78, stroke-width 1.4.
- Hover (pointer only): idle stroke #F2ECE1.
- Pressed: transform scale(.94), 90ms.

**Endpoints.** 'Poor' / 'Слабо' under star 1, left-aligned to x35. 'Excellent' / 'Отлично' under star 5, right-aligned to x355. Ysabeau 400 13/18 #9D968A, aria-hidden (the radio names already carry the words).

**Caption slot.** A 26px slot is always reserved so nothing shifts. The chosen word appears in Cormorant 500 italic 22/26 #D9BE8C, centred, aria-hidden.

**Error.** Shown in the same slot, which may grow to 2 lines. role="alert": a 16px alert icon in #CDAE78 plus Ysabeau 600 14/20 #F2ECE1 'Choose a rating from 1 to 5 stars.' The radios get aria-describedby pointing to it.

**Submit.** A <button type="submit"> of 342x52, radius 4, bg #D4B57E, label 'Send privately' / 'Изпрати поверително' in Ysabeau 600 17 #121614.

- Hover #DFC38F; active #C9A96F plus translateY(1px).
- Always enabled. It never submits on star tap.
- While sending, the label reads 'Sending…' and the width does not change.

**Privacy line.** Under the submit: a 14px lock icon (#CDAE78, 1.5 stroke) plus 'Shared privately with {name}.' in 14/20 #B8B0A3, centred.

**Helmet CSS:**

```
:focus-visible{outline:2px solid #EBD6A8;outline-offset:3px}
input[type=radio]:focus-visible + label{outline:2px solid #EBD6A8;outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
```

Plus the sr-only rule and a{color:#D9BE8C}.

### Signature details

- **Carved initial (the no-photo identity).** The first letter of displayName in Cormorant 600 at 176px, one tonal step off the band field. The shadow pair (0 -1px 0 rgba(0,0,0,.55) and 0 1px 0 light at 8%) makes it read as cut into stone. It is derived from data, works for 'A' and 'С' alike, and never has a ring or badge.
- **The settle (production motion; A2–A4 draw its end state).** On a successful send the five 56px stars translate and scale into the 16px receipt stars: a same-document View Transition, 280ms, cubic-bezier(.2,.8,.2,1). 60ms later the Google card rises 8px and fades in over 220ms, and the private card follows with the identical entrance. The motion is identical for every score. Under reduced motion it becomes a 100ms crossfade. Focus moves to 'Thank you.'
- **One italic word.** The chosen-word caption ('Very good') is the only italic on the page. It confirms the choice in the property's serif voice without a dialog.
- **The Signature Stay lineage, in type.** A spaced-capital wordmark (tracking .28em) and a champagne placement line (.18em) over a quiet stage, with 1px hairlines at 16%.
- **Tonal depth, no shadows.** Three ink steps (#121614, #1A1F1C, #232925) do all the layering. The only gradients are the band field and the scrims.
- **Focus built for photos.** A 2px champagne ring, offset 3px. Over the photo it always sits on the 82% scrim, so it holds 5:1 or better.

### Guards

- **One Google card for every score.** A.google renders at y394–658 with identical copy, size, colours, icon and entrance in A2 (2 stars), A3 (5 stars) and A4 (4 stars). It takes no score input. The only score-dependent pixels on the page are the mini-star fill count and the caption word.
- **Stars show only the guest's own choice.** No filled stars appear anywhere except the guest's own selection and receipt. Never put stars near the word Google. No Google logo; the plain word 'Google' plus an external-arrow icon is enough.
- **Private card placement.** The private card appears only at 3 stars or below, always below the Google or degraded card, and never with a filled button.
- **Degraded state.** Renders no link, URL or disabled button. The copy says the rating arrived privately.
- **Carved initial.** It never gets a ring, border, check or badge (no seal look), and it is always aria-hidden.
- **Photo and text.** No text sits on the raw photo. Only the strip sits on the 82% scrim, and the h1 and everything after it start below the band. There is at most one photo, never video.
- **Champagne is earned.** Champagne appears only because Avela's brand is gold or bronze. Other accents keep their own hue with lightness shifted to 3:1 (A5). Brands that cannot reach 3:1 on dark are routed to Folio; A never draws its own light stage.
- **Name once.** The wordmark appears once. The h1 is the placement ('Colonnade Pool & Terrace'), never the property name again.
- **Measured first screen.** Submit bottom at 514 (A1) and 552 (A5), both within 640. Production gate: 548 or less at 375x667 with Safari toolbars.
- **Rights stay close.** The receipt shows no submission time, which protects shared devices. Deadlines are shown only inside Your response, in local time with a zone label.
- **Equal motion.** Motion is identical for 1 and 5 stars. No confetti, burst or celebration.

### Proposed behaviour changes

- 'Send privately' replaces 'Submit private rating', and 'Send note privately' replaces 'Send private feedback'. This ships as one versioned guest-ui v2 language pack with e2e accessible-name updates. Keeping the old label is the zero-e2e fallback.
- Visible endpoint words and a reserved caption word replace the digit labels. The selected stars get a visible fill and heavier stroke, fixing today's missing checked state.
- The receipt collapses to one line with 'Change'. Correction, withdrawal and 'Start over on this device' move into a 'Your response' disclosure placed directly after the cards, with deadlines in local time. Manager policy copy is removed from the guest page.
- The analytics notice becomes an inline region under the privacy line, keeping its name 'Portal analytics information' and its 'Got it' button, and it is never fixed over the submit button. This depends on counsel confirming removal of the non-exempt sessionStorage marker.
- A 'Carved Stillness' composition is stored on the Property Brand Profile. The dark stage is chosen automatically when the derived accent reaches 3:1 on the brand text colour; otherwise the property renders as Folio.
- Derived colour roles (accent 3:1, accent text 4.5:1, idle star 55% mix, black-or-white button label) are computed from the three existing hex values and checked at publish.
- The no-photo band gets a carved initial generated from displayName.
- Self-hosted Cormorant Garamond and Ysabeau Office subsets with Bulgarian forms as default. The /p page is isolated from THEME_INIT_SCRIPT and the app tokens.
- Links stay after rating in these boards (current contract). Links from arrival is only the C6 proposal.

### Boards

#### A1-arrival — Avela Resort — Arrival (390x844)

_State: Arrival · EN · photo band (legacy hero / future owned photo) · nothing selected · baseline: no links before rating_

lang="en". Root 390x844, overflow hidden, bg #121614.

1. **A.band 0–232:** resort-colonnade image with the top and bottom scrims as specified; grain at 5%.
2. **A.strip 0–56** over the scrim:
   - Left: 'AVELA RESORT'.
   - Right: 'EN' (current, underlined #CDAE78) | 'БГ' (#D6CFC3).
3. **h1 at 248–264:** 'Colonnade Pool & Terrace', uppercase, Ysabeau 600 12/16 .18em #D9BE8C, centred.
4. **Rating block:**
   - Legend 276–314: 'How was your experience?' (one line).
   - Stars 334–390: all idle.
   - Endpoints 396–414: 'Poor' / 'Excellent'.
   - Caption slot 420–446: empty but reserved.
   - Submit 462–514: 'Send privately'.
   - Privacy 526–546: lock icon plus 'Shared privately with Avela Resort.'
5. **A.analytics:**
   - Hairline at 578.
   - Text 594–632: 'This page counts visits for Avela Resort. No ads or third-party trackers.'
   - Row 636–680: 'Privacy notice' link on the left, 'Got it' button on the right.
6. **Description 704–782**, centred: 'Stone, olive shade and water that keeps the last of the light. Thank you for spending part of your day with us.'
7. **Footer:** hairline at 800. Row 800–844: 'Privacy notice' on the left, 'Made with Reputation Key' on the right.

**Interactive:** 2 language links, 5 radios with labels, Send privately, 2 Privacy notice links, Got it.

**Measured:** submit bottom at 514 (the gate is 640 or less). Nothing sits above the rating except identity and placement.

#### A2-after-low — Avela Resort — After a 2-star rating (390x980)

_State: After rating · 2 stars (Fair) · settled · analytics notice already dismissed · private note offered below the Google card_

lang="en", bg #121614.

1. **A.band and A.strip** identical to A1 (photo, scrims, 'AVELA RESORT', EN | БГ).
2. **h1 at 248–264:** 'Colonnade Pool & Terrace', identical to A1.
3. **A.receipt:**
   - 'Thank you.' at 276–314, with the hidden status 'Rating sent privately'.
   - Receipt row 326–370: 2 filled and 3 outline mini stars, 'Fair · sent privately', and 'Change'.
4. **A.google at 394–658:**
   - Title: 'Share your experience on Google'.
   - Body: 'If you’d like, you can also leave a public review on Google.'
   - Link-button: 'Continue to Google' with the external arrow.
   - Subline: 'Opens Google · you may need to sign in'.
5. **A.private at 674–866:**
   - Title: 'Add a private note for the team'.
   - Body: 'Optional. Shared privately with Avela Resort.'
   - Outline button: 'Write a private note' (aria-expanded="false").
6. **A.yourResponse (collapsed) at 890–946:** 'Your response' · 'Change, remove or start over' · chevron.
7. The board ends at 980. The description, links and footer continue below and are not drawn.

**Interactive:** Change, Continue to Google (link), Write a private note, Your response, language links.

**Check:** the Google card must be pixel-identical to A3 and A4 in copy, size, colour, icon and y position.

#### A3-after-high — Avela Resort — After a 5-star rating (390x1180)

_State: After rating · 5 stars (Excellent) · Google only (5 is above the default 3) · analytics notice dismissed · full page to the footer_

lang="en".

1. **A.band, A.strip and h1** identical to A1.
2. **Receipt:**
   - 'Thank you.' at 276–314.
   - Receipt row 326–370: 5 filled mini stars, 'Excellent · sent privately', and 'Change'.
3. **A.google at 394–658:** pixel-identical to A2.
4. **No private card.**
5. **A.yourResponse (collapsed) at 682–738.**
6. **Description 770–848:** same text as A1.
7. **A.links:**
   - Label 880–896: 'ALSO USEFUL'.
   - Rows: 904–960 'Spa & treatments', 960–1016 'Dinner at Olea', 1016–1072 'Getting here'. Each has a champagne arrow and hairlines between rows.
8. **Footer:** hairline at 1104. Row 1112–1156: 'Privacy notice' on the left, 'Made with Reputation Key' on the right.

**Interactive:** Change, Continue to Google, Your response, 3 link rows, Privacy notice, language links.

**Show side by side with A2:** the only differences above y658 are the mini-star fill count and the caption word.

#### A4-done — Avela Resort — Done, your response open (390x1190)

_State: Done · 4 stars (Very good) · guest already opened Google once (nothing on the page changes or claims a review) · Your response expanded_

lang="en".

1. **A.band, A.strip and h1** identical to A1.
2. **Receipt:**
   - 'Thank you.' at 276–314.
   - Receipt row 326–370: 4 filled mini stars, 'Very good · sent privately', and 'Change'.
3. **A.google at 394–658:** unchanged and still available. No 'thanks for your review', no check mark.
4. **A.yourResponse (expanded) at 682–1058.** The header button has aria-expanded="true" and a chevron-up.
   - **Header row 682–738:** 'Your response'.
   - **Row 738–814:**
     - Title: 'Change your rating'.
     - Meta: 'Until 15:32 today, Sofia time'.
     - Button: 'Change' (88x44 outline).
   - **Row 814–906:**
     - Title: 'Remove your rating'.
     - Meta (2 lines): 'Until 14:32 tomorrow. Anything you posted on Google isn’t affected.'
     - Button: 'Remove…' (96x44 outline).
   - **Row 906–1058:**
     - Title: 'Shared phone or tablet?'
     - Meta (2 lines): 'Start over so the next guest begins with a fresh page.'
     - Full-width 48px outline button: 'Start over on this device', with a rotate-left icon.
   - Deadlines assume the rating was sent at 14:32 on Saturday 19 September.
5. **Description 1090–1168:** same text as A1.
6. The board ends at 1190. The links and footer continue below.

**Interactive:** Change (×2), Continue to Google, Your response header, Remove…, Start over on this device.

#### A5-flex-bg-no-photo — Хотел Сарива Спа — Пристигане (390x844)

_State: Brand flex · Bulgarian (lang=bg) · NO photo: carved initial · thermal-spa hotel with a non-gold brand accent · 4 stars selected, not yet sent_

lang="bg", bg #0F1619 (thermal palette).

1. **Band 0–232, no photo:**
   - radial-gradient(120% 90% at 50% 38%, #173039 0%, #0F1619 72%).
   - Carved 'С' in Cormorant 600 176px, #142A31, with the carve shadows, centred, baseline at y196, aria-hidden.
   - Grain at 5%.
2. **Strip 0–56:**
   - Left: 'ХОТЕЛ САРИВА СПА' (Cormorant 600 14 .24em #EEF1EE, 192px wide).
   - Right: 'EN' (#AEB9BA) | 'БГ' (current, underline #6FC3DF, aria-current).
3. **h1 at 248–264:** 'МИНЕРАЛНИ БАСЕЙНИ' (Ysabeau 600 12 .18em #8ED0E6), centred.
4. **Legend 276–352:** 'Как беше / преживяването ви?' on 2 balanced lines, 32/38 #EEF1EE.
5. **Stars 372–428:** input 4 is checked. Stars 1–4 fill #6FC3DF; star 5 is outlined #8A8E8E.
6. **Endpoints 434–452:** 'Слабо' / 'Отлично' in #93A0A2.
7. **Caption 458–484:** 'Много добро' in Cormorant 500 italic 22 #8ED0E6.
8. **Submit 500–552:** bg #7CC8E2, label 'Изпрати поверително' in Ysabeau 600 17 #0F1619.
9. **Privacy 564–584:** lock icon plus 'Споделя се поверително с Хотел Сарива Спа.' (14/20 #AEB9BA).
10. **Analytics:**
    - Hairline at 616.
    - Text 632–670: 'Тази страница отчита посещенията за Хотел Сарива Спа. Без реклами и без проследяване от трети страни.' (13/19 #93A0A2, may take 3 lines, to 689).
    - Row 690–734: 'Поверителност' link and 'Разбрах' button.
11. **Description 752–830**, centred, 17/26 #CFD6D4: 'Топла минерална вода, борова сянка и тишина. Благодарим ви, че прекарахте част от деня си при нас.'

**Measured:** submit bottom at 552 (the gate is 640 or less).

**This board proves four things:** no photo, Cyrillic name and forms, a non-champagne accent derived from the brand, and the selected state (fill plus heavier stroke plus caption).

#### A6-google-unavailable — Avela Resort — Google unavailable (390x870)

_State: After rating · 3 stars (Good) · Google destination stale/unavailable (degraded) · private note offered · no URL rendered_

lang="en".

1. **A.band, A.strip and h1** identical to A1.
2. **Receipt:**
   - 'Thank you.' at 276–314.
   - Receipt row 326–370: 3 filled and 2 outline mini stars, 'Good · sent privately', and 'Change'.
3. **A.degraded at 394–558**, in the same slot and surface as the Google card:
   - An 18px info icon in #CDAE78.
   - Title: 'Google can’t be opened from here right now' (2 lines).
   - Body: 'Your rating reached Avela Resort privately. Thank you.'
   - No button, no link, no greyed-out control, no URL anywhere in the markup.
4. **A.private at 574–766:**
   - Title: 'Add a private note for the team'.
   - Body: 'Optional. Shared privately with Avela Resort.'
   - Button: 'Write a private note'.
5. **A.yourResponse (collapsed) at 790–846.**
6. The board ends at 870.

The tone is gentle. It never blames the guest or the property, and never explains technical causes.

## B. Folio

**The portal as a page from the property's own stationery: warm paper, graphite ink, one masthead in a high-contrast serif, printer's rules and a numbered index of links. Premium through typesetting rather than atmosphere, with a night edition for evening venues.**

- Axis: Polarity: light paper by default, with an inverted night edition. Composition: a flush-left editorial column with an asymmetric margin. Identity carrier: typesetting (a 56px two-line masthead, an Oxford rule, a double-ruled panel, a numbered index). Voice: literate and hand-set.
- Property: **The Harbor Hotel (brand flex: Винарна Велмира)**. Boutique sea-view hotel with a terrace. The brand flex is an evening wine bar shown in the night edition. Fictional small hotel above an old harbour, facing an island. The flex is a fictional Bulgarian wine bar with a kitchen. Both names are invented. Voice: Literate, warm, lightly witty, like a handwritten card left on the pillow. Example: 'Twelve rooms above the old harbour, a terrace that faces the island, and coffee until the last boat comes in.'

### Typography

- **display**: Playfair: the 2023 'Playfair 2' family, listed as 'Playfair' on Google Fonts, NOT Playfair Display, which lacks Bulgarian forms.
  - Weight 500 for the wordmark and panel titles; 400 for the question and 'Thank you.'
  - Optical size automatic (font-optical-sizing: auto), so the 56px wordmark gets display contrast and 22–26px titles get sturdier cuts.
  - Fallback: Playfair, Georgia, serif.
- **body**: Sofia Sans 400/600 for everything else. It is Bulgarian-designed (Lettersoup), its default Cyrillic glyphs are the Bulgarian forms, and it gives the narrowest BG button labels. Fallback: 'Sofia Sans', system-ui, sans-serif.
- **scale**: - Kicker (h1): Sofia 600, 12/16, uppercase, .16em.
  - Wordmark: Playfair 500, 56/58, -0.015em, text-wrap balance, 2 lines max. Step down to 48, then 40, then 34 if any line exceeds 338px.
  - Question and 'Thank you.': Playfair 400, 26/32.
  - Google panel title: Playfair 500, 24/30.
  - Private card title: Playfair 500, 22/28.
  - Colophon name: Playfair 500, 20/26.
  - Standfirst: Sofia 400, 18/28.
  - Body: Sofia 400, 16/24.
  - Buttons: Sofia 600, 17/20 (secondary 16).
  - Index label: Sofia 600, 17/24.
  - Index numerals: Sofia 600, 13/16, font-variant-numeric tabular-nums.
  - Meta and privacy: Sofia 400, 14/20.
  - Endpoints: Sofia 400, 13/18.
  - Caption word: Sofia 600, 13/16, uppercase, .14em.
  - Footer: 12/16.
  - The serif is never used below 20px.
- **cyrillicNote**: Playfair (2) has a BGR locl, so put lang="bg" on <html> for BG boards and on every Cyrillic span. Sofia Sans renders Bulgarian forms by default (its only locl is for Russian).

  Measured:
  - 'The Harbor Hotel' at Playfair 500 56px balances to 2 lines of 266px or less; at 44px the whole name is 315px.
  - 'Винарна / Велмира' at 56px is about 206px per line.
  - EN question at 26px = 286px (1 line).
  - BG question = 340px, which exceeds the 338px column, so reserve 2 lines.
  - 'Изпрати поверително' fits a full-width button easily.

- css2: `https://fonts.googleapis.com/css2?family=Playfair:opsz,wght@5..1200,400..600&family=Sofia+Sans:wght@400;600&display=swap`

### Palette

| Token        | Hex       | Role                                                                                                              |
| ------------ | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Paper        | `#F3EEE4` | Page background (the stage), with 3% paper grain                                                                  |
| Paper light  | `#F8F4EC` | Inline confirm box and pressed fills                                                                              |
| Paper deep   | `#ECE5D8` | Pressed state for outline buttons and the index row hover                                                         |
| Rule         | `#CCC3B3` | Decorative hairlines between rows, textarea baselines (decorative, not text)                                      |
| Leader       | `#9C9486` | Dotted leaders in the index (decorative)                                                                          |
| Graphite     | `#1D2528` | Primary text, Oxford rule, double rules, perforations, primary button fill (13.5:1)                               |
| Graphite 2   | `#4A5356` | Standfirst, card body, privacy line (6.8:1)                                                                       |
| Graphite 3   | `#5F676A` | Endpoints, meta, sublines, colophon line (5.0:1 on paper)                                                         |
| Harbour blue | `#1F5E78` | Brand accent: selected stars, kicker, index numerals, links, 'Change', focus ring (6.2:1)                         |
| Idle star    | `#7D7F7D` | Unselected star outline (3.5:1: 55% graphite into paper)                                                          |
| Button label | `#F3EEE4` | Label on the graphite button (13.5:1). Hover fill #2C373B.                                                        |
| Night paper  | `#1A1716` | Night-edition stage (B5). Raised #221E1C, rule #3C3835, leader #6B645C.                                           |
| Night ink    | `#EDE5D8` | Night text, rules and button fill (14.3:1). Button label #1A1716. Text 2 #B9AE9F (8.2:1), text 3 #A09585 (6.1:1). |
| Night claret | `#D98E7E` | Night accent for stars and icons (6.9:1). Accent text #E3A597 (8.6:1). Idle star #8E8881 (5.1:1). Focus #F0C3B8.  |

### Imagery

**No full-bleed image, ever.** A photo, when one exists, is a column-width 'figure' inset below the rating block, like a magazine plate.

**The Harbor Hotel** uses harbor-terrace (/_blob/b3a88efd1b67797584d1b92e821185d4, 420x194):

- Box: <img width="338" height="156" alt="Sea-view terrace at The Harbor Hotel">, object-fit cover, object-position 50% 50%, at x28. That is a 0.805 downscale, never upscaled.
- No radius and no caption, because there is no caption field.
- It appears at y688–844 in B1 and y745–901 in B3. In B2, B4 and B6 it falls below the board edge.
- It stands for the legacy hero_image_url or a future owned photo in the same slot.

**B5 (Велмира)** has no photo. The masthead is the identity.

**Paper grain:** 3% multiply over the whole page on day paper, 4% screen on night paper, beneath all content.

### Layout system

**Grid.** A flush-left editorial column with a left gutter of 28 and a right gutter of 24 (x28–366, 338px). The asymmetric margin is deliberate. 4px baseline grid; 32px between sections.

There are no cards and no fills. Structure comes from printer's rules:

- An **Oxford rule** (2px graphite, 3px gap, 1px graphite) under the masthead and above the colophon.
- A **double rule** (border 3px double #1D2528) on the Google panel's top and bottom only.
- A **perforation** (a 1px div with background repeating-linear-gradient(90deg,#1D2528 0 4px,transparent 4px 8px)) bounding the stub.
- Hairlines in #CCC3B3 between rows.

Radius 2 on buttons only. No shadows.

**Components** (EN y positions):

- **B.top 12–56:**
  - Left: the h1 kicker, vertically centred: Sofia 600 12/16 .16em #1F5E78.
  - Right: <nav aria-label="Language"> with two 44x44 links in Sofia 600 14. Current link: #1D2528 with a 1px #1F5E78 underline 5px below and aria-current. Other link: #4A5356. A 1x14 #CCC3B3 divider sits between them. The 'БГ' link has lang="bg" and sr-only ' Български'.
- **B.masthead:** wordmark at 76–192 (Playfair 500 56/58 #1D2528), then the Oxford rule at 212–218.
- **B.rating:** legend 238–270, stars 290–346, endpoints 352–370, caption slot 378–402, submit 418–470, privacy line 482–502. BG: the legend is 2 lines (238–302) and everything below moves +32.
- **B.analytics:**
  - Hairline at 534.
  - Text 550–590: Sofia 400 14/20 #4A5356.
  - Actions 594–638: 'Privacy notice' link on the left (14/600 #1F5E78, underlined). 'Got it' text <button> on the right (14/600 #1F5E78, 44 tall).
  - The region is <section aria-label="Portal analytics information">.
- **B.figure:** 338x156.
- **B.standfirst:** the description in Sofia 400 18/28 #4A5356, 4 lines maximum.
- **B.stub** (after rating) 238–378:
  - Perforations at 238 and 378.
  - h2 'Thank you.' at 262–294: Playfair 400 26/32 #1D2528, tabindex=-1, plus a hidden role=status 'Rating sent privately'.
  - Receipt row 310–354: 14px mini stars (filled #1F5E78, the rest outlined #7D7F7D; aria-hidden), a 10px gap, then '{word} · sent privately' (Sofia 400 16/22 #1D2528). Pushed right: a 'Change' text <button> (Sofia 600 16 #1F5E78, underlined, 44 tall, accessible name 'Change your rating').
  - No date or time is printed.
- **B.google 402–633:**
  - Double rules at 402–405 and 630–633.
  - h2 425–455: Playfair 500 24/30, 1 line.
  - Body 463–511: Sofia 400 16/24 #4A5356.
  - Link-button 531–583: <a href="#"> 338x52, bg #1D2528, radius 2, label 'Continue to Google' in Sofia 600 17 #F3EEE4, with a 16px external arrow in #F3EEE4 and sr-only '(opens Google)'.
  - Subline 591–609: Sofia 400 13/18 #5F676A, left.
- **B.degraded:** same frame. The title and body replace the button; no link.
- **B.letter (collapsed)** 657–825, rating 3 or lower only:
  - h2 657–685: Playfair 500 22/28.
  - Body 693–737: Sofia 400 15/22 #4A5356, 2 lines.
  - Button 757–805: full column, 48px, 1px #1D2528 outline, transparent, radius 2, label 'Write a private note' in Sofia 600 16 #1D2528 with a 16px pencil icon, aria-expanded="false".
- **B.yourResponse (collapsed):** a 56px row with #CCC3B3 hairlines above and below.
  - Left: 'Your response' (Sofia 600 16 #1D2528), then 'Change, remove or start over' (14 #5F676A).
  - Right: a 16px chevron in #1F5E78.
  - The whole row is the disclosure button.
- **B.index:**
  - Head: 'ALSO USEFUL' (Sofia 600 12/16 .16em #5F676A) followed by a 1px #CCC3B3 rule to x366.
  - An <ol> of 52px rows, each an <a>, with a #CCC3B3 hairline below. Each row holds: numeral '01' (Sofia 600 13 tabular #1F5E78, 32px wide); label (Sofia 600 17/24 #1D2528); a dotted leader (flex 1, border-bottom 1px dotted #9C9486, 6px above the baseline, aria-hidden); the category title (Sofia 400 14/20 #4A5356); an 8px gap; a 16px arrow-up-right in #1F5E78.
  - If a label wraps, the leader is dropped and the category moves under the label.
- **B.colophon:** Oxford rule; 'The Harbor Hotel' in Playfair 500 20/26; then 'Privacy notice · Made with Reputation Key' in Sofia 400 12/16 #5F676A ('Privacy notice' is a link).

**Page order after rating:** stub, Google panel, letter (3 or lower), Your response, figure, standfirst, index, colophon.

**Night edition:** identical geometry with the night palette.

**Production:** no fixed heights; the column reflows at 200% text; the wordmark steps down per its rule.

### Rating control

**Structure.** A <fieldset> (no border). Its <legend> is the question: 'How was your experience?' / 'Как беше преживяването ви?', Playfair 400 26/32 #1D2528, left-aligned, text-wrap balance.

**Radios and labels.** Five sr-only radios (name="rating", ids r1–r5), each followed by a <label for> of 56x56 (radius 2).

- The labels are left-aligned from x28 with an 8px gap (row x28–340).
- Each holds a 36x36 star (shared path, viewBox 24, round joins) and sr-only text: '1 star, Poor' … '5 stars, Excellent'.

**Star states:**

- Idle: fill none, stroke #7D7F7D (3.5:1), stroke-width 1.2 (about 1.8px).
- Selected (1..n): fill #1F5E78, stroke #1F5E78, width 1.4.
- Hover: idle stroke #1D2528.
- Pressed: scale(.94).
- No numerals under the stars.

**Endpoints.** 'Poor' starting at x28, and 'Excellent' ending at x340. Sofia 400 13/18 #5F676A, aria-hidden.

**Caption slot.** 24px, always reserved. It holds a 16x1 #1F5E78 rule, then 8px, then the chosen word in Sofia 600 13/16 uppercase .14em #1F5E78 (for example '— VERY GOOD'), aria-hidden.

**Error.** Shown in the same slot, role="alert": a 16px alert icon (stroke #1F5E78; claret #E3A597 at night) plus Sofia 600 14/20 in the text colour. The radios reference it with aria-describedby.

**Submit.** Full column, 338x52, radius 2, bg #1D2528, label 'Send privately' in Sofia 600 17 #F3EEE4, centred.

- Hover #2C373B; active translateY(1px).
- Always enabled. 'Sending…' while pending.

**Privacy line.** 'Shared privately with {name}.' in Sofia 400 14/20 #4A5356, left-aligned. No icon: the rule-and-type language carries it.

**Helmet CSS:**

```
:focus-visible{outline:2px solid #1F5E78;outline-offset:3px}
input[type=radio]:focus-visible + label{outline:2px solid #1F5E78;outline-offset:2px}
```

Night: #F0C3B8. Plus the reduced-motion rule, the sr-only rule and a{color:#1F5E78}.

### Signature details

- **The masthead.** A small-caps placement kicker over a 56px two-line Playfair wordmark, closed by an Oxford rule (thick, gap, thin). The page reads as the property's letterhead.
- **The stub.** After sending, the rating block becomes a stub bounded by two perforated rules, with 'Thank you.' and a one-line receipt. It never prints a time, so a shared device never shows the previous guest's moment. Production: the perforation draws once with stroke-dashoffset over 300ms; crossfade under reduced motion; identical for every score.
- **The double-ruled Google panel.** Framed only by printer's double rules above and below, with no box. It is calm, neutral and the same for 1 to 5.
- **The index.** Useful links set as a numbered table of contents: '01 Breakfast & bar menu ······ Menu ↗'. The dotted leaders line up like a hotel directory or a menu card, and the right-hand word is the admin's own category title.
- **The ruled letter.** The private note is written on baselines (a repeating 32px rule), so it looks like writing a note, not filling a form.
- **Night edition.** The same page in inverted ink (warm black paper, bone text, claret accent) for bars and evening restaurant placements, avoiding a bright white page at a dim table.

### Guards

- **One Google panel for every score.** It renders at y402–633 with identical copy, rules, button, icon and subline in B2 (2 stars), B3 (5 stars), B4 and B6. It takes no score input.
- **Private note placement.** The letter appears only at 3 stars or below, always after the Google panel, as an outline button or composer, and never a filled primary before Google.
- **Scale contrast.** No numerals under the stars. The wordmark is 56px and the question 26px, never within 1.5x of each other.
- **Full-width submit.** The submit is always full column width (338x52), never auto-width.
- **No timestamp on the stub.** The stub never prints a date or time.
- **Index structure.** The index is a real <ol> of links. Leaders are decorative and aria-hidden. The right-hand word is the admin category title, not an invented fact (no hours, prices or ratings).
- **Figure.** The figure is never full-bleed and never above the rating. At most one image.
- **Night edition.** It keeps every contrast role: stars 6.9:1, text 14.3:1, meta 6.1:1 or better.
- **Serif size.** The serif is used only at 20px and above. All UI text is Sofia Sans.
- **Measured first screen.** Submit bottom at 470 (B1) and 502 (B5), both within 640. Production gate: 548 or less at 375x667.
- **Structure without boxes.** No drop shadows, no rounded cards, no filled panels except the inline confirm box.

### Proposed behaviour changes

- A 'Folio' composition on the Brand Profile. It is the automatic stage for brands whose accent cannot reach 3:1 on dark, and the stage for the new neutral hospitality default palette.
- A night-edition switch per composition, proposed as the default for placements the admin marks as evening (bar, restaurant).
- Localized EN and BG link labels and category titles (a new capability), strongly needed because the index is text-first. Missing translations are flagged before publish.
- An optional, explicitly accepted 'paper tone' suggestion for brands with a pure #FFFFFF background.
- The stub receipt replaces the stacked receipt boxes and never prints the response time. Rights move into 'Your response' with local-time deadlines and an inline two-step remove.
- Shared with A: the guest-ui v2 pack ('Send privately', 'Send note privately', endpoint and caption words, Google subline), the inline analytics region, derived colour roles checked at publish, self-hosted Playfair (2) and Sofia Sans, /p isolated from the app theme.
- Links stay after rating in these boards (current contract). The index-from-arrival variant is covered by the C6 proposal decision.

### Boards

#### B1-arrival — The Harbor Hotel — Arrival (390x844)

_State: Arrival · EN · day paper · nothing selected · figure (legacy hero / future owned photo) sits below the rating · baseline: no links before rating_

lang="en". Root 390x844, bg #F3EEE4, grain at 3%.

1. **B.top 12–56:**
   - h1 kicker: 'THE TERRACE' in #1F5E78.
   - Language: 'EN' (current) | 'БГ'.
2. **Wordmark 76–192:** 'The Harbor / Hotel' in Playfair 500 56/58 #1D2528, balanced across 2 lines.
3. **Oxford rule 212–218**, x28–366.
4. **Rating block:**
   - Legend 238–270: 'How was your experience?'
   - Stars 290–346: all idle.
   - Endpoints 352–370: 'Poor' / 'Excellent'.
   - Caption slot 378–402: empty.
   - Submit 418–470: 'Send privately'.
   - Privacy 482–502: 'Shared privately with The Harbor Hotel.'
5. **B.analytics:**
   - Hairline at 534.
   - Text 550–590: 'This page counts visits for The Harbor Hotel. No ads or third-party trackers.'
   - Row 594–638: 'Privacy notice' on the left, 'Got it' on the right.
6. **Figure 688–844:** harbor-terrace at 338x156, x28. Its bottom edge meets the board edge exactly.

**Interactive:** 2 language links, 5 radios, Send privately, Privacy notice, Got it.

**Measured:** submit bottom at 470 (the gate is 640 or less).

The standfirst, colophon and everything else continue below the board.

#### B2-after-low — The Harbor Hotel — After a 2-star rating (390x930)

_State: After rating · 2 stars (Fair) · analytics notice dismissed · private note offered after the Google panel_

lang="en".

1. **B.top and masthead** identical to B1 (0–218).
2. **Stub 238–378:**
   - Perforation at 238.
   - 'Thank you.' at 262–294.
   - Receipt row 310–354: 2 filled and 3 outline mini stars, 'Fair · sent privately', and 'Change' on the right.
   - Perforation at 378.
3. **B.google 402–633:**
   - Double rules.
   - Title: 'Share your experience on Google'.
   - Body: 'If you’d like, you can also leave a public review on Google.'
   - Link-button: 'Continue to Google' with the external arrow.
   - Subline: 'Opens Google · you may need to sign in'.
4. **B.letter (collapsed) 657–825:**
   - Title: 'Add a private note for the team'.
   - Body: 'Optional. Shared privately with The Harbor Hotel.'
   - Outline button: 'Write a private note'.
5. **B.yourResponse (collapsed) 849–905.**
6. The board ends at 930. The figure, standfirst and index follow below.

**Interactive:** Change, Continue to Google, Write a private note, Your response, language links.

**Check:** the Google panel is pixel-identical to B3, B4 and B6.

#### B3-after-high — The Harbor Hotel — After a 5-star rating (390x1400)

_State: After rating · 5 stars (Excellent) · Google only · full page to the colophon, including figure and index_

lang="en".

1. **Top and masthead** identical to B1.
2. **Stub 238–378:**
   - 'Thank you.'
   - Receipt: 5 filled mini stars, 'Excellent · sent privately', and 'Change'.
3. **B.google 402–633:** identical to B2.
4. **No letter.**
5. **Your response (collapsed) 657–713.**
6. **Figure 745–901:** harbor-terrace at 338x156.
7. **Standfirst 925–1009:** 3 lines of 18/28: 'Twelve rooms above the old harbour, a terrace that faces the island, and coffee until the last boat comes in.'
8. **Index:**
   - Head 1069–1085: 'ALSO USEFUL'.
   - Rows of 52px from 1093 to 1301:
     - '01 Breakfast & bar menu ··· Menu'
     - '02 Book your next stay ··· Booking'
     - '03 Getting here ··· Map'
     - '04 Harbour walks ··· Guide'
   - Each row has an arrow-up-right.
9. **Colophon:**
   - Oxford rule at 1325–1331.
   - 'The Harbor Hotel' at 1343–1369.
   - 'Privacy notice · Made with Reputation Key' at 1377–1393.

**Interactive:** Change, Continue to Google, Your response, 4 index links, Privacy notice, language links.

#### B4-done — The Harbor Hotel — Done, removing a response (390x1300)

_State: Done · 2 stars (Fair) · private note sent · Your response expanded · inline two-step remove confirmation open_

lang="en".

1. **Top and masthead** as B1.
2. **Stub:** 2 stars, 'Fair · sent privately', and 'Change'.
3. **B.google 402–633:** unchanged.
4. **Note-sent line 657–701:** a 16px check icon in #1F5E78 plus 'Your note was sent privately to The Harbor Hotel.' (Sofia 400 15/22 #1D2528, 2 lines). No success colour and no celebration.
5. **Your response (expanded) 725–1293:**
   - **Header row 725–769:** 'Your response' with a chevron-up; aria-expanded="true".
   - **Row 769–841** (hairline above):
     - Title: 'Change your rating'.
     - Meta: 'Until 15:32 today, Sofia time' (14/20 #5F676A).
     - Action: 'Change' text button on the right (16/600 #1F5E78, underlined, 44 tall).
   - **Row 841–913:**
     - Title: 'Remove your note'.
     - Meta: 'Until 14:32 tomorrow'.
     - Action: 'Remove'.
   - **Row 913–1135:**
     - Title: 'Remove your rating and note'.
     - Meta: 'Until 14:32 tomorrow'.
     - Below it, the inline confirm box at 961–1119: bg #F8F4EC, a 2px #1D2528 left rule, padding 16.
       - Text (3 lines, Sofia 400 15/22 #1D2528): 'Remove both? The Harbor Hotel will no longer see your rating or note. Anything you posted on Google isn’t affected.'
       - Actions: 'Remove rating and note' (48px graphite fill, label #F3EEE4, 15/600), then 16px, then 'Keep them' (text button, 15/600 #1F5E78).
       - Focus sits on 'Keep them'.
   - **Row 1135–1293:**
     - Title: 'Shared phone or tablet?'
     - Meta (2 lines): 'Start over so the next guest begins with a fresh page.'
     - A full-column 48px outline button: 'Start over on this device'.
6. The board ends at 1300.

The receipt shows no submission time; deadlines appear only in Your response.

#### B5-flex-bg-night — Винарна Велмира — Пристигане (390x844)

_State: Brand flex · Bulgarian (lang=bg) · night edition · wine bar · NO photo · validation error after pressing send with no rating_

lang="bg". bg #1A1716, grain at 4% screen. The geometry is B with the night palette.

1. **Top 12–56:**
   - h1 kicker: 'ДЕГУСТАЦИОННА ЗАЛА' (#E3A597).
   - Language: 'EN' (#B9AE9F) | 'БГ' (current, #EDE5D8 with a #D98E7E underline).
2. **Wordmark 76–192:** 'Винарна / Велмира' in Playfair 500 56/58 #EDE5D8.
3. **Oxford rule 212–218** in #EDE5D8.
4. **Legend 238–302:** 'Как беше / преживяването ви?' on 2 lines, Playfair 400 26/32 #EDE5D8.
5. **Stars 322–378:** all idle, outlined #8E8881. The radios carry aria-invalid="true" and aria-describedby pointing to the error.
6. **Endpoints 384–402:** 'Слабо' / 'Отлично' in #A09585.
7. **Error in the caption slot 410–434:** role="alert", a 16px alert icon in #E3A597 plus 'Изберете оценка от 1 до 5 звезди.' (Sofia 600 14/20 #EDE5D8). Not red-only.
8. **Submit 450–502:** bg #EDE5D8, label 'Изпрати поверително' in Sofia 600 17 #1A1716.
9. **Privacy 514–534:** 'Споделя се поверително с Винарна Велмира.' (#B9AE9F).
10. **Analytics:**
    - Hairline #3C3835 at 566.
    - Text 582–642 (3 lines, 14/20 #B9AE9F): 'Тази страница отчита посещенията за Винарна Велмира. Без реклами и без проследяване от трети страни.'
    - Row 646–690: 'Поверителност' link (#E3A597) and 'Разбрах' button.
11. **Standfirst 722–834**, 18/28 #B9AE9F: 'Малки изби, дълги вечери и чаша за всеки въпрос. Благодарим, че седнахте при нас.'

**Measured:** submit bottom at 502 (the gate is 640 or less).

**This board proves:** Cyrillic masthead and forms, the night edition, the error state, and no photo.

#### B6-note-writing — The Harbor Hotel — Writing a private note (390x1060)

_State: After a 2-star rating · private note composer expanded with guest text · textarea focused (focus ring drawn)_

lang="en".

1. **Top, masthead and stub** exactly as B2 (stub 238–378: 2 stars, 'Fair · sent privately', 'Change').
2. **B.google 402–633:** unchanged and still above the note, identical to B2 and B3.
3. **Letter (expanded)** from 657:
   - **h2 657–685:** 'Add a private note for the team' (Playfair 500 22/28).
   - **Label 701–721:** 'Your note (optional)' (Sofia 600 14/20 #1D2528), a <label for> the textarea.
   - **Textarea 729–921** (x28–366, 6 ruled lines):
     - Transparent bg with background-image repeating-linear-gradient(180deg, transparent 0 31px, #CCC3B3 31px 32px).
     - line-height 32px; 1px #1D2528 top and bottom borders; no side borders; padding 0 0 0 2px.
     - Text: Sofia 400 17px #1D2528.
     - Focus drawn: outline 2px #1F5E78, offset 4.
     - Guest text (3–4 lines): 'The room was lovely. Breakfast ran out of fresh bread by half past nine, and the terrace tables weren’t cleared until late.'
     - The placeholder 'What should the team know?' shows only when empty.
   - **Helper 929–949:** 'No need to include your name.' (Sofia 400 14/20 #5F676A). The character counter stays hidden until 1,800 of 2,000 characters.
   - **Actions 973–1025:**
     - 'Send note privately': 52px, graphite fill, label #F3EEE4 Sofia 600 17, padding 0 24.
     - 16px gap.
     - 'Not now': text button, 16/600 #1F5E78, 44 tall.
4. The board ends at 1060.

There are no name, email, room or phone fields. Sending the note never hides or moves the Google panel.

## C. Table Card

**The page continues the printed card the guest just scanned. The property's colour fills a poster with its name set huge, and the rating sits on a light plate below a fold, like a table tent unfolded. It is bold and local, and recognisable in 200ms with no photo.**

- Axis: Polarity: brand colour field over a light plate. Composition: poster over plate, joined by a card-stock fold. Identity carrier: colour plus a giant extra-condensed wordmark. Voice: confident, appetising, print-continuous.
- Property: **Forma Kitchen (brand flex: Хотел Вардела)**. Neighbourhood restaurant and wine bar. The brand flex is a city hotel's lobby bar with an ochre brand. Fictional city restaurant with an open kitchen and a wood fire. The flex is a fictional Bulgarian city hotel. Both names are invented. Voice: Direct, generous, a little playful, like the host at the pass. Example: 'Fresh pasta, a wood fire and small-producer wine. Thanks for eating with us.'

### Typography

- **display**: Sofia Sans Extra Condensed 800, used only for the wordmark and the chosen-word caption. Fallback: 'Sofia Sans Extra Condensed', 'Sofia Sans', system-ui, sans-serif.
- **body**: Sofia Sans 400/600/700 for everything else. One Bulgarian superfamily (Lettersoup) with Bulgarian Cyrillic forms by default. Fallback: 'Sofia Sans', system-ui, sans-serif.
- **scale**: - Place line (h1): Sofia 700, 12/16, uppercase, .14em.
  - Wordmark: Extra Condensed 800, 96/84, -0.005em, set as entered (no forced case), 2 lines max. **Auto-fit:** use the largest size of 96px or less at which the longest line is 342px or less and the block height is at most the poster height minus 112. Minimum 44px; a third line is allowed only below 56px.
  - Question and 'Thank you.': Sofia 700, 28/32, -0.01em.
  - Caption word: Extra Condensed 800, 30/32.
  - Google card title: Sofia 700, 21/26.
  - Private card title: Sofia 700, 19/24.
  - Body: Sofia 400, 16/24.
  - Description: Sofia 400, 17/25.
  - Primary button: Sofia 700, 18/22 (card buttons 17).
  - Link label: Sofia 600, 17/22.
  - Meta, privacy and receipt: Sofia 400, 14–15/20.
  - Endpoints: Sofia 600, 13/18.
  - Footer: 12/16.
- **cyrillicNote**: Sofia Sans and Sofia Sans Extra Condensed draw the Bulgarian forms by default (their only locl is for Russian), so Cyrillic names are correct even on EN pages. Still set lang="bg" on <html> for BG boards and on Cyrillic spans.

  Measured:
  - EN question at 28/700 = 323px (1 line).
  - BG question = 384px, so 2 lines.
  - 'Изпрати поверително' at 18/700 = 190px.
  - 'Хотел / Вардела' at 96px is estimated at 190px and 245px per line. Verify in the browser and step the size down if a line exceeds 342px.

- css2: `https://fonts.googleapis.com/css2?family=Sofia+Sans+Extra+Condensed:wght@800&family=Sofia+Sans:wght@400;600;700&display=swap`

### Palette

| Token               | Hex       | Role                                                                                                                                                                    |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forma tomato        | `#C8402A` | Brand primary: poster field, selected stars, caption word, primary buttons. 4.58:1 on the plate, so no derivation is needed.                                            |
| On poster           | `#FFFFFF` | Wordmark, h1, language links and focus ring on the poster (4.97:1 against tomato)                                                                                       |
| Plate               | `#FAF5EC` | Plate background below the fold, with 3% grain                                                                                                                          |
| Card                | `#FFFFFF` | Google card and expanded 'Your response' panel surface                                                                                                                  |
| Plate field         | `#F1EADF` | Pressed states and textarea background                                                                                                                                  |
| Crease              | `#E2D8C9` | 1px fold line at the top of the plate (decorative). The fold shade is rgba(34,26,22,.08) to 0 over 16px. The poster's bottom edge line is rgba(0,0,0,.14).              |
| Hairline            | `#E6DDD0` | Card borders, row separators, section rules (decorative)                                                                                                                |
| Espresso            | `#221A16` | Primary text, outline-button border, focus ring on the plate, error text (15.8:1)                                                                                       |
| Espresso 2          | `#5A4E47` | Card body, receipt, privacy line, description (7.4:1)                                                                                                                   |
| Espresso 3          | `#6E625A` | Endpoints, meta, subline, footer (5.4:1 on plate, 5.9:1 on white)                                                                                                       |
| Tomato text         | `#B53A26` | Small accent text: 'Change', links, button hover (5.4:1)                                                                                                                |
| Idle star           | `#837D76` | Unselected star outline (3.75:1)                                                                                                                                        |
| Flex: ochre         | `#E2A529` | Вардела poster and button fill. On-poster and label colour #1C1A17 (8.0–9.7:1). The button adds a 1.5px #9A6A0C border, because ochre is only 1.98:1 against the plate. |
| Flex: derived ochre | `#9A6A0C` | Вардела stars and caption on the plate (4.31:1), derived by lightness shift. Accent text #835A08 (5.6:1). Idle star #7F7C78.                                            |
| Flex: plate         | `#F7F4EE` | Вардела plate. Ink #1C1A17 (15.8:1), ink 2 #55504A, ink 3 #69635C.                                                                                                      |

### Imagery

**No photos in any C board.** The colour field and the wordmark are the identity, and every board is a no-photo proof.

The future photo slot, not drawn this round, is a duotone of an owned photo tinted to the primary inside the poster, behind a solid band under the wordmark. forma-pasta is deliberately unused so the colour-field identity is judged on its own.

**Grain:** 5% multiply on the poster, 3% multiply on the plate, beneath content.

**Printed table tent:** the same poster, fold and plate, with the QR code on the light plate (4-module quiet zone) and the short URL printed as text.

### Layout system

**Grid.** Poster over plate, joined by a fold. 24px gutters (x24–366, 342px). Everything is left-aligned.

- **Poster:** 0–280 on every C board. It is static in every state and never reacts to the score.
- **Fold:** a 1px rgba(0,0,0,.14) line at y279 (poster edge); at y280 a 1px crease in #E2D8C9, followed by a 16px shade linear-gradient(180deg, rgba(34,26,22,.08), rgba(34,26,22,0)). No overlap, no top radius, no drop shadow.
- **Radii:** poster 0, cards 8, buttons 6.
- **Cards:** #FFFFFF with 1px #E6DDD0 and no shadow.

**Components** (EN y positions):

- **C.poster 0–280:** bg primary plus grain.
  - Top row 12–56: the h1 at x24 (Sofia 700 12/16 .14em, on-poster colour). Right: <nav aria-label="Language"> with two 44x44 links in Sofia 600 14, on-poster colour. The current link has a 2px underline offset 5 and aria-current. A 1x14 divider at 40% opacity sits between them. 'БГ' has lang="bg" and sr-only ' Български'.
  - Wordmark 76–244 at x24.
- **C.rating** on the plate: legend 312–344, stars 364–420, endpoints 426–444, caption slot 452–484, submit 500–556, privacy line 568–588. BG: the legend is 2 lines (312–376) and everything below moves +32.
- **C.analytics:**
  - Hairline #E6DDD0 at 620.
  - Text 636–674: Sofia 400 13/19 #6E625A.
  - Actions 676–720: 'Privacy notice' link on the left (14/600 #B53A26, underlined). 'Got it' text <button> on the right (14/700 #221A16, 44 tall).
  - The region is <section aria-label="Portal analytics information">.
- **C.description:** Sofia 400 17/25 #5A4E47, 3 lines maximum.
- **C.receipt:**
  - h2 'Thank you.' at 312–344: Sofia 700 28/32 #221A16, tabindex=-1, plus a hidden status 'Rating sent privately'.
  - Receipt row 356–400: 16px mini stars (filled #C8402A, the rest outlined #837D76; aria-hidden), then '{word} · sent privately' (Sofia 400 15/20 #5A4E47), then 'Change' (Sofia 700 15 #B53A26, underlined, 44 tall, accessible name 'Change your rating').
- **C.google 424–644:** #FFFFFF card, 1px #E6DDD0, radius 8, padding 20.
  - h2 444–470: Sofia 700 21/26 #221A16.
  - Body 478–526: Sofia 400 16/24 #5A4E47.
  - Link-button 546–598: <a href="#"> 302x52, bg #C8402A, radius 6, label 'Continue to Google' in Sofia 700 17 #FFFFFF, with a 16px external arrow in #FFFFFF and sr-only '(opens Google)'.
  - Subline 606–624: Sofia 400 13/18 #6E625A.
- **C.private 660–840** (rating 3 or lower only): transparent, 1px #E6DDD0, radius 8, padding 20.
  - Title: Sofia 700 19/24.
  - Body: 15/22 #5A4E47, 2 lines.
  - A 48px full-inner-width outline button (1.5px #221A16, radius 6): 'Write a private note', Sofia 700 16 #221A16, with a pencil icon, aria-expanded="false".
- **C.yourResponse (collapsed):** a 56px row with #E6DDD0 hairlines. Left: 'Your response' (Sofia 700 16 #221A16), then 'Change, remove or start over' (14 #6E625A). Right: a 16px chevron in #C8402A. The whole row is the button.
- **C.yourResponse (expanded):** a #FFFFFF card, radius 8.
  - Rows use 16px padding, with title Sofia 700 15/20 and meta 13/18 #6E625A.
  - Right-hand buttons: 44 tall, 1.5px #221A16 outline, radius 6, label 15/700 #221A16.
  - 'Start over on this device' is a full-width 48px outline button.
- **C.links:**
  - Label 'ALSO USEFUL': Sofia 700 12/16 .14em #6E625A.
  - Rows of 60px, each an <a>: a 24px line icon (stroke 1.5 #221A16) at x24; the label at x60 (Sofia 600 17/22 #221A16); a 20px arrow-right in #C8402A on the right; a hairline #E6DDD0 below.
  - No sublines.
- **C.footer:** a hairline, then a 44px row: 'Privacy notice' on the left (13/600 #B53A26), 'Made with Reputation Key' on the right (12/16 #6E625A).

**Page order after rating:** receipt, Google, private (3 or lower), Your response, description, links, footer.

**Production:** poster = 38svh capped at 280px; the wordmark auto-fits within it. Submit bottom at 548 or less at 375x667 with Safari toolbars.

### Rating control

**Structure.** A <fieldset> (no border). Its <legend> is the question: 'How was your experience?' / 'Как беше преживяването ви?', Sofia 700 28/32 #221A16, left-aligned.

**Radios and labels.** Five sr-only radios followed by <label for> of 56x56 (radius 6).

- The labels are left-aligned from x24 with a 10px gap (x24–344).
- Each holds a 42x42 star (shared path, round joins, stroke-width 1.3, about 2.3px: the poster's weight) and sr-only text: '1 star, Poor' … '5 stars, Excellent'.

**Star states:**

- Idle: fill none, stroke #837D76.
- Selected (1..n): fill and stroke in the plate accent (#C8402A for Forma; derived #9A6A0C for Вардела).
- Hover: idle stroke #221A16.
- Pressed: scale(.94).

**Endpoints.** 'Poor' starting at x24, 'Excellent' ending at x344. Sofia 600 13/18 #6E625A, aria-hidden.

**Caption slot.** 32px, always reserved. The chosen word appears in Sofia Sans Extra Condensed 800 30/32 in the plate accent (large text, 3:1 or better), aria-hidden.

**Error.** Shown in the same slot, role="alert": an 18px alert icon in #221A16 plus Sofia 700 15/20 #221A16 'Choose a rating from 1 to 5 stars.' Never red, because red can be the brand.

**Submit.** 342x56, radius 6, bg #C8402A, label 'Send privately' in Sofia 700 18 #FFFFFF.

- Hover #B53A26; active translateY(1px).
- Always enabled; 'Sending…' while pending.
- When the primary is below 3:1 against the plate (ochre in C5), the button keeps the primary fill, uses the black-or-white label that passes, and adds a 1.5px border in the derived accent.

**Privacy line.** 'Shared privately with {name}.' in Sofia 400 14/20 #5A4E47.

**Helmet CSS:**

```
:focus-visible{outline:2px solid #221A16;outline-offset:3px}
input[type=radio]:focus-visible + label{outline:2px solid #221A16;outline-offset:2px}
```

Poster links use an inline style outline in the on-poster colour. Plus the reduced-motion rule, the sr-only rule and a{color:#B53A26}.

### Signature details

- **The fold.** Poster, crease and plate read as the table tent unfolded: a 1px crease plus a 16px fold shade where a bottom sheet would normally sit. The printed tent uses exactly this composition, with the QR code on the plate.
- **The name as poster.** A 96px Sofia Sans Extra Condensed 800 wordmark, set as entered, auto-fitted for Latin and Cyrillic names. The property's own colour fills the top 280px.
- **The poster never reacts.** The poster is identical in every state. Only the plate's contents change, crossfading over 200ms, identical for every score; instant under reduced motion.
- **The caption in the poster's voice.** The chosen word ('Very good') is set in the wordmark face and the plate accent, readable at arm's length.
- **Red-safe feedback.** Validation and save errors use an espresso icon and text, never red alone, so a red brand never reads as an error.
- **Real icons from iconKey.** One curated 1.5px-stroke set (menu, booking, directions, photos) renders the stored iconKey. No emoji, no brand logos, no circles.

### Guards

- **One Google card for every score.** It renders at y424–644 with identical copy, size, colour, icon and subline in C2 (2 stars), C3 (5 stars) and C4 (3 stars). It takes no score input.
- **Static poster.** The poster is pixel-identical in every state and never changes with the score.
- **Not a delivery app.** No bottom-sheet look: the plate has no top radius, no overlap onto the poster, and no drop shadow anywhere. Cards are flat with a 1px border. No circular logo or photo discs.
- **Wordmark as entered.** Never forced to lowercase or uppercase. Appears once.
- **Honest link rows.** No hours, prices, handles or other fact-like sublines. No tel: links (destinations are HTTPS-only). At most 4 visible rows. Never Tripadvisor or Booking styled as review asks.
- **No red errors.** Red or the brand primary is never used for errors. Errors use espresso text plus an icon.
- **Private card placement.** Only at 3 stars or below, below Google, outline button only, never filled.
- **Derived accent.** When the primary fails 3:1 on the plate (C5 ochre), stars and caption use the derived accent and the button gains a derived border. The poster keeps the true brand colour.
- **Measured first screen.** Submit bottom at 556 (C1) and 588 (C5), both within 640. Production gate: 548 or less at 375x667, with the poster capped at 38svh.
- **No contact capture.** No phone, email, name or reservation fields, and no 'we will contact you'.

### Proposed behaviour changes

- A 'Table Card' composition on the Brand Profile, recommended for restaurants, bars, grills, city hotels and pool-bar or restaurant placements.
- A wordmark auto-fit algorithm for Latin and Cyrillic displayName (5–120 characters) with 2-line and size-floor rules.
- iconKey becomes a curated enum (menu, booking, directions, website, photos, social, guide) with a migration of existing free strings and a picker in the Links tab. The guest page renders it.
- A derived plate accent (3:1 for stars, 4.5:1 for text) and a derived button border, checked at publish.
- Print templates (table tent, bar card) that share the poster, fold and plate composition, with the QR on the plate and the printed short URL.
- Links from arrival (C6) as a proposal requiring BETA/ADR 0044 reconciliation and an e2e change. All other boards keep the current rule.
- Shared with A and B: the guest-ui v2 pack, the inline analytics region, 'Your response' after the cards with local-time deadlines, self-hosted Sofia Sans families, /p isolated from the app theme.

### Boards

#### C1-arrival — Forma Kitchen — Arrival (390x844)

_State: Arrival · EN · no photo · nothing selected · baseline: no links before rating_

lang="en". Root 390x844.

1. **Poster 0–280:** bg #C8402A, grain at 5%.
   - h1 at 26–42: 'DINING ROOM' (#FFFFFF).
   - Language: 'EN' (current, 2px white underline) | 'БГ'.
   - Wordmark 76–244: 'Forma / Kitchen' in Extra Condensed 800 96/84 #FFFFFF, at x24.
   - Poster edge line at 279.
2. **Fold at 280:** crease plus 16px shade. Plate bg #FAF5EC.
3. **Rating block:**
   - Legend 312–344: 'How was your experience?'
   - Stars 364–420: all idle.
   - Endpoints 426–444: 'Poor' / 'Excellent'.
   - Caption slot 452–484: empty.
   - Submit 500–556: 'Send privately'.
   - Privacy 568–588: 'Shared privately with Forma Kitchen.'
4. **C.analytics:**
   - Hairline at 620.
   - Text 636–674: 'This page counts visits for Forma Kitchen. No ads or third-party trackers.'
   - Row 676–720: 'Privacy notice' / 'Got it'.
5. **Description 744–794:** 'Fresh pasta, a wood fire and small-producer wine. Thanks for eating with us.'
6. **Footer:** hairline at 800. Row 800–844: 'Privacy notice' / 'Made with Reputation Key'.

**Interactive:** 2 language links, 5 radios, Send privately, 2 Privacy notice links, Got it.

**Measured:** submit bottom at 556 (the gate is 640 or less).

#### C2-after-low — Forma Kitchen — After a 2-star rating (390x950)

_State: After rating · 2 stars (Fair) · analytics notice dismissed · private note offered below Google_

lang="en".

1. **Poster 0–280 and fold:** identical to C1. Static.
2. **Receipt:**
   - 'Thank you.' at 312–344.
   - Receipt row 356–400: 2 filled and 3 outline mini stars, 'Fair · sent privately', and 'Change'.
3. **C.google 424–644:**
   - Title: 'Share your experience on Google'.
   - Body: 'If you’d like, you can also leave a public review on Google.'
   - Link-button: 'Continue to Google' with the external arrow.
   - Subline: 'Opens Google · you may need to sign in'.
4. **C.private 660–840:**
   - Title: 'Add a private note for the team'.
   - Body: 'Optional. Shared privately with Forma Kitchen.'
   - Outline button: 'Write a private note'.
5. **Your response (collapsed) 864–920.**
6. The board ends at 950. The description, links and footer continue below.

**Interactive:** Change, Continue to Google, Write a private note, Your response, language links.

**Check:** the Google card is pixel-identical to C3 and C4.

#### C3-after-high — Forma Kitchen — After a 5-star rating (390x1200)

_State: After rating · 5 stars (Excellent) · Google only · full page with links (baseline) and footer_

lang="en".

1. **Poster and fold:** identical to C1.
2. **Receipt:**
   - 'Thank you.' at 312–344.
   - Receipt row 356–400: 5 filled mini stars, 'Excellent · sent privately', and 'Change'.
3. **C.google 424–644:** identical to C2.
4. **No private card.**
5. **Your response (collapsed) 668–724.**
6. **Description 756–806:** same text as C1.
7. **Links:**
   - Label 838–854: 'ALSO USEFUL'.
   - Rows of 60px from 862 to 1102:
     - 'Menu' (open-book icon)
     - 'Book a table' (calendar icon)
     - 'Directions' (map-pin icon)
     - 'Photos from the kitchen' (camera icon)
   - Each row ends in a tomato arrow.
8. **Footer:** hairline at 1134. Row 1142–1186: 'Privacy notice' / 'Made with Reputation Key'.

**Interactive:** Change, Continue to Google, Your response, 4 links, Privacy notice, language links.

#### C4-done — Forma Kitchen — Done, your response open (390x1270)

_State: Done · 3 stars (Good) · private note sent · Your response expanded_

lang="en".

1. **Poster and fold:** as C1.
2. **Receipt:**
   - 'Thank you.' at 312–344.
   - Receipt row 356–400: 3 filled and 2 outline mini stars, 'Good · sent privately', and 'Change'.
3. **C.google 424–644:** unchanged.
4. **Note-sent line 660–716:** an 18px check icon in #C8402A plus 'Your note was sent privately to Forma Kitchen.' (Sofia 400 15/22 #221A16). Hairline below.
5. **Your response (expanded) 740–1168:** a white card, radius 8, 1px #E6DDD0.
   - **Header row 740–796:** 'Your response' with a chevron-up; aria-expanded="true".
   - **Row 796–868:**
     - Title: 'Change your rating'.
     - Meta: 'Until 15:32 today, Sofia time'.
     - Button: 'Change'.
   - **Row 868–940:**
     - Title: 'Remove your note'.
     - Meta: 'Until 14:32 tomorrow'.
     - Button: 'Remove'.
   - **Row 940–1028:**
     - Title: 'Remove your rating and note'.
     - Meta: 'Until 14:32 tomorrow. Anything you posted on Google isn’t affected.'
     - Button: 'Remove…'.
   - **Row 1028–1168:**
     - Title: 'Shared phone or tablet?'
     - Meta: 'Start over so the next guest begins with a fresh page.'
     - A full-width 48px outline button: 'Start over on this device'.
6. **Description 1200–1250.**
7. The board ends at 1270.

#### C5-flex-bg-city-hotel — Хотел Вардела — Пристигане (390x844)

_State: Brand flex · Bulgarian (lang=bg) · city-hotel lobby bar · ochre brand with ink labels and a derived darker accent · NO photo · 5 stars selected, not yet sent_

lang="bg".

1. **Poster 0–280:** bg #E2A529, grain at 5%.
   - h1: 'ЛОБИ БАР' (#1C1A17).
   - Language: 'EN' | 'БГ' (current, 2px #1C1A17 underline).
   - Wordmark 76–244: 'Хотел / Вардела' in Extra Condensed 800 96/84 #1C1A17, with capitals as entered.
2. **Fold at 280.** Plate #F7F4EE.
3. **Legend 312–376:** 'Как беше / преживяването ви?' on 2 lines, Sofia 700 28/32 #1C1A17.
4. **Stars 396–452:** input 5 is checked; all five fill #9A6A0C, the derived accent, visibly darker than the poster by design.
5. **Endpoints 458–476:** 'Слабо' / 'Отлично' in #69635C.
6. **Caption 484–516:** 'Отлично' in Extra Condensed 800 30 #9A6A0C.
7. **Submit 532–588:** bg #E2A529 with a 1.5px #9A6A0C border, label 'Изпрати поверително' in Sofia 700 18 #1C1A17.
8. **Privacy 600–620:** 'Споделя се поверително с Хотел Вардела.' (#55504A).
9. **Analytics:**
   - Hairline at 652.
   - Text 668–706: 'Тази страница отчита посещенията за Хотел Вардела. Без реклами и без проследяване от трети страни.' (13/19 #69635C; up to 3 lines, to 725).
   - Row 726–770: 'Поверителност' link (#835A08) and 'Разбрах' button.
10. **Description 790–840**, 17/25 #55504A: 'Кафе от седем сутринта и бар, който не бърза. Благодарим ви, че се отбихте.'

**Measured:** submit bottom at 588 (the gate is 640 or less).

**This board proves:** a hotel placement, Cyrillic wordmark auto-fit, the automatic black label on a light primary, the derived accent role, and the selected state.

#### C6-links-from-arrival-proposal — Forma Kitchen — Links from arrival (proposal) (390x1190)

_State: PROPOSAL (not current behaviour) · arrival · EN · useful links reachable before rating, below the rating block · nothing selected_

lang="en". Identical to C1 from 0 to 720: poster, fold, rating block (submit 500–556), privacy line and analytics region. Then:

1. **Links:**
   - Label 752–768: 'ALSO USEFUL'.
   - Rows of 60px from 776 to 1016: 'Menu', 'Book a table', 'Directions', 'Photos from the kitchen', with the same icons, arrows and hairlines as C3.
2. **Description 1048–1098.**
3. **Footer:** hairline at 1130. Row 1130–1174: 'Privacy notice' / 'Made with Reputation Key'.

The links must start below the privacy line and must never appear above or beside the rating, so the page stays a review gateway first and a link tree second. There is no sticky menu button.

'Proposal' appears only in the board title and canvas label, never in guest copy.

Adopting it requires reconciling BETA.md and ADR 0044 and changing the e2e assertion that links are absent before rating.
