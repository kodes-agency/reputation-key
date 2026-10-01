// The photograph with the circle that says what every page must keep in view
// (round-4 admin boards 9 and 14: "Drag the circle onto what guests should always
// see"). The circle is one button: drag it, or press the arrow keys (Shift for a
// bigger step). Where it sits is written once the drag ends or the key is let go
// by the page's autosave, so `onChange` is called with every position and need
// not be cheap to commit.
//
// The picture is drawn at its own shape inside a box of the same shape, so the
// circle's percentages are the photograph's, not a crop's.

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '#/lib/utils'
import {
  describeFocal,
  focalFromPointer,
  nudgeFocal,
  pickerWidth,
  type FocalPoint,
} from './focal-point'

type Props = Readonly<{
  src: string
  width: number
  height: number
  focal: FocalPoint
  onChange: (focal: FocalPoint) => void
  /** Without it the circle is shown but cannot be moved. */
  disabled?: boolean
  /** The photograph's description for someone who cannot see it. */
  alt?: string
  /**
   * The box keeps the photograph's shape so the circle's percentages are the
   * photograph's, so a limit on its height is a limit on its width: the box is as
   * wide as the container allows, but no taller than this (and no wider than
   * `maxWidthRem`).
   */
  maxHeightRem: number
  maxWidthRem?: number
  className?: string
}>

export function FocalPointPicker({
  src,
  width,
  height,
  focal,
  onChange,
  disabled = false,
  alt = '',
  maxHeightRem,
  maxWidthRem,
  className,
}: Props) {
  const box = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const moveTo = (event: PointerEvent) => {
    const rect = box.current?.getBoundingClientRect()
    const next = rect ? focalFromPointer(event, rect) : null
    if (next) onChange(next)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const next = nudgeFocal(focal, event.key, event.shiftKey)
    if (!next) return
    event.preventDefault()
    onChange(next)
  }

  return (
    <div
      ref={box}
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      style={{
        aspectRatio: `${width} / ${height}`,
        width: pickerWidth(width / height, maxHeightRem, maxWidthRem),
      }}
      // A press anywhere on the photograph puts the circle there; dragging the
      // circle itself carries on from that point.
      onPointerDown={disabled ? undefined : moveTo}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        draggable={false}
        className="block size-full select-none object-cover"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-foreground/15"
      />
      {disabled ? null : (
        <button
          type="button"
          aria-label={`Focal point: ${describeFocal(focal)}. Drag, or use the arrow keys, to move it.`}
          className="absolute grid size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full border-2 border-white bg-black/20 shadow-[0_0_0_1px_rgba(16,17,21,0.4),0_2px_8px_rgba(0,0,0,0.35)] outline-none active:cursor-grabbing focus-visible:ring-[3px] focus-visible:ring-ring"
          style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
          onPointerDown={(event) => {
            isDragging.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
            moveTo(event)
          }}
          onPointerMove={(event) => {
            if (isDragging.current) moveTo(event)
          }}
          onPointerUp={(event) => {
            isDragging.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            isDragging.current = false
          }}
          onKeyDown={onKeyDown}
        >
          <span aria-hidden className="size-1 rounded-full bg-white" />
        </button>
      )}
    </div>
  )
}
