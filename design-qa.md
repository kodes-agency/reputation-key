# Inbox panel design QA

Status: Passed

## Scope

- Middle review list panel and selected-review detail panel.
- Property-level default reply language with review-language override when the two differ.
- Public reply, internal note, AI drafting, autosave, approval, status, escalation, and activity states.

## Visual verification

- Verified at 1440 x 900 in the `Pages/Inbox — Approved panels` Storybook story.
- Compared against the approved middle-panel and detail-panel references.
- Confirmed hierarchy, spacing, selected-row treatment, property/source metadata, reply tabs, language control, integrated AI composer, and responsive wrapping.
- Intentional differences: live data-backed analysis labels replace illustrative labels; Bulgarian is the configured property default; unavailable metadata is omitted rather than invented.

## Functional verification

- Property name remains visible on every review row for multi-property inboxes.
- Property language is the default; review language appears as an alternate only when different.
- No back-translation panel is shown.
- Internal notes remain permission-gated and status/escalation actions remain independent.
- Keyboard focus, empty/loading/error states, autosave, AI suggestions, and approval controls are covered by component and Storybook tests.
