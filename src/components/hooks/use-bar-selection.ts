import { useState, type KeyboardEvent, type PointerEvent } from 'react'

/** One keyboard stop; pointer, touch and keys inspect the same column. */
export function useBarSelection(count: number) {
  const [active, setActive] = useState<number | null>(null)
  const selected = Math.min(active ?? count - 1, count - 1)
  const selectPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setActive(
      Math.min(
        count - 1,
        Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count)),
      ),
    )
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = {
      ArrowLeft: Math.max(0, selected - 1),
      ArrowRight: Math.min(count - 1, selected + 1),
      Home: 0,
      End: count - 1,
    }[event.key]
    if (next !== undefined) {
      event.preventDefault()
      setActive(Math.max(0, next))
    }
  }
  return {
    active,
    selected,
    interactionProps: {
      onKeyDown,
      onPointerDown: selectPointer,
      onPointerMove: selectPointer,
      onPointerLeave: () => setActive(null),
      onBlur: () => setActive(null),
    },
  }
}
