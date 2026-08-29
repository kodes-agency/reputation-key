import { readableForegroundOn } from './portal-contrast'

/** Domain default theme, mirrored here so a missing/partial record still renders. */
const DEFAULT_PRIMARY = '#6366F1'
const DEFAULT_BACKGROUND = '#ffffff'
const DEFAULT_TEXT = '#111827'

type PortalTheme = Record<string, string | number | boolean | null> | null | undefined

/** The stored theme is an open JSON record, so each colour is narrowed, not asserted. */
function colour(theme: PortalTheme, key: string, fallback: string): string {
  const value = theme?.[key]
  return typeof value === 'string' ? value : fallback
}

/**
 * Build the portal's CSS custom properties from its stored theme.
 *
 * Every derived tint is mixed on the palette's OWN axis rather than dimmed with
 * `opacity-*`: opacity composites against whatever is painted behind the
 * element, so a preview rendered on a dark surface produced dark-on-dark text
 * (axe measured 1.08:1). Mixing yields an opaque colour whose contrast is a
 * property of the palette, not of the container.
 */
export function resolvePortalThemeStyle(theme: PortalTheme) {
  const primaryColor = colour(theme, 'primaryColor', DEFAULT_PRIMARY)
  const backgroundColor = colour(theme, 'backgroundColor', DEFAULT_BACKGROUND)
  const textColor = colour(theme, 'textColor', DEFAULT_TEXT)

  return {
    '--portal-primary': primaryColor,
    // Chosen by luminance, not assumed: a light brand colour (the Dark palette
    // preset ships #a5b4fc) made the hardcoded white button text 1.99:1.
    '--portal-on-primary': readableForegroundOn(primaryColor),
    '--portal-bg': backgroundColor,
    '--portal-text': textColor,
    // Derived tints so surfaces and rules track the accent instead of the
    // hardcoded grays that used to make the Dark palette unreadable.
    '--portal-accent-soft': `color-mix(in srgb, ${primaryColor} 12%, transparent)`,
    '--portal-accent-border': `color-mix(in srgb, ${primaryColor} 40%, transparent)`,
    '--portal-text-muted': `color-mix(in srgb, ${textColor} 72%, ${backgroundColor})`,
  }
}
