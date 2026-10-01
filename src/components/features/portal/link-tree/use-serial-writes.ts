/**
 * The section's writes run one after another, each after the typed text still
 * waiting out its debounce: every write reads the Portal afresh, so two at once
 * (a quick second move, an add beside a title edit) would refuse the second.
 * `onIdle` runs once the queue empties.
 */

import { useRef } from 'react'

export function useSerialWrites(flush: () => Promise<unknown>, onIdle: () => void) {
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const waiting = useRef(0)
  return <T>(write: () => Promise<T>): Promise<T> => {
    waiting.current += 1
    const run = queue.current
      .catch(() => undefined)
      .then(async () => {
        await flush()
        return write()
      })
    queue.current = run
    const settle = () => {
      waiting.current -= 1
      if (waiting.current === 0) onIdle()
    }
    run.then(settle, settle)
    return run
  }
}
