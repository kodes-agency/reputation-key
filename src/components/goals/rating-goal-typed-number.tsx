// A number the manager types on the one-screen setup (their own pace or their
// own average): it shows the value in use, keeps what is typed while the field
// is being edited, and hands it over on Enter or when the field is left, so a
// half-typed "2" never clamps before the "0" of "20" arrives. The caller clamps
// it and says why when it moved.
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Input } from '#/components/ui/input'
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
