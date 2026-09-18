# Shared rules (all three directions)

**Canvas.** Every artboard is 390 CSS px wide. Each arrival board is exactly 390x844, with its root element fixed to the board size (matching $preview) and overflow hidden. Other boards may be taller, up to 1400. Never draw a status bar, keyboard, notch or device frame. Use the file names given (A1-arrival.dc.html and so on). <html lang> matches the copy (en or bg).

**First-screen gate.** On every arrival board the question, all five stars, the endpoint words, the caption slot and the submit button are fully visible, and the submit's bottom edge is at y640 or less. Safari on a 390x844 phone shows about 664px. The production gate is 548px or less at 375x667 with Safari toolbars, and 320px width, in EN and BG. Only property identity and the placement line may sit above the question: no gate, splash, overlay, platform grid or video.

**One rating core.** A <fieldset> whose <legend> is the question. Five sr-only radios (name="rating"), each with a visible 56x56 or larger <label> holding a star SVG and sr-only text ('1 star, Poor'). Endpoint words are visible and aria-hidden. A caption slot is always reserved so nothing shifts. Tapping a star never submits, redirects or opens Google. The explicit submit is always enabled. Selected stars show fill plus a heavier stroke (never hue alone). Idle outlines are at least 3:1 against their surface.

**Shared star path.** viewBox 0 0 24 24, stroke-linejoin round:
`M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z`
Mini receipt stars reuse it at 14–16px.

**Shared icon set.** 24px viewBox, 1.5 stroke, round caps and joins, aria-hidden, always next to real text:

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

**Copy is identical in every composition.** Every guest string comes from this glossary or from admin content (displayName, localized title, description, link labels, category titles). Compositions change type and colour, never words.

**EN glossary, rating.**

- Question: 'How was your experience?'
- Words: 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'.
- Submit: 'Send privately' / 'Sending…'.
- Validation: 'Choose a rating from 1 to 5 stars.'
- Save failed: 'Your rating wasn’t sent. Check your connection and try again.' with a 'Try again' button.
- Privacy line: 'Shared privately with {name}.'
- Analytics: 'This page counts visits for {name}. No ads or third-party trackers.' with 'Privacy notice' and 'Got it'.

**EN glossary, after rating.**

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

**EN glossary, Your response.**

- Summary: 'Your response' · 'Change, remove or start over'.
- 'Change your rating' · 'Until {hh:mm} today, Sofia time' · 'Change'.
- 'Remove your note' · 'Until {hh:mm} tomorrow' · 'Remove'.
- 'Remove your rating' (or 'Remove your rating and note') · 'Until {hh:mm} tomorrow. Anything you posted on Google isn’t affected.' · 'Remove…'.
- Confirm: 'Remove both? {name} will no longer see your rating or note. Anything you posted on Google isn’t affected.' with 'Remove rating and note' and 'Keep them'.
- Shared device: 'Shared phone or tablet?' · 'Start over so the next guest begins with a fresh page.' · 'Start over on this device'. Done: 'This device is ready for the next guest.'
- Section label: 'Also useful'.
- Footer: 'Privacy notice' · 'Made with Reputation Key'.
- Mock times assume a rating sent at 14:32 on Saturday 19 September: change until 15:32 today, remove until 14:32 tomorrow.

**BG glossary.** Needs native-speaker review before shipping.

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

**Google action invariance.** The Google action is one component with no score input. It has the same copy, slot (identical y in boards 2, 3 and 4 of a direction), size, colour, icon and entrance motion for ratings 1 to 5.

- Never decorate it with stars or pre-fill anything.
- Never say or imply a review was posted.
- Never reward, and never celebrate differently by score.
- Its link exists only when the verified destination is available. Otherwise the same slot shows the degraded copy with no link, URL or disabled control.

**Private note.** Offered only at or below the property's threshold (default 3), always after the Google action, and equal to it or quieter (an outline button, never a filled primary before Google). It is optional, its accessible name is distinct from the rating submit ('Send note privately'), and it collects no personal data. There are no contact fields anywhere, and no promise of a reply.

**Page order after rating** in every direction:

1. 'Thank you.' heading, which receives focus.
2. The one-line receipt with 'Change'.
3. The Google action.
4. The private note (3 or lower).
5. 'Your response' (collapsed by default).
6. Description.
7. Useful links.
8. Footer.

The receipt never prints the submission time. Deadlines appear only inside 'Your response', in local time with a zone label. Withdrawal uses an inline two-step confirm. There is a calm shared-device reset, and no auto-reset timer.

**Useful links.** A subordinate list of at most 4 visible rows. In the drawn baseline they appear only after rating. Showing them from arrival is a PROPOSAL, drawn only in C6 and labelled as such outside guest copy.

- No fact-like sublines (hours, prices, handles).
- No tel: links.
- No photo link cards.
- Tripadvisor or Booking only as plain 'Find us on…' rows, never styled as review asks.

**Analytics disclosure.** An inline <section aria-label="Portal analytics information"> placed after the privacy line, with 'Privacy notice' and a 'Got it' button. It is never fixed, sticky or overlaying. After-rating boards may assume it was dismissed. 'No ads or third-party trackers' and the removal of the sessionStorage marker both need counsel sign-off before shipping.

**Language switch.** Top-right <nav aria-label="Language"> with two 44x44 text links, 'EN' and 'БГ'. Each has hreflang, lang on the БГ link, aria-current on the active one, and an sr-only full name ('English', 'Български'). No flags. The whole page, including admin content, is in the chosen language.

**Accessibility as drawn.**

- Every target is at least 44x44 (stars 56x56).
- Text contrast is at least 4.5:1, or 3:1 at 24px and above. Idle stars, focus rings and input boundaries are at least 3:1. All pairs are verified per palette.
- Visible :focus-visible rings are defined in <helmet>.
- Headings: one h1 (the placement / localized title), then h2s for 'Thank you.', the Google action, the private note and sections.
- Status messages use role="status" and errors role="alert".
- Never rely on colour alone.
- Include @media (prefers-reduced-motion: reduce) and the sr-only utility in <helmet>.

**Motion.** Motion only explains cause and effect, and it is identical for every score: no confetti, burst, badge, 'Congratulations' or score-based colour. Use compositor-friendly properties only (transform, opacity, clip-path; the perforation stroke draw is the one paint exception, 300ms, once). Reduced motion falls back to a 100ms crossfade or none.

**Forbidden everywhere.**

- Emoji and 'verified' seals or rings.
- Ratings averages, review counts, testimonials or social proof.
- Platform grids, and pre-filled or 'Rate us' star lockups.
- Gamification: rewards, leaderboards, badges.
- Guest names, rooms or reservations.
- Implementation words in guest copy: threshold, eligible, snapshot, destination, telemetry.
- Real businesses. Only the fictional names used here.

**Photos.** Use only the three supplied fictional photos, by their /_blob/ URLs, with alt, width and height. Render at 390px wide or less, never upscaled beyond natural width, cropped with object-fit cover and object-position. Text never sits on a raw photo; use a solid-enough scrim or place text off the image. Every direction has at least one board with no photo, and every design must look finished without one. Photos stand for the legacy hero or a future owned upload, never video or a carousel.

**Fonts and assets.** Each board loads exactly one Google Fonts css2 <link> (its direction's URL, with only the needed weights) and no other network assets except the photo blobs. Never use Inter, Roboto, Arial or Fraunces, and never list them in fallbacks. Set lang="bg" on the Cyrillic parts so Bulgarian letterforms activate.

**Grain (mockup stand-in).** Production uses a ~2KB PNG tile. In mockups, the first child of the textured layer is:
`<svg aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.05;mix-blend-mode:overlay"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`
Content sits above it. Use the opacity and blend mode each direction specifies.

**Unavailable portal.** Not drawn. It is brand-free, identical for every reason, and bilingual by Accept-Language: 'This page isn’t available right now. Please check back later.' / 'Тази страница не е достъпна в момента. Моля, опитайте отново по-късно.' Sofia Sans 400 on #F6F4F0, no property name, no colours, no links.

**Colour roles (production).** Colour roles are derived from the Brand Profile's three hex values and checked at publish; admins get no new colour pickers:

- Accent: primary shifted in OKLab lightness only, to 3:1 for stars, rules and focus, and 4.5:1 for small accent text.
- Idle star: text mixed 55% into the surface.
- Button label: black or white, whichever passes.

Stage polarity follows the brand. Fonts are self-hosted with unicode-range splits. /p ignores the app theme script.
