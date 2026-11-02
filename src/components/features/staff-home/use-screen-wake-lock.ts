import { useEffect } from 'react'

type ScreenLock = Readonly<{ release: () => Promise<void> }>
type WakeSource = Readonly<{ request: (type: 'screen') => Promise<ScreenLock> }>

/** The pending request can finish after leaving Code; release that lock too. */
export function keepScreenAwake(
  source: WakeSource | undefined,
  page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
) {
  let stopped = false
  let pending = false
  let lock: ScreenLock | undefined
  const acquire = async () => {
    if (!source || stopped || pending || lock || page.visibilityState !== 'visible')
      return
    pending = true
    try {
      const next = await source.request('screen')
      if (stopped || page.visibilityState !== 'visible') await next.release()
      else lock = next
    } catch {
      // A browser or battery policy may refuse a screen lock.
    } finally {
      pending = false
    }
  }
  const visibility = () => {
    if (page.visibilityState === 'visible') void acquire()
    else {
      void lock?.release().catch(() => undefined)
      lock = undefined
    }
  }
  page.addEventListener('visibilitychange', visibility)
  void acquire()
  return () => {
    stopped = true
    page.removeEventListener('visibilitychange', visibility)
    void lock?.release().catch(() => undefined)
  }
}

export function useScreenWakeLock() {
  useEffect(() => keepScreenAwake(navigator.wakeLock, document), [])
}
