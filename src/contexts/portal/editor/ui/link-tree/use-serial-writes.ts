/**
 * The section's writes run one after another, each after the typed text still
 * waiting out its debounce: every write reads the Portal afresh, so two at once
 * (a quick second move, an add beside a title edit) would refuse the second.
 * `onIdle` runs once the queue empties.
 */

import { useRef } from 'react'
import type {
  PortalDraftAutosave,
  PortalDraftWriteOptions,
} from '../portal-draft-autosave'

export function useSerialWrites(write: PortalDraftAutosave['write'], onIdle: () => void) {
  const waiting = useRef(0)
  return <T>(send: () => Promise<T>, options?: PortalDraftWriteOptions): Promise<T> => {
    waiting.current += 1
    const run = write(send, options)
    const settle = () => {
      waiting.current -= 1
      if (waiting.current === 0) onIdle()
    }
    run.then(settle, settle)
    return run
  }
}
