# Reply toolbar design QA

## Comparison target

- Source visual truth: `/Users/bozhidardenev/.codex/generated_images/01a02897-7c9f-7b32-a263-bd21befbba53/exec-e7676bb6-485d-4838-9516-4f4e4aebfa87.png`
- Browser-rendered implementation: `/Users/bozhidardenev/.codex/visualizations/2026/08/22/01a02897-7c9f-7b32-a263-bd21befbba53/reply-toolbar-full.png`
- Focused implementation crop: `/Users/bozhidardenev/.codex/visualizations/2026/08/22/01a02897-7c9f-7b32-a263-bd21befbba53/reply-toolbar-implementation.png`
- Combined comparison: `/Users/bozhidardenev/.codex/visualizations/2026/08/22/01a02897-7c9f-7b32-a263-bd21befbba53/reply-toolbar-comparison.png`
- Local route: `http://127.0.0.1:6006/iframe.html?id=inbox-detail-content--reply-toolbar-with-languages&viewMode=story`

## Viewport and normalization

- Implementation viewport: 842 × 837 CSS px, light theme, reported device pixel ratio 2.
- Implementation capture: 842 × 837 px; the in-app browser capture is CSS-pixel normalized. The compared toolbar/editor crop is 842 × 264 px.
- Source capture: 2240 × 702 px. It was proportionally normalized to 842 × 264 px so the source and implementation regions could be judged together at equal pixel dimensions.
- State: Public reply selected, Bulgarian selected as the property default, Turkish available as the review-language alternative, empty editor, and no hover or focus treatment.

## Comparison evidence

The full implementation view confirms that the toolbar sits between the review and composer without changing the surrounding detail-panel hierarchy. The focused combined image compares the complete supplied reference against the same toolbar-and-editor region in the browser-rendered implementation. A separate micro-crop was not needed because the supplied source is itself a focused component visual and the equal-size comparison keeps labels, icons, borders, and the underline readable.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation retains the product's existing sans-serif tokens and matches the reference hierarchy: semibold active mode, muted inactive mode, medium language value, and muted source descriptor. Labels remain single-line and truncate safely.
- Spacing and layout rhythm: tabs and language control share an exact 40 px control row and optical baseline. The selector is aligned to the content edge; the editor begins below the complete toolbar without overlap. At the narrower full-inbox panel width, the selector moves to its own full-width row with zero horizontal overflow.
- Colors and visual tokens: the active underline uses the existing product violet; resting borders, background, foreground, and muted text use the established theme tokens. The permanent purple halo from the original broken state is gone, while keyboard-only focus remains visible.
- Image and asset fidelity: the target contains no raster imagery. Message, lock, globe, and chevron icons come from the product's existing Lucide/shadcn icon system; no custom SVG, CSS drawing, emoji, or placeholder asset was introduced.
- Copy and content: the resting control reads `Bulgarian · Property default`; choosing the alternate changes it to `Turkish · Review language`. The redundant heading and helper sentence were removed while the stable accessible name `Reply language` was preserved.
- Behavior and accessibility: Public reply and Internal note keep Radix tab semantics. Internal note removes the contextual language control; returning to Public reply restores it. The menu supports keyboard opening and exposes both named options. Controls are at least 40 px high and the component has no horizontal overflow.

## Comparison history

1. Initial browser comparison found one P2 accessibility/fidelity issue: shared shadcn variant selectors were winning over local height utilities, leaving both toolbar controls at 36 px instead of the reference's 40 px target.
2. The tab list received an explicit 40 px override and the select trigger received a state-specific 40 px height. The implementation was recaptured in the same viewport and resting state.
3. Post-fix evidence measures both the tab list and language control at exactly 40 px high, with matching top and bottom coordinates and no document overflow. The revised combined comparison contains no remaining P0/P1/P2 issue.

## Verification

- Focused Storybook browser tests: 20 passed across the detail-content and approved-inbox stories.
- Reply-language option unit tests: 8 passed.
- Targeted lint and full TypeScript checks passed.
- Primary interactions checked: mode switching, language menu keyboard opening, property/review language selection, contextual label update, and narrow-width reflow.
- No targeted Storybook console failures or browser-rendered error state were observed.

final result: passed
