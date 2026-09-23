# Portal administration — second exploration

Date: 2026-09-14. Design only, on `codex/portal-experience-design`.

## Product-owner direction

The third guest portal from the first round, **Signature Stay**, is the selected guest visual direction. The second admin, **Local Character**, is the preferred starting point but needs further work. No admin direction is approved. The request is to analyse the concepts and provide new options, not implement them.

The comparison in this round keeps the property, portal, guest copy, guest style, and draft state consistent. The variable is how the admin selects and edits content.

## Review of the preferred starting point

Evidence is the [first-round admin concept](concepts/local-character.jpg) and [selected guest concept](concepts/signature-stay.jpg), inspected directly. This is a review of static design images, not a usability test or an audit of running software.

| Finding                                                          | Evidence in the concept                                                                                                              | Proposed improvement                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editing starts too far down the page.                            | The portal title, tabs, large introductory heading, explanatory line, and spacing occupy much of the upper portion.                  | Use the portal name as the main heading. Put actual editable content near the top.                                                                        |
| The selected object and its controls feel detached.              | The highlighted menu link sits above another link, an add action, and a divider before its separate edit form appears.               | Expand controls inside the selected row, or bind the selection clearly to an inspector and preview outline.                                               |
| The guest preview does not match the editor's wording.           | The editor says “View the menu” and “Reserve a table”; the guest sees “The menu” and “Come by again.”                                | Use identical titles in the editor and preview. Derived labels would need an explicit product model.                                                      |
| Save and publication are ambiguous.                              | “Draft” and “Review & publish” do not say whether edits are saved or whether any version is already public.                          | For a new portal: “Draft saved · Not published.” For an existing portal, distinguish saved draft changes from the currently live version.                 |
| Multiple levels compete for attention.                           | Global navigation, content tabs, section rows, link controls, preview language, and preview state tabs all occupy substantial space. | Give each level one job; compare a section editor, a focused visual editor, and a journey editor.                                                         |
| Inheritance is stated but not explained at the point of editing. | “Using Forma Kitchen branding” does not reveal whether editing copy or imagery changes this portal or the whole property.            | Show the edit scope near its fields and provide an explicit “Use property wording” reset. Property-wide edits require a separate scope and impact review. |
| Deletion is too visually prominent for ordinary editing.         | “Remove link” is a red action beside the edit heading even when the admin is simply changing text.                                   | Place it in the link's action menu; provide a recoverable draft operation and undo.                                                                       |
| Preview interaction is under-specified.                          | “Arrival / After rating / Thank you” selects states but does not distinguish editing the preview from exercising its controls.       | Separate content selection from “Try as guest.” Test mode should be simulated and must not write guest responses or analytics.                            |

The useful elements to retain are the recognisable section list, lightweight link rows, clear primary action, and visible mobile preview. The admin should remain neutral and purple; the guest portal retains Avela's dark ink, champagne, resort photography, and serif typography.

## Three interaction models

The images appeared in this order in the conversation:

1. [Refined Sections](concepts/admin-round-2/refined-sections.jpg)
2. [Visual Studio](concepts/admin-round-2/visual-studio.jpg)
3. [Guest Journey](concepts/admin-round-2/guest-journey.jpg)

Created with the built-in Imagegen tool. The exact brief and prompts are saved in [admin-round-2-prompts.md](admin-round-2-prompts.md).

### Refined Sections

An evolution of the preferred second concept. A familiar admin rail, a compact Content/Appearance/Languages navigation, and a section list beside a clean guest preview. The selected welcome section expands where it is listed, so its label, scope, and fields remain together.

- Best hypothesis: easiest for an occasional property manager to understand.
- Advantage: familiar forms, low learning cost, straightforward keyboard reading order.
- Tradeoff: the manager still maps an editor section to the guest screen; longer sections need careful independent scrolling and preview anchoring.

### Visual Studio

A focused editor with page structure on the left, the guest page in the centre, and a concise inspector on the right. The same section name and selection appear in the outline, preview, and inspector. Edit and Test modes are explicit.

- Best hypothesis: fastest visual corrections once the interaction model is learned.
- Advantage: the selected content and its settings are directly connected.
- Tradeoff: three regions can feel more technical. Narrow-screen behaviour and keyboard selection need deliberate design. A manager should never need to understand layout coordinates or design-tool terminology.

### Guest Journey

An editor organised by the screens a guest can encounter: Welcome, After rating, optional Private feedback, and Thank you. The centre edits the selected state; the preview stays synchronised. Appearance and languages remain shared controls.

- Best hypothesis: makes the complete experience easier to understand and review before first publication.
- Advantage: encourages review of later states, not just the attractive entry screen.
- Tradeoff: a vertical sequence can falsely imply that every guest follows every step. Optional states must be labelled, and the model must never become a rating-dependent public-review routing builder.

These are alternatives to compare, not three separate products to implement. My starting preference is Refined Sections for the normal editor, with a guest-journey walkthrough in its testing and publication review. Visual Studio is worth choosing only if direct selection materially helps the intended admins.

## Proposed creation and publication flow

1. **Start a portal:** choose the property if not already scoped, give the portal an internal name, and optionally choose its placement. Inherit the property's approved appearance and default wording. Slugs and technical identifiers do not lead the experience.
2. **Edit the experience:** change the welcome message and a small set of useful links. See the exact guest rendering. Mark local overrides at the point of editing. Save into a draft.
3. **Try and review:** test the guest states without creating real responses, check both enabled languages, inspect destination readiness, and review changes. This step exposes concrete problems instead of showing a generic warning banner.
4. **Publish, then distribute:** publication is a deliberate final action. After success, present the public link and QR distribution controls. Normal content edits retain existing printed addresses unless the admin explicitly replaces them.

The three mockups show stage 2 for a new Reception portal at Avela Resort. They do not yet depict stages 1, 3, or 4.

## Shared behavior to resolve in detailed design

- **Save:** `Saving…`, `Draft saved`, and `Could not save` are distinct. A failure preserves local work, offers retry, and prevents a misleading successful-publication path. Automatic draft saving is a proposed improvement, not an assertion about the current forms.
- **Scope:** local wording edits affect Reception. Editing shared property identity is a separately scoped action. List affected portals before applying a shared change; respect deliberate publication of each live experience.
- **Preview:** use one coordinated language selection for editor and preview. Guest language controls remain part of the guest page but must stay synchronised in testing. Show the active guest state clearly.
- **Editing versus testing:** selecting a section cannot submit feedback. Testing uses simulation, including submission failures and different rating values. It must not count as a public visit, store a guest response, or accidentally navigate to a review provider.
- **Publication:** “Review & publish” opens a review step. “Publish portal” is the final action after successful readiness checks. The existing post-publication content-review attestation remains a separate domain concept; this proposed pre-publication walkthrough does not silently redefine it.
- **Links:** maintain matching labels between fields and preview. Offer keyboard-accessible move controls alongside drag handles. Undo removal within the draft.
- **Languages:** do not imply translations are approved merely because a second locale is enabled. Show what needs attention when switching language or reviewing for publication.
- **Access:** manager responsibility, property access, and staff attribution stay separate. Creation should use existing defaults where possible instead of opening with another assignment form.
- **Appearance:** curated styles and photo management remain exploratory scope. Portal uploads are still blocked in the current beta. The chosen visual direction does not authorize implementing those capabilities.

## Visual and accessibility limits

Review of the generated images: all three retain the selected guest direction and align the edited welcome copy with its preview. Refined Sections demonstrates improved proximity but adds more enclosing borders than intended; the detailed version should return to flatter rows. Visual Studio makes selection clear but should consolidate its “Test” and “Try as guest” entries. Guest Journey duplicates the property-wording reset action; it needs only one. The generated counters in Visual Studio and Guest Journey are not approved constraints and should be removed. These observations are recorded so image-generation details are not accidentally treated as product decisions.

These are static generated mockups. They can demonstrate hierarchy, labels, field proximity, and the relationship between selection and preview. They cannot verify keyboard focus, target size, screen-reader names, colour contrast, save behaviour, actual 390px rendering, or mobile administration.

The next detailed design should include empty and long-content states, missing translations, save failure, publication failure, a no-image guest variant, and a narrow-screen admin layout. Preserve the chosen guest visual direction while validating it at realistic mobile sizes.

## Reference patterns

- [Shopify preview inspector](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/preview-inspector): selecting a visible section connects it to its settings. This supports the Visual Studio interaction idea; it is not evidence that it is the best choice for Reputation Key's admins.
- [Shopify theme editor overview](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/features-overview): separates structure, preview, and selected settings and describes a stacked mode at narrower widths.
- [Framer on-page editing](https://www.framer.com/help/articles/on-page-editing/): content can be edited from its rendered context. Reputation Key would retain its own deliberate draft/publication model.
- [Existing inbox reference](references/inbox-content.png): restrained controls, clear facts, light dividers, and consistent typography.

External references inform interaction patterns only. The visual references supplied to image generation are the previous admin concept, the selected guest concept, and the existing inbox capture.
