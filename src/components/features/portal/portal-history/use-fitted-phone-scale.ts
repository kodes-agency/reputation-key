import { useEffect, useRef, useState, type RefObject } from 'react'
import { scaleToFitWidth } from '../portal-preview/preview-phone'

/**
 * The scale of a phone drawn in the element `ref` names: `wanted` where the
 * element is wide enough for the phone's frame, smaller where it is not (the
 * History's dialog on a narrow window). Until the element has been measured the
 * wanted scale stands.
 */
export function useFittedPhoneScale(wanted: number): {
  ref: RefObject<HTMLElement | null>
  scale: number
} {
  const ref = useRef<HTMLElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, scale: width === null ? wanted : scaleToFitWidth(width, wanted) }
}
