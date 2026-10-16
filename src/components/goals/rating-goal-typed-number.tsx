// A number the manager types on the one-screen setup (their own pace or their
// own average): it shows the value in use, keeps what is typed while the field
// is being edited, and hands it over on Enter or when the field is left, so a
// half-typed "2" never clamps before the "0" of "20" arrives. The caller clamps
// it and says why when it moved (`RatingGoalClampNote`).
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Input } from '#/components/ui/input'
import { TONE_ICON, TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'

type Props = Readonly<{
  /** The value in use, as the field shows it. */
  shown: string
  inputMode: 'decimal' | 'numeric'
  labelledBy: string
  describedBy: string
  onCommit: (raw: string) => void
  /** What follows the field: its unit or a star. */
  children: ReactNode
  className?: string
}>

export function RatingGoalTypedNumber(props: Props) {
  const [typed, setTyped] = useState<string | null>(null)
  const commit = () => {
    if (typed === null) return
    props.onCommit(typed)
    setTyped(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commit()
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5', props.className)}>
      <Input
        inputMode={props.inputMode}
        value={typed ?? props.shown}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-labelledby={props.labelledBy}
        aria-describedby={props.describedBy}
        className="text-right font-semibold"
        style={{ width: 76 }}
      />
      {props.children}
    </span>
  )
}

const WarnIcon = TONE_ICON.warn

/**
 * Why a typed number moved ("We plan with 4.1 to 5.0, so we used 4.1."), set
 * before the note it belongs to. The words are the foreground ink and the
 * warning triangle the amber: amber text on the plan's muted card is 4.44:1,
 * under AA, where an icon needs only 3:1. Inline sizes, so no new utility
 * reaches the one stylesheet.
 */
export function RatingGoalClampNote({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="text-foreground">
      <WarnIcon
        aria-hidden="true"
        size="1em"
        className={TONE_INK.warn}
        style={{ display: 'inline', verticalAlign: '-0.125em', marginInlineEnd: 4 }}
      />
      {children}{' '}
    </span>
  )
}
