# Round 4 — guest portal: Immersive Hub

Date: 2026-09-29 to 2026-09-30. Status: direction chosen by the product owner. Design only; nothing is implemented. Canvas: <https://claude.ai/artifact/LFBjJSia6ZNJ5pqvGynNcQ> (private to the owner).

Round 4 separated the guest page from the admin and restarted the guest page with three distinct one-screen versions. The owner combined two of them, chose the result, and asked for every screen. The admin round is in [round-4-admin](../round-4-admin/README.md).

## How the direction was chosen

| Version           | Idea                                                                        | Outcome                                 |
| ----------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| 1 · Immersive     | The photo fades into a dark colour field; frosted glass; Cormorant Garamond | Liked for its elegance, gradient, glass |
| 2 · Paper & Line  | A line-drawn colonnade on paper; Playfair Display                           | Not chosen                              |
| 3 · Guest Hub     | A rating tile first, then link tiles; Manrope                               | Liked for its sections                  |
| 4 · Immersive Hub | Version 1's look with version 3's sections                                  | **Chosen**                              |

The owner then asked for a language picker that works for any number of languages, since some places need, for example, English, Spanish and Chinese; a two-way slider could not do that. Renders of all four versions are in [boards/versions](boards/versions/).

## The design

- **Photo and colour.** The property photo sits at the top and fades into a colour field taken from it; a blurred copy of the photo fills the background. Without a photo, the colour field carries the page ([G09](boards/G09-no-photo.jpg)).
- **Glass.** The rating card and the link tiles are frosted glass over the colour field.
- **Type and colour.** Cormorant Garamond for headings and Ysabeau Office for text. Both cover Latin and Cyrillic, and Bulgarian uses its local letterforms. The accent is champagne `#EAD6A8`, checked for contrast.
- **Order.** The private rating comes first, then the same Google card after every rating, then the Linktree.
- **Languages.** A globe chip with the language code opens a sheet listing the portal's own languages, native name first. A portal with one language shows no chip.
- **Linktree.** Up to four tiles, each with an icon or a photo. The property chooses the title (Avela uses "Around the resort"); the default is "Useful links", translated for every language.
- **Name and logo.** The wordmark sits at the top left. A property that uploads a logo gets the logo there instead.

## Screens

| Screen                                                            | What it shows                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [G01 Arrival](boards/G01-arrival.jpg)                             | Photo, property name, the rating card, the Linktree and the visit-counting notice   |
| [G02 Language sheet](boards/G02-language-sheet.jpg)               | This portal's four languages; the page opens in the phone's language when it has it |
| [G03 Rating chosen](boards/G03-rating-selected.jpg)               | A rating picked and "Send privately" ready                                          |
| [G04 After 2★](boards/G04-after-low.jpg)                          | Thank you, the Google card, and the optional private note offered at 3★ or below    |
| [G05 After 5★](boards/G05-after-high.jpg)                         | The same Google card in the same place, and no note                                 |
| [G06 Writing a private note](boards/G06-note-writing.jpg)         | The note form, shared only with the property                                        |
| [G07 Done](boards/G07-done.jpg)                                   | Confirmation, and the guest's response: change it, remove it or start over          |
| [G08 Google unavailable](boards/G08-google-unavailable.jpg)       | Gentle copy when the Google link cannot be offered; the private flow still works    |
| [G09 No photo yet](boards/G09-no-photo.jpg)                       | The colour field carries the page until a photo is uploaded                         |
| [G10 German](boards/G10-german.jpg)                               | Long German words fit; one label nobody has translated yet shows in English         |
| [G11 Bulgarian, no rating chosen](boards/G11-bulgarian-error.jpg) | Bulgarian copy and the error state                                                  |
| [G12 Page unavailable](boards/G12-unavailable.jpg)                | A page without the property's branding, for a portal that is off                    |

Board sources are in [canvas](canvas/). They render only inside the design canvas, which holds the fonts and photos.

## Rules the design keeps

- The private 1–5 rating comes first. Nothing is public unless the guest chooses Google.
- The Google card is identical, and starts in the same place, after every rating.
- The private note is offered only at or below the portal's threshold (3★ in the examples).
- Privacy is explained where it matters ("Shared privately with Avela Resort"), and the page says it counts visits without ads or third-party trackers.

## Owner decisions (2026-09-30)

- **Languages.** The first languages are English, Spanish, Italian, French, German and Bulgarian. Each property sets its default languages and each portal picks its own; most will use one or two.
- **AI translation.** AI may draft translations of the property's own text. Drafts stay marked until someone on the team checks them.
- **Wording.** The word "guests" stays for every industry.
- **Linktree.** The link section is called the Linktree, with an editable title that defaults to "Useful links".
- **Uploads.** Properties can upload a photo and a logo, and link tiles can use photos.

## What building it needs

| Area            | Today                                                                                                          | Needed                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Languages       | English and Bulgarian only, fixed in code and database checks; about 60 guest phrases per language             | Open the checks to the six languages and add four phrase packs: AI draft, then a native check of the privacy and cookie notices |
| Link labels     | One language per link                                                                                          | A label per language                                                                                                            |
| Linktree        | A list of links under category titles, shown only after the guest rates                                        | Tiles from arrival, each with an icon or photo, and an editable title with a translated default                                 |
| Photos and logo | The property brand keeps a logo and a default photo, but uploads are safety-blocked (`portal.upload`, SAFE-01) | Finish SAFE-01, then uploads for the property photo, link-tile photos and the logo                                              |

## Open

- German wording beyond the agreed glossary, and all Spanish copy, need a native speaker's check.
- The photos on the boards are low-resolution placeholders.
