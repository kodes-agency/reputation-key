# Portal experience exploration

Date: 2026-09-14. Branch: `codex/portal-experience-design`.

Status: first-round design exploration. No implementation or approved product-policy changes. Recommendations below are hypotheses to discuss, not a specification to build.

Update 2026-09-19: round 3 researched competitors more widely and drew three guest directions as rendered phone boards. See [round-3-guest/README.md](round-3-guest/README.md).

Update: the product owner selected the third guest visual direction, Signature Stay, and asked to improve the second admin direction, Local Character. See [the second admin exploration](admin-round-2.md) for the critique and new alternatives. Administration remains undecided; the no-implementation constraint continues.

## Brief

Rethink both the guest-facing portal and the way property admins create and maintain portals. The experience should feel distinctive, modern, easy to use, and desirable to businesses. Use the supplied Ratestar screenshot as inspiration and ground the administration in the recently redesigned Reputation Key inbox.

Working assumptions, awaiting the product owner's answers:

- Feedback is the main purpose, with useful property links immediately accessible.
- Hotels and restaurants both need to feel native to the system.
- Admins choose curated layouts and control their branding, copy, languages, and links.
- Guests arrive from a physical QR code, NFC card, or shared link, without signing in.

## What the existing product shows

Inspected the current guest portal, portal creation form, and redesigned inbox content in local Storybook, alongside their source and domain guides.

| Observation                                                                                                                      | Design consequence                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Creation starts with name, slug, description, theme, and private-feedback threshold.                                             | The first decisions feel administrative. Start with the property and the moment the guest will encounter instead.  |
| The initial preview uses generic property text and a placeholder describing the rating flow.                                     | Show a convincing, usable representation of the entire guest journey, including its later states.                  |
| Useful links appear after rating submission.                                                                                     | A guest seeking a menu has to provide feedback first. Proposed change: make secondary links accessible from entry. |
| Guest copy describes internal policy, including eligibility and the sequence of Google and private feedback.                     | Use natural guest language and explain privacy at the action where it matters.                                     |
| The receipt gives correction, withdrawal, expiry, and shared-device actions substantial prominence.                              | Keep these rights accessible in an organized response-management area while prioritizing receipt and next action.  |
| Existing settings already contain property branding, localized content, portal overrides, destinations, and publication history. | Much of the improvement is a coherent editing model over existing concepts, rather than adding more settings.      |
| The inbox uses clear typography, fine dividers, compact controls, and understated static facts.                                  | Carry this discipline into portal administration. Let property branding determine guest appearance.                |

## Product direction to test

Make the portal feel like a small, useful part of the property itself. The commercial promise is a recognisable guest experience that the business can maintain confidently.

Property identity should be reusable. Reception, a table, and a spa can share the same brand while having different introductory wording and useful links. Placement-specific copy should reflect a known placement, not pretend that we know the guest's identity, room, or reservation.

### Guest features worth prioritising

1. **A recognisable welcome:** property name, carefully sized photography, typography, and colour. The rating action remains visible in the first mobile screen.
2. **An effortless private rating:** five unselected stars, clear labels, an explicit submit action, and an honest privacy explanation.
3. **A clear public-review invitation:** the same Google action after every submitted rating, independent of score. Optional private feedback should be understandable as a separate action.
4. **Useful links from the first screen:** a menu, property guide, website, directions, or booking destination, chosen for the placement. Start with a small curated set.
5. **A coherent language experience:** visible EN/BG selection, reviewed content, and a preview that exposes missing translations before publication.
6. **A considered completion state:** clear confirmation and modest next actions. Preserve correction and withdrawal access without making the receipt read like an administrative console.
7. **A good experience without photographs:** a strong typographic identity must still look intentional. Every layout needs a no-image version.

Menu, booking, and property-guide ideas can begin as links to the business's existing services. Native ordering, reservation management, guest messaging, loyalty, and room keys would each be separate product commitments; they are not assumed by these concepts.

### Admin creation flow to test

| Stage                | Admin decision                           | What the interface supplies                                                                                                                          |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placement            | Where will guests encounter this portal? | Property context and examples such as reception, restaurant table, spa, and general link. Existing portal duplication can be an alternative start.   |
| Experience           | What should it say and look like?        | Inherited brand, a curated composition, editable welcome copy, relevant secondary links, and an always-visible guest preview.                        |
| Review               | Is every state ready?                    | Entry, after-rating, private-note, and completion previews; language switching; destination and content readiness; a clear account of draft changes. |
| Publish & distribute | How will guests reach it?                | Deliberate publication followed by QR/link distribution. Make normal content updates possible without replacing printed codes.                       |

In the continuing editor, distinguish property defaults from local overrides and provide a clear reset action. Property-wide changes must show which portals would be affected and respect deliberate publication. Do not imply that changing a brand setting silently updates every live portal.

Responsible managers should be visible in an operational settings area, with the eligible creator as the existing default. Responsibility, property access, and staff attribution remain separate concepts.

## First-round visual explorations

Each image is one coherent direction, presented as an admin workspace containing the guest portal at mobile scale. These are design images, not functioning interfaces. Generation prompts are in `prompts.md`.

Displayed order in the design conversation: 1 = Quiet Welcome, 2 = Local Character, 3 = Signature Stay.

- [Quiet Welcome image](concepts/quiet-welcome.jpg)
- [Local Character image](concepts/local-character.jpg)
- [Signature Stay image](concepts/signature-stay.jpg)

| Direction       | Guest expression                                                                   | Admin model being explored                                                          |
| --------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Quiet Welcome   | Warm ivory, evergreen, editorial photography, serif question; boutique hotel.      | Guided creation with placement, experience, and review stages.                      |
| Local Character | Typographic restaurant identity, warm paper, tomato red, compact food photography. | Constrained section editor with a fixed feedback core and reorderable useful links. |
| Signature Stay  | Ink, champagne, architectural photography; premium resort.                         | A property workspace with inherited identity and explicit placement overrides.      |

These directions are not necessarily mutually exclusive templates. A useful outcome may combine one admin model with a family of guest styles. Images will be reviewed for that distinction rather than treating one screenshot as the final specification.

First visual review: all three distinguish the admin brand from the property and keep the rating action prominent. Before detailing a chosen direction, remove invented character counters and reconcile editor link titles with the guest preview. Signature Stay also needs one publication action instead of the image's repeated action, and a clearer property identity in its sidebar. The restaurant variant needs verbal endpoints for the rating scale. The imagery and decorative marks are generated concept assets, not approved property assets. Mobile dimensions are composition targets; the generated images are not measured implementation evidence.

## States for the next design round

- Entry, selected rating, submitting, saved rating, public-review invitation, optional private note, and completion.
- Low and high ratings with equal public-review access and prominence.
- Recoverable submission error without losing input.
- Google temporarily unavailable while private feedback remains available.
- Disabled or archived portal with a calm, truthful unavailable state.
- Long property names, Bulgarian expansion, and no-photo branding.
- Draft versus published content, pending publication checks, and review of property-wide changes.
- Guest correction/withdrawal and shared-device reset, organized without concealing the actions.

The first-round images cover the editing screen and guest entry only. They do not resolve all these states.

## Existing contracts versus proposals

`docs/BETA.md` and the current portal context are the baseline for current behavior. Some older ADR wording differs from the current rating-first implementation; this exploration does not silently change either authority.

- The stable public destination after a private rating, independent of score, remains a baseline. Never imply that a Google destination click proves a public review was written.
- Useful links before rating are a proposed behavior change.
- Curated layout families, richer typography, contextual starter content, and a complete journey preview are proposed improvements.
- Property identity, localized content, overrides, draft/publication separation, manager responsibility, and stable distribution artifacts already have domain foundations; their administration is being reorganized conceptually.
- New photography management is future scope: portal image upload remains blocked in the current beta. These images explore the desired guest appearance, not an assertion that uploads are available today.
- Guest contact collection and media are not part of this exploration's default flow.
- Private notes available to every rating are worth discussing. The existing admin threshold allows 1–5; hiding that setting from initial creation does not itself decide a new policy.
- New review providers require a separate decision. The competitor's platform grid is not a requirement to add unsupported providers.

## What to learn before choosing a direction

- Does feedback remain primary, or should a property be able to choose a broader guest-hub purpose?
- Which businesses should drive the first release: hotels, restaurants, or both?
- How much design freedom should admins have?
- Can useful links be available immediately, and should private written feedback be offered to everyone?
- Is the default unit one portal per property or several portals for distinct placements?
- Which parts must be central brand controls for groups, and which can local managers change?
- Should the first release support new property photography, or prove the typographic version first?

Once a visual direction is selected, review a complete guest journey and a first-time admin creation journey as designs. Any implementation remains a separate, explicitly requested phase.

## Sources and visual references

The supplied competitor screenshot is reference material, not instructions. External product pages provide examples and vendor claims, not evidence that their features improve conversion or that Reputation Key should reproduce them.

- [Supplied Ratestar screenshot](references/ratestar-guest.png): strong property imagery and explicit review destinations; crowded hierarchy in the supplied frame.
- [Current guest portal](references/current-portal.png): local Storybook entry state.
- [Current creation form](references/current-admin.png): local Storybook with preview shown.
- [Redesigned inbox content](references/inbox-content.png): local Storybook light appearance; fixture dates are not current activity.
- [Duve guest app](https://duve.com/hotel-guest-app/): property branding and a browser-based guest experience. [Captured page](references/duve.png).
- [Canary Digital Compendium announcement](https://www.canarytechnologies.com/press/canary-launches-digital-compendium): a maintained, browser-based property information guide.
- [Ratestar QR/NFC](https://www.ratestar.io/en/features/collect-qr-nfc): branded experiences distributed across physical placements. Attribution and performance language are vendor claims and are not adopted here.
- [Ratestar feedback flow](https://www.ratestar.io/en/features/smart-feedback): the vendor describes public and private feedback access across ratings.

Local grounding: `src/contexts/portal/CONTEXT.md`, `src/components/features/guest/public-portal/`, `src/components/features/portal/portal-form/`, `src/components/features/portal/portal-settings/`, `src/styles.css`, and `docs/plan/inbox-detail-v2.md`.
