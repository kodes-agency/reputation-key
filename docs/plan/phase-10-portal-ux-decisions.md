# Phase 10 — Portal Management UX Redesign — Decision Log

**Date:** 2026-05-02
**Session:** Grilling session for portal management UX overhaul — guest URL visibility, QR generation, live preview, theme presets, page structure, and link tree editing.

---

## Architecture Decisions

### A1. Shared Portal Preview Component

**Decision:** Extract `<PublicPortalContent>` as a reusable component used by both the public route (`/p/$orgSlug/$portalSlug`) and all admin preview surfaces (slide-over panel, creation form preview, link tree split view).
**Reasoning:** Single source of truth for portal rendering. Eliminates iframe/component inconsistency. Ensures managers see exactly what guests see.

### A2. CSS Style Isolation Strategy

**Decision:** Wrap `<PublicPortalContent>` in a `.portal-preview-root` CSS-scoped container with namespaced custom properties (`--portal-primary`, `--portal-bg`, `--portal-text`). No Shadow DOM.
**Reasoning:** Simpler integration with React/Tailwind. Avoids Shadow DOM complexity while preventing style bleed into the admin panel.

### A3. QR Code Delivery

**Decision:** QR modal with preview + download PNG button. Existing `GET /api/portals/:id/qr` API reused. Print-ready card template deferred.
**Reasoning:** Managers need to verify QR before printing/downloading. Modal provides confirmation without leaving context. Print template is a nice-to-have, not core.

---

## Domain Decisions

### D1. Portal Page Structure — Single Page, No Tabs

**Decision:** Replace the three-tab layout (Settings / Links / Preview) with a single-page layout containing three always-expanded sections: Settings, Link Tree, Share. Preview becomes a slide-over panel.
**Reasoning:** Tabs fragment the editing context. Managers need to see settings, links, and preview in one flow. Preview is a view, not an edit surface — doesn't deserve tab status.

### D2. Section Layout — No Collapse

**Decision:** All three sections (Settings, Link Tree, Share) are always expanded. No accordion or collapse behavior.
**Reasoning:** Reduces state management complexity. Portal configuration is compact enough to scroll through. Collapse adds cognitive overhead without meaningful benefit.

### D3. Slide-Over Preview Panel

**Decision:** Fixed mobile-width (~400px) preview with gray gutters, rendered as a slide-over panel. On smaller screens, becomes a modal overlay.
**Reasoning:** 99% of guests use phones. Previewing at desktop width gives a false sense of how the portal looks. Gray gutters reinforce the mobile context.

### D4. Optimistic Preview Sync

**Decision:** The slide-over preview reflects unsaved changes immediately. What you see is what you're building, not what guests see right now.
**Reasoning:** Managers need instant visual feedback while editing links and settings. Waiting for server round-trips breaks the creative flow.

### D5. Theme Presets

**Decision:** Three presets — Light, Dark, Brand (subtle accent) — plus full custom color overrides.

- **Light:** White bg, dark text, primary color for accents
- **Dark:** Dark bg (#111827), light text, primary color for accents
- **Brand:** Primary color as accent only — subtle tinted backgrounds, matching buttons, mostly neutral
  **Reasoning:** Reduces decision fatigue for non-designers. Power users can still customize everything. Brand preset avoids overwhelming color use while maintaining identity.

### D6. Smart Routing Configuration UX

**Decision:** Side-by-side visual cards showing "Below threshold" vs "At or above threshold" behavior, with the threshold slider between them. Labels corrected to say "Emphasize feedback for low ratings" (not "Show review links only...").
**Reasoning:** Current checkbox+slider is misleading and potentially non-compliant (implies gating). Side-by-side cards make the emphasis-shift behavior explicit. Correct language protects against anti-gating violations.

---

## Implementation Decisions

### I1. Guest URL Placement

**Decision:** Guest URL displayed in the Settings section, next to the slug field, with a copy-to-clipboard button. URL format: `/p/{orgSlug}/{portalSlug}`.
**Reasoning:** URL is derived from the slug — placing them together makes the relationship clear. Copy button enables quick sharing.

### I2. Portal Creation Form

**Decision:** Single-step form with a toggleable live preview sidebar on the right. Preview shows hero placeholder, name, description, theme color, and a "Your links will appear here" note. Toggle state persisted per-user via localStorage. On mobile, preview becomes a modal overlay.
**Reasoning:** Single-step reduces friction. Live preview builds confidence before creation. Persisted toggle respects user preference.

### I3. Portal List Enhancements

**Decision:** Enhanced table with additional columns: guest URL (with copy button), QR icon (opens modal), preview icon, theme color swatch. Card-based layout toggle deferred to a later phase.
**Reasoning:** Managers need quick access to sharing tools from the list view. Table scales better than cards as portal count grows. Card toggle can be added when the feature set matures.

### I4. Link Tree Section — Inline Preview

**Decision:** The Link Tree section uses the shared `<PublicPortalContent>` component for the slide-over preview, not an iframe. Changes to categories and links reflect instantly in the preview.
**Reasoning:** Iframes require reload/cache-busting to reflect changes. Inline component gives instant feedback. CSS scoping (A2) prevents style conflicts.

### I5. Preview Toggle Persistence

**Decision:** Slide-over panel open/closed state persisted via localStorage, keyed by portal ID.
**Reasoning:** Managers who prefer working with the preview visible shouldn't have to re-enable it on every navigation.

### I6. Portal Creation — Auto-Generated Slug

**Decision:** Slug auto-generated from the property name during portal creation, but remains editable.
**Reasoning:** Reduces errors and ensures slug matches property identity. Editable for edge cases (abbreviations, multi-language names).

---

## UI Component Inventory

### New Components Required

| Component               | Purpose                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `<PublicPortalContent>` | Extracted portal rendering component (hero, name, description, stars, feedback, links)     |
| `<PortalPreviewPanel>`  | Slide-over panel wrapping `<PublicPortalContent>` with mobile-width frame and gray gutters |
| `<QRCodeModal>`         | Modal showing QR preview, guest URL, copy button, download button                          |
| `<ThemePresetSelector>` | Preset selector (Light/Dark/Brand) with custom override color pickers                      |
| `<SmartRoutingConfig>`  | Side-by-side threshold cards with slider                                                   |
| `<ShareSection>`        | Guest URL + copy button + QR modal trigger                                                 |
| `<PortalCreationForm>`  | Single-step form with toggleable preview sidebar                                           |

### Removed/Replaced Components

| Component                         | Fate                                         |
| --------------------------------- | -------------------------------------------- |
| `preview.tsx` route               | Deleted — replaced by `<PortalPreviewPanel>` |
| Tab navigation in `$portalId.tsx` | Deleted — replaced by single-page sections   |
| Standalone preview tab            | Eliminated                                   |

---

## Page Layout — Portal Detail

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back    Portal: "Beach House Resort"         [Preview ▾] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ Settings ────────────────────────────────────────────┐ │
│  │ Hero Image: [upload area]                             │ │
│  │ Name: [Beach House Resort]                            │ │
│  │ Slug: [beach-house-resort]  → /p/org/beach-house-... │ │
│  │ Theme: [Light] [Dark] [Brand] [Custom ▾]              │ │
│  │ Smart Routing: [Below ▼] [Slider] [Above ▲]           │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ Link Tree ───────────────────────────────────────────┐ │
│  │ [+ Add Category]                                      │ │
│  │ ▾ Reviews                                             │ │
│  │   - Google Reviews [edit] [delete]                    │ │
│  │   - TripAdvisor [edit] [delete]                       │ │
│  │ ▾ Social                                              │ │
│  │   - Instagram [edit] [delete]                         │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ Share ───────────────────────────────────────────────┐ │
│  │ Guest URL: /p/org/beach-house-resort  [Copy] [QR]     │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Slide-over panel (toggled via [Preview] button):

```
┌──────────────────────┐
│ Beach House Resort  ✕│
│ ┌──────────────────┐ │
│ │                  │ │
│ │   [Portal        │ │
│ │    Preview]      │ │
│ │   (400px wide)   │ │
│ │                  │ │
│ └──────────────────┘ │
│   (gray gutters)     │
└──────────────────────┘
```

---

## Deferred Decisions

| Item                                            | Reason                                         |
| ----------------------------------------------- | ---------------------------------------------- |
| Print-ready QR card template                    | Nice-to-have, not core to sharing flow         |
| Card-based portal list layout                   | Table works for now; toggle can be added later |
| Analytics columns in portal list                | Comes in later phase (analytics/inbox)         |
| Device toggle in preview (phone/tablet/desktop) | Mobile-first is sufficient for v1              |
