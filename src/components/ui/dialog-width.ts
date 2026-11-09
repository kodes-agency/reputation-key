// How wide a dialog or a confirmation is, in one place so the Dialog and the
// AlertDialog under the ConfirmationDialog cannot drift apart.
//
// A size only names `--dialog-w`; the cap turns it into `min(--dialog-w, window - 1rem
// a side)` at every width. A bare `sm:max-w-4xl` would sit flush with both edges in a
// 768px window, and the margin is the one thing no size may give up.
// `dialog.metrics.ts` measures every size from a phone to a desktop.

/** The width of a fixed, centred dialog: its size, or the window less 1rem a side. */
export const DIALOG_WIDTH_CAP = 'max-w-[min(var(--dialog-w),calc(100%-2rem))]'

/**
 * The widths a dialog comes in: `sm` a short list (24rem), `md` a form of a few
 * fields (32rem, the default), `lg` a form with a column of choices (42rem), `xl` a
 * form beside its preview (56rem).
 */
export const DIALOG_SIZE = {
  sm: '[--dialog-w:24rem]',
  md: '[--dialog-w:32rem]',
  lg: '[--dialog-w:42rem]',
  xl: '[--dialog-w:56rem]',
} as const

export type DialogSize = keyof typeof DIALOG_SIZE
