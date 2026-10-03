import type { CSSProperties } from 'react'

/**
 * What the Toaster paints from. Sonner draws a typed toast from its own hsl()
 * palette, keyed on its `theme` prop, and exposes the colours as CSS variables
 * (`--success-bg`, `--error-text`…). Setting those variables to the app's tokens
 * makes a toast follow `.dark` and mean what the same colour means in an Alert,
 * a delta or a badge. No value is a colour literal, and nothing is added to the
 * stylesheet, so first paint is unchanged.
 *
 * Each tone is a tinted surface (`background`), the text-grade ink that sits on
 * it (`text`), and an edge. The pairs are measured at 4.5:1 in both themes by
 * `toaster-theme.test.ts`.
 */
export type ToastTone = 'success' | 'info' | 'warning' | 'error'

export const TOAST_TONES = {
  success: { background: '--success-muted', text: '--positive', edge: '--success' },
  info: { background: '--accent-muted', text: '--accent-foreground', edge: '--accent' },
  warning: { background: '--warn-muted', text: '--warn', edge: '--warn-line' },
  error: { background: '--destructive-muted', text: '--negative', edge: '--destructive' },
} as const satisfies Record<
  ToastTone,
  Readonly<{ background: string; text: string; edge: string }>
>

/** The edge is a quiet line: the fill-grade colour at 40% over whatever is behind. */
const edgeOf = (token: string): string =>
  token === '--warn-line'
    ? 'var(--warn-line)'
    : `color-mix(in oklab, var(${token}) 40%, transparent)`

const toneVariables = (): Record<string, string> =>
  Object.fromEntries(
    (Object.keys(TOAST_TONES) as ToastTone[]).flatMap((tone) => {
      const { background, text, edge } = TOAST_TONES[tone]
      return [
        [`--${tone}-bg`, `var(${background})`],
        [`--${tone}-text`, `var(${text})`],
        [`--${tone}-border`, edgeOf(edge)],
      ] as const
    }),
  )

/**
 * The variables handed to Sonner. The plain toast sits on the popover surface;
 * the grays are the ones Sonner reads for a close button's hover and a loading
 * bar, which would otherwise stay light on the dark UI.
 */
export const TOASTER_STYLE = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)',
  '--gray2': 'var(--muted)',
  '--gray5': 'var(--border)',
  '--gray11': 'var(--muted-foreground)',
  ...toneVariables(),
} as CSSProperties
