// Whether a moment has passed since the story mounted: false on the first paint,
// true a little later. A story that renders one thing first and a wider one then
// stands in for what a web font arriving or a count appearing does to a row that
// fits when it mounts and overflows after (the strips' reveal of the open item).
import { useEffect, useState } from 'react'

const GROW_AFTER_MS = 50

export function useGrownAfterMount(delayMs = GROW_AFTER_MS): boolean {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setGrown(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])
  return grown
}
