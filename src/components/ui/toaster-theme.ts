import type { CSSProperties } from 'react'

/**
 * What the Toaster paints from. Sonner draws a typed toast from its own hsl()
 * palette, keyed on its `theme` prop, and exposes the colours as CSS variables
 * (`--success-bg`, `--error-text`…). Setting those variables to the app's tokens
 * makes a toast follow `.dark` and mean what the same colour means in an Alert,
 * a delta or a badge. No value is a colour literal, and nothing is added to the
 * stylesheet.
 *
 * Each tone is a tinted surface (`-bg`), the text-grade ink that sits on it
 * (`-text`) and an edge (`-border`): success is `--success-muted` with
 * `--positive`, error `--destructive-muted` with `--negative`, warning
 * `--warn-muted` with `--warn`, info `--accent-muted` with `--accent-foreground`.
 * `toaster-theme.test.ts` reads the pairs back from this object and measures
 * them at 4.5:1 in both themes.
 *
 * A plain object literal, not generated: the Toaster is mounted by the root
 * route, so this is in the first-paint closure, which has bytes to spare for
 * nothing.
 */
export const TOASTER_STYLE = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)',
  // Sonner's close-button hover reads these grays.
  '--gray2': 'var(--muted)',
  '--gray5': 'var(--border)',
  '--success-bg': 'var(--success-muted)',
  '--success-text': 'var(--positive)',
  '--success-border': 'color-mix(in oklab, var(--success) 40%, transparent)',
  '--info-bg': 'var(--accent-muted)',
  '--info-text': 'var(--accent-foreground)',
  '--info-border': 'color-mix(in oklab, var(--accent) 40%, transparent)',
  '--warning-bg': 'var(--warn-muted)',
  '--warning-text': 'var(--warn)',
  '--warning-border': 'var(--warn-line)',
  '--error-bg': 'var(--destructive-muted)',
  '--error-text': 'var(--negative)',
  '--error-border': 'color-mix(in oklab, var(--destructive) 40%, transparent)',
} as CSSProperties
