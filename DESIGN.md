---
name: Reputation Key
description: Reputation management platform — close the loop between service quality and feedback.
colors:
  spectral-violet: '#9660D8'
  spectral-violet-hover: '#AB72E8'
  spectral-violet-muted: '#272040'
  spectral-violet-foreground: '#E8E8F0'
  spectral-violet-light: '#6438C8'
  spectral-violet-light-hover: '#5328B8'
  spectral-violet-light-muted: '#E8E0F8'
  spectral-violet-light-foreground: '#FDFDFE'
  graphite-obsidian: '#1A1A24'
  graphite-surface: '#24242F'
  graphite-elevated: '#2D2D3A'
  graphite-border: '#3A3A4A'
  graphite-border-strong: '#515166'
  ink-primary: '#E8E8F0'
  ink-secondary: '#A6A6B4'
  ink-tertiary: '#737385'
  ink-primary-light: '#232232'
  ink-secondary-light: '#737385'
  ink-tertiary-light: '#A6A6B4'
  signal-red: '#D45346'
  signal-red-muted: '#351A18'
  signal-green: '#3DB878'
  signal-green-muted: '#1A3328'
typography:
  body:
    fontFamily: 'Satoshi, Inter, system-ui, -apple-system, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Satoshi, Inter, system-ui, -apple-system, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: '0.01em'
  title:
    fontFamily: 'Satoshi, Inter, system-ui, -apple-system, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.25
  headline:
    fontFamily: 'Satoshi, Inter, system-ui, -apple-system, sans-serif'
    fontSize: 'clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem)'
    fontWeight: 600
    lineHeight: 1.2
  display:
    fontFamily: 'Plus Jakarta Sans, Satoshi, system-ui, sans-serif'
    fontSize: 'clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem)'
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: '-0.01em'
  mono:
    fontFamily: 'JetBrains Mono, Fira Code, ui-monospace, monospace'
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: '2px'
  md: '6px'
  lg: '8px'
  xl: '12px'
  full: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
  2xl: '40px'
  3xl: '48px'
  4xl: '64px'
components:
  button-primary:
    backgroundColor: '{colors.spectral-violet}'
    textColor: '{colors.spectral-violet-foreground}'
    rounded: '{rounded.md}'
    padding: '8px 16px'
  button-primary-hover:
    backgroundColor: '{colors.spectral-violet-hover}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-secondary}'
    rounded: '{rounded.md}'
    padding: '8px 16px'
  button-ghost-hover:
    backgroundColor: '{colors.graphite-surface}'
    textColor: '{colors.ink-primary}'
  card:
    backgroundColor: '{colors.graphite-surface}'
    rounded: '{rounded.xl}'
    padding: '24px'
  input:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-primary}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
  badge:
    backgroundColor: '{colors.spectral-violet-muted}'
    textColor: '{colors.spectral-violet-foreground}'
    rounded: '{rounded.full}'
    padding: '2px 8px'
---

# Design System: Reputation Key

## 1. Overview

**Creative North Star: "The Precision Instrument"**

Reputation Key's interface is built like a well-made tool — every element earns its place, every surface is purposeful. The dark-first palette uses tinted violet-graphite neutrals with a single Spectral Violet accent, eliminating visual noise so users focus on the task. No glass, no gradients, no decorative textures. Hierarchy is communicated through type scale, weight contrast, and spacing rhythm alone.

The system is designed for three distinct contexts: property managers working in focused evening sessions on desktop, staff checking progress on mobile between tasks, and clients leaving reviews in brief mobile visits. Each context gets the same level of craft — responsive is not a fallback, it's the design.

This system explicitly rejects: SaaS dashboard clichés (hero metric cards, gradient accents, glassmorphism), Linear's specific cool-black-and-blue identity, over-designed admin tools with decorative motion, and the warm-cream AI default. What remains is a tool that disappears into the task.

**Key Characteristics:**

- Dark-first with clean light mode inversion
- Single Spectral Violet accent used at ≤10% of surface area
- Tonal elevation through background lightness steps, not shadows
- Fixed rem type scale for product UI consistency
- shadcn/ui component vocabulary with purposeful customization
- No decorative animation — motion conveys state, not spectacle
- Linear-inspired sidebar with two-tone treatment

## 2. Colors

A restrained palette built on tinted violet-graphite neutrals with one deliberate Spectral Violet accent. Dark and light themes share the same structure, inverted cleanly.

### Primary

- **Spectral Violet** (#9660D8 / oklch(62% 0.18 290)): The system's sole accent. Used on primary buttons, active navigation states, links, focus rings, and selection highlights. Its deliberate scarcity is the point — it signals action, not decoration.
- **Spectral Violet Hover** (#AB72E8 / oklch(68% 0.19 290)): Hover state on accent elements. Brighter but same hue; the shift communicates interactivity without breaking the palette.
- **Spectral Violet Muted** (#272040 / oklch(20% 0.04 290)): Background for accent contexts — sidebar active items, badge backgrounds, selected rows. Dark enough to recede, saturated enough to read as purple.
- **Spectral Violet Foreground** (#E8E8F0 / oklch(93% 0.008 270)): Text on accent backgrounds in dark mode. Near-white with a whisper of violet.

**Light mode primaries** are the same hue family, darkened for contrast against white backgrounds:

- **Spectral Violet Light** (#6438C8 / oklch(42% 0.18 290)): Primary accent on light backgrounds.
- **Spectral Violet Light Muted** (#E8E0F8 / oklch(93% 0.04 290)): Accent backgrounds in light mode.

### Neutral

- **Graphite Obsidian** (#1A1A24 / oklch(13% 0.008 270)): Page background. Deep, nearly black, with a violet tint that prevents the flatness of pure black.
- **Graphite Surface** (#24242F / oklch(18% 0.010 270)): Cards, panels, input backgrounds. One step lighter than the page.
- **Graphite Elevated** (#2D2D3A / oklch(22% 0.012 270)): Hovered cards, dropdowns, popovers. The third step in the tonal stack.
- **Graphite Border** (#3A3A4A / oklch(28% 0.012 270)): Subtle borders between surfaces.
- **Graphite Border Strong** (#515166 / oklch(38% 0.014 270)): Focused borders, active separators.

### Ink

- **Ink Primary** (#E8E8F0): Body text, headings. High contrast against the dark background.
- **Ink Secondary** (#A6A6B4): Labels, captions, muted content.
- **Ink Tertiary** (#737385): Placeholders, disabled text.
- Light mode inverts: Ink Primary becomes near-black (#232232), secondary/tertiary lighten proportionally.

### Semantic

- **Signal Red** (#D45346 / oklch(65% 0.22 25)): Destructive actions, error states, deletion confirmations.
- **Signal Red Muted** (#351A18 / oklch(22% 0.04 25)): Error backgrounds, destructive badges.
- **Signal Green** (#3DB878 / oklch(72% 0.15 155)): Confirmation states, positive metrics, success indicators.
- **Signal Green Muted** (#1A3328 / oklch(22% 0.03 155)): Success backgrounds.

### Named Rules

**The One Accent Rule.** Spectral Violet is used on ≤10% of any given screen. Its rarity is what gives it power. If a screen feels drab, the answer is better typography and spacing, not more accent.

**The Tonal Stack Rule.** Depth is communicated through lightness steps (Obsidian → Surface → Elevated), never through drop shadows. A surface that needs shadow to read as elevated is a surface that needs a lighter tone.

## 3. Typography

**Display Font:** Plus Jakarta Sans (with Satoshi fallback)
**Body Font:** Satoshi (with Inter, system-ui fallback)
**Mono Font:** JetBrains Mono (with Fira Code, ui-monospace fallback)

**Character:** Satoshi carries the system — geometric but warm, highly legible at body sizes, with enough character at larger weights to serve headings. Plus Jakarta Sans steps in for display moments where more personality is warranted. The pairing is subtle: both are geometric sans families, separated by weight and proportion, not category. JetBrains Mono anchors data with precision.

### Hierarchy

- **Display** (700, clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem), 1.15): Page titles, hero sections. Plus Jakarta Sans. Tracking at -0.01em for tightness at scale. Ceiling at 2.25rem — this is a tool, not a billboard.
- **Headline** (600, clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem), 1.2): Section headings, card titles. Satoshi. The workhorse heading.
- **Title** (600, 1.125rem, 1.25): Panel headings, dialog titles, sidebar sections. Satoshi. Fixed size — consistent across viewports.
- **Body** (400, 0.9375rem / 15px, 1.55): All body copy. Max line length 65-75ch where prose is present. Satoshi. The 15px base size optimizes for data-dense interfaces without sacrificing readability.
- **Label** (500, 0.8125rem / 13px, 1.4, 0.01em tracking): Captions, metadata, timestamps. Satoshi in medium weight for legibility at small sizes.
- **Mono** (500, 0.875rem / 14px, 1.4): Metrics, codes, table data. JetBrains Mono. Slightly smaller than body for tabular density.

### Named Rules

**The Fixed Scale Rule.** Product UI uses fixed rem sizes, not fluid clamps. Headings that shrink in sidebars or data panels look broken, not responsive. The only exceptions are Display and Headline, which use conservative clamps for page-level hierarchy.

**The Three-Family Cap.** Satoshi, Plus Jakarta Sans, JetBrains Mono. No fourth font. One well-tuned sans with weight contrast carries more authority than three competing faces.

## 4. Elevation

This system is flat at rest. Depth is communicated through tonal layering — three background lightness steps (Obsidian → Surface → Elevated) that create spatial hierarchy without shadows. There is no box-shadow vocabulary; the Tailwind `shadow-sm` and `shadow-xs` utilities inherited from shadcn/ui are applied sparingly to inputs and cards as subtle ambient indicators, not structural depth cues.

In light mode, the same tonal stack inverts: near-white backgrounds step from page (98% lightness) through surface (100%) to elevated (100% with a whisper of violet chroma). The effect is the same — surfaces lift through brightness, not shadow.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows, when they appear at all, are ambient hints (≤8px blur) applied to inputs and focus rings, not structural elements. If a surface needs a 16px+ blur shadow to read as elevated, it needs a lighter background instead.

**The Ghost Border Fallback.** When two flat surfaces of the same tone need separation, a 1px border at `--border` provides the division. The border disappears when the surfaces differ in tone.

## 5. Components

### Buttons

- **Shape:** Rounded at 6px (`--radius-md`). Tight enough to read as precise, open enough to not feel sharp.
- **Primary:** Spectral Violet background, near-white text. Hover lightens to Spectral Violet Hover. Transition: 150ms ease-out on background-color only.
- **Ghost:** Transparent background, Ink Secondary text. Hover fills with Graphite Surface and switches to Ink Primary.
- **Outline:** Transparent background, Graphite Border ring, Ink Primary text. Hover fills with accent-muted background. Used for secondary actions that need more presence than ghost.
- **Destructive:** Signal Red background, white text. Hover darkens slightly.
- **All buttons:** `font-weight: 500`, `font-size: 0.875rem` (14px). Focus-visible ring at Spectral Violet with 3px offset. Disabled state at 50% opacity. Sizes: default (h-9), sm (h-8), lg (h-10), xs (h-6), plus icon-only sizes at matching heights.

### Cards

- **Shape:** Rounded at 12px (`--radius-xl`). The only component with a larger radius, justified by its role as a visual container.
- **Background:** Graphite Surface. No shadow (the tonal step from Obsidian provides separation). 1px border at Graphite Border.
- **Internal padding:** 24px (`px-6 py-6`). Header, content, and footer sections each get horizontal padding; the card itself carries vertical.
- **Hover:** Transitions to Graphite Elevated with Graphite Border Strong border. 150ms ease-out.

### Inputs

- **Shape:** Rounded at 6px, 36px height. Transparent background lets the parent surface color show through; in dark mode, a 30% opacity Graphite Border backing provides subtle fill (Tailwind `bg-input/30`).
- **Border:** 1px Graphite Border. Focus shifts to Spectral Violet ring (3px, 50% opacity).
- **Placeholder:** Ink Tertiary, matching the 4.5:1 contrast requirement.
- **Error:** Border shifts to Signal Red with a matching red ring.
- **Disabled:** 50% opacity, `cursor: not-allowed`.

### Badges

- **Shape:** Fully rounded (9999px), 2px horizontal padding, 2px vertical. Font size 12px, medium weight.
- **Default:** Spectral Violet Muted background, Spectral Violet Foreground text. The purple reads as a category tag, not a button.
- **Secondary:** Graphite Surface background, Ink Secondary text. For neutral metadata.
- **Destructive:** Signal Red Muted background, white text.
- **Outline:** Transparent background, Graphite Border border, Ink Primary text.

### Navigation (Sidebar)

- **Width:** 256px expanded, 48px collapsed. Collapses to sheet drawer below 1024px (lg breakpoint).
- **Background:** Same as page (Graphite Obsidian). No distinction between sidebar and content area — they share the same foundation.
- **Active item:** Spectral Violet Muted background with Spectral Violet text, font-weight 600. The muted purple fills the row, creating the Linear-style indent signal.
- **Inactive item:** Ink Secondary text, no background. Hovered: subtle Graphite Surface background.
- **Icons:** Spectral Violet color in both themes. Lucide icon set, 16px, 1.5px stroke width. The consistent purple icon treatment anchors the navigation hierarchy.
- **Section groups:** Separated by 1px Graphite Border lines. Group labels use the overline style (12px, 600 weight, uppercase, wide tracking).

### Tables

- **Header:** Graphite Surface background, overline typography (12px, 600 weight, uppercase, letter-spacing 0.06em).
- **Body:** Ink Primary text, Graphite Border row separators. No zebra striping in dark mode (the subtle border is enough).
- **Density:** Compact row height for data scanning. Monospace font for numeric columns.

### Empty States

- **Layout:** Centered, generous vertical padding (48px+). Ink Secondary icon or illustration.
- **Copy:** One line of body text, one clear primary action. No apologetic language.
- **Button:** Single primary button using the verb+object pattern ("Create property", "Add integration").

## 6. Do's and Don'ts

### Do:

- **Do** use Spectral Violet for primary actions, active states, and focus indicators only. Its power comes from scarcity.
- **Do** communicate depth through tonal layering (Obsidian → Surface → Elevated). A lighter surface reads as elevation.
- **Do** use the 6px radius for buttons and inputs, 12px for cards. Consistency in shape vocabulary builds trust.
- **Do** keep body text at 15px with 1.55 line-height. The slight increase over 14px matters for readability in data-dense screens.
- **Do** use Satoshi at 500-600 weight for labels and headings. The medium weights carry enough presence without bold's aggression.
- **Do** respect the three-font cap: Satoshi, Plus Jakarta Sans, JetBrains Mono. No fourth family.
- **Do** keep animations to 150ms ease-out for micro-interactions, 200ms for layout transitions. Motion is state feedback, not decoration.
- **Do** respect `prefers-reduced-motion` — all transitions become instant.

### Don't:

- **Don't** use drop shadows for elevation. Tonal layering is the system. If a surface needs a shadow to read as elevated, its tone is wrong.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent. The side-stripe border is never intentional.
- **Don't** use gradient text (`background-clip: text`). Emphasis comes from weight and size, never a gradient.
- **Don't** use glassmorphism or backdrop-filter blur for decorative surfaces. This is a tool, not a showcase.
- **Don't** ship hero-metric cards (big number + small label + gradient accent). Data deserves better than SaaS clichés.
- **Don't** use identical card grids of icon + heading + text repeated endlessly. Card grids earn their place when the content varies; otherwise, a list or table is the right affordance.
- **Don't** add tiny uppercase tracked eyebrows above every section. One deliberate eyebrow as brand voice is fine; an eyebrow on every section is AI grammar.
- **Don't** use numbered section markers (01 / 02 / 03) as default scaffolding. Numbers earn their place only when the section is a real sequence.
- **Don't** use display fonts in UI labels, buttons, or data. Plus Jakarta Sans is for page titles only.
- **Don't** imitate Linear's exact color palette (blue-purple on cool blacks). We want their focus and simplicity, not their specific visual identity.
- **Don't** use warm cream/sand/beige backgrounds in light mode. The neutrals are tinted toward Spectral Violet (hue 270), not toward warmth (hue 40-100).
- **Don't** over-round elements. Cards top out at 12px; buttons and inputs at 6px. The 32px+ radius on cards is a tell.
