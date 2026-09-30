# Round 4 — portal admin: A+ Workspace

Date: 2026-09-30. Status: direction and screens reviewed with the product owner, whose decisions are recorded below. Design only; nothing is implemented. Canvas: <https://claude.ai/artifact/L3WgLyLtEC6GP5Sa9uSHhM> (private to the owner), page "A+ · Workspace · full set". The guest round is in [round-4-guest](../round-4-guest/README.md).

## How the direction was chosen

Three variants, two boards each. Renders are in [boards/variants](boards/variants/).

| Variant       | Idea                                                    | Outcome                                                       |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| A · Workspace | A portals page, then one workspace per portal with tabs | **Chosen**                                                    |
| B · Desk      | Portals run like inbox cases: queues, a list, a case    | Not chosen: portal status does not deserve a panel of its own |
| C · Studio    | The guest page itself is the editor                     | Not chosen                                                    |

The owner's feedback shaped the improved version, A+. Portal status is not the most important thing, so there is no status panel: status appears only as one quiet line on a portal that needs something. Lists show no small copies of the guest page.

## Screens

| Screen                                                 | What it shows                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [1 Portals overview](boards/01-portals-overview.jpg)   | The last 30 days for all portals, portals grouped (Pool side, Front of house, Not in a group) with group totals, Edit and Share  |
| [2 Editor · Page tab](boards/02-editor-page.jpg)       | Sections in guest order, their fields, and the preview with every guest state beside it; the Linktree section is open            |
| [3 New portal](boards/03-new-portal.jpg)               | Name, group, languages and the wording to start from; nothing is public until it is published                                    |
| [4 Editor · Languages](boards/04-editor-languages.jpg) | The portal's languages, what is missing, Translate with AI, AI drafts, and what guests see when a text is missing                |
| [5 Review & publish](boards/05-review-and-publish.jpg) | The changes in plain words, checks, languages, and the pages after 1★ and 5★ side by side                                        |
| [6 Share](boards/06-share.jpg)                         | The address, the portal's one code (Download again, Copy NFC address, Replace, Stop all codes) and the print kit                 |
| [7 Results](boards/07-results.jpg)                     | Five honest measures, scans to Google, the rating mix, guests by language, and weekly figures marked with each published version |
| [8 History](boards/08-history.jpg)                     | Edits, publishes and code downloads in one ledger, and making an earlier version live again                                      |
| [9 Property look](boards/09-property-look.jpg)         | Photo, colours, name and logo, and default languages, previewed with and without a photo                                         |
| [10 All properties](boards/10-all-properties.jpg)      | Totals for the organisation, and portals grouped by property                                                                     |
| [11 Phone](boards/11-phone-portals.jpg)                | The portals list on a phone, grouped                                                                                             |
| [12 New group](boards/12-new-group.jpg)                | Name a group and pick its portals; a portal that moves keeps its earlier results with its old group                              |
| [13 Group](boards/13-group.jpg)                        | A group's results, its portals, the month's goal and its history                                                                 |
| [14 Replace photo](boards/14-replace-photo.jpg)        | Upload with a focal point, checks, a description for screen readers and a permission checkbox                                    |

Board sources are in [boards/src](boards/src/). They render only inside the design canvas, which holds the fonts and photos. The names, numbers and dates on the boards are invented.

## Owner decisions (2026-09-30)

| Decision                                                                           | What it means for the build                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status stays quiet: no status panel, one line only where something needs attention | Nothing new; it is a presentation rule                                                                                                                                                                                 |
| No small copies of the guest page in lists                                         | Nothing new                                                                                                                                                                                                            |
| Managers can download an existing code again                                       | Keep an encrypted copy of the address (the unused `portal_tokens.encrypted_raw_token` column fits) and record each download in History                                                                                 |
| No design picker: one design at first                                              | No design name is shown anywhere                                                                                                                                                                                       |
| One code per portal                                                                | Matches today's model of one address with at most one QR and one NFC marker; no named codes                                                                                                                            |
| Photo, link-tile photo and logo uploads are allowed                                | `portal.upload` stays safety-blocked until the SAFE-01 sign-off                                                                                                                                                        |
| No place types, because the product serves hotels, restaurants, barbers and salons | New portal asks for a name, a group, languages and starting wording; lists show QR or NFC instead of a place                                                                                                           |
| Portal groups are part of the admin                                                | Groups exist today for goals. Group rows, group pages and totals show all five results measures (owner decision 2026-09-30: the metric registry now admits Google opens and private notes at group and property scope) |
| The first languages are English, Spanish, Italian, French, German and Bulgarian    | Open the English/Bulgarian checks, add four guest phrase packs and a label per language for links                                                                                                                      |
| Each portal picks its own languages; most will use one or two                      | A portal with one language shows guests no language switch                                                                                                                                                             |
| AI may translate the property's own text                                           | A new governed AI operation; drafts carry an "AI draft" tag until someone checks them, and they do not block publishing                                                                                                |
| "Guests" stays the word for every industry                                         | Nothing new                                                                                                                                                                                                            |
| The link section is called the Linktree, with an editable title                    | The default title, "Useful links", ships in every language pack; a custom title is translated like other text                                                                                                          |
| Properties can upload a logo in Property look                                      | The logo replaces the wordmark on guest pages and printed codes                                                                                                                                                        |

## What exists today and what is new

Already in the product, and reused as they are:

- Portal groups (create, rename, archive, add and remove portals), and goals that target the property, a group or single portals.
- One public address per portal, with planned replacement (old prints keep working up to 90 days), immediate security replacement and revocation.
- QR and NFC markers on that address.
- Published versions that never change, and making an earlier one live again without rewriting history.
- Responsible managers.
- The property brand: display name, logo address, default photo address, and three colours with a contrast check.
- Title and description per language, and link categories with titles.
- Governed measures for qualified scans, rating count and rating average at portal, group and property level. Each private rating already records the language the guest saw.

New in this design:

- The workspace itself: tabs, the three-column editor with a live preview, Review & publish, Share, Results and History.
- Downloading a code again, and uploads.
- Per-language link labels, four new languages and AI translation.
- Group and total rows for Google opens and private notes (readings already exist; the registry scopes were widened, ADR 0041), and "Guests by language" in Results.

## Open

- Replacing a code is drawn only as a menu entry; the planned-or-security choice is not drawn yet.
- Moving the last portal out of a group leaves it empty. Should the product archive it, offer to, or leave it?
- A photo for one portal only is not designed, although the data model allows one per portal and language.
- Round 3's open decisions ([round-3-admin](../round-3-admin/README.md)) still apply where this round did not settle them.
