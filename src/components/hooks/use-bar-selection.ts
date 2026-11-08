import { useState, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * The bar under a pointer, `fraction` of the way across the box that takes it. Bars drawn
 * at equal widths share it equally; `centers` (each a fraction of that box) are for bars
 * spaced unevenly, where the nearest one is chosen and a tie goes to the earlier.
 */
export function chosenIndex(
  fraction: number,
  count: number,
  centers?: readonly number[],
): number {
  if (count <= 0) return 0
  if (centers === undefined || centers.length === 0) {
    return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)))
  }
  let nearest = 0
  centers.forEach((center, index) => {
    if (Math.abs(center - fraction) < Math.abs((centers[nearest] ?? 0) - fraction)) {
      nearest = index
    }
  })
  return nearest
}

/** One keyboard stop; pointer, touch and keys inspect the same column. */
export function useBarSelection(count: number, centers?: readonly number[]) {
  const [active, setActive] = useState<number | null>(null)
  const selected = Math.min(active ?? count - 1, count - 1)
  const selectPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return
    setActive(chosenIndex((event.clientX - box.left) / box.width, count, centers))
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
      // A finger leaves as it lifts: the tapped bar stays selected until focus moves on.
      onPointerLeave: (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'touch') setActive(null)
      },
      onBlur: () => setActive(null),
    },
  }
}
