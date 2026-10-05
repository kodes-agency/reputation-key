// The actions of an explicit-save group (UI consistency scan: FORM-01, FORM-19,
// ACT-04; decisions 4, 5 and 6).
//
// One row for every settings group that saves on a button: at the end of the group,
// right-aligned, the primary last. Reset sits before it and shows only while the
// group holds edits; it puts back the values the page last saved and never leaves
// the page, so a settings group has no Cancel. A save that was refused is the
// banner directly above the row. The container (a CardFooter, the end of a card's
// body, a bordered panel) stays the section's own look.
//
// Two ways to say what is dirty and what Reset restores:
// - `form`, for a TanStack Form group: dirty while a field differs from the form's
//   defaults, and Reset is `form.reset()`. The saved values must reach the form as
//   its `defaultValues` and a save that changes them must remount it (key the form's
//   component on the saved values): TanStack keeps a touched form's dirtiness from
//   before its defaults moved, so a form that is not remounted stays "dirty" after a
//   successful save.
// - `dirty` and `onReset`, for a group that keeps its own state (the responsible
//   managers' selection, the quiet hours). No `onReset` means nothing to put back
//   (a create form): the row is then just the right-aligned primary.
import { useRef, useState, type ReactNode } from 'react'
import { useStore, type AnyFormApi } from '@tanstack/react-form'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { FormErrorBanner } from './form-error-banner'

type Shared = Readonly<{
  /** The primary, last: a `SubmitButton` (or a `Button` for a group that is not a form). */
  children: ReactNode
  /**
   * A command of the group that is not part of its save (Turn off), at the start of
   * the row while Reset and the primary stay at the end.
   */
  leading?: ReactNode
  /** The failure of the last save, shown directly above the row (a form submit has no toast). */
  error?: unknown
  /** The save is in flight; Reset waits for it. */
  pending?: boolean
  className?: string
}>

type OfForm = Shared &
  Readonly<{ form: AnyFormApi; dirty?: undefined; onReset?: undefined }>

type OfState = Shared &
  Readonly<{ form?: undefined; dirty?: boolean; onReset?: () => void }>

export type FormActionsProps = OfForm | OfState

/** The first control a person edits in a group, which Reset hands the focus to. */
const FIRST_FIELD = [
  'input:not([type=hidden]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[role=combobox]:not([disabled])',
  '[role=checkbox]:not([disabled])',
  '[role=switch]:not([disabled])',
  // The button of an InheritedSetting, which is the first control of a group whose
  // value may be inherited (the Property's target).
  '[data-slot=inherited-setting] button:not([disabled])',
].join(',')

export function FormActions(props: FormActionsProps) {
  return props.form === undefined ? (
    <ActionsRow {...props} />
  ) : (
    <FormBoundActions {...props} form={props.form} />
  )
}

/** The form says whether it holds edits and how to put its values back. */
function FormBoundActions({
  form,
  pending = false,
  ...rest
}: OfForm & Readonly<{ form: AnyFormApi }>) {
  const dirty = useStore(form.store, (current) => !current.isDefaultValue)
  const submitting = useStore(form.store, (current) => current.isSubmitting)
  return (
    <ActionsRow
      {...rest}
      dirty={dirty}
      onReset={() => form.reset()}
      pending={pending || submitting}
    />
  )
}

function ActionsRow({
  children,
  leading,
  error,
  pending = false,
  dirty = false,
  onReset,
  className,
}: OfState) {
  const root = useRef<HTMLDivElement>(null)
  // A refusal belongs to the edits it refused. Reset throws those away, and a
  // mutation keeps its last error until the next attempt, so the banner is told to
  // stop showing the one it holds (every failure is a new Error: the next shows).
  const [discarded, setDiscarded] = useState<unknown>(null)
  const refusal = error === discarded ? null : error

  const reset = () => {
    onReset?.()
    setDiscarded(error)
    // The pressed button leaves with the edits: keep the focus in the group.
    const group = root.current?.closest('form') ?? root.current?.parentElement
    group?.querySelector<HTMLElement>(FIRST_FIELD)?.focus()
  }

  return (
    <div
      ref={root}
      data-slot="form-actions"
      className={cn('flex w-full flex-col gap-4', className)}
    >
      <FormErrorBanner error={refusal} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {leading ? (
          <div className="mr-auto flex flex-wrap items-center gap-2 max-sm:basis-full">
            {leading}
          </div>
        ) : null}
        {dirty && onReset ? (
          <Button type="button" variant="outline" disabled={pending} onClick={reset}>
            Reset
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  )
}
