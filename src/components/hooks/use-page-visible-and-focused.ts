import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
  document.addEventListener('visibilitychange', onStoreChange)
  window.addEventListener('focus', onStoreChange)
  window.addEventListener('blur', onStoreChange)
  return () => {
    document.removeEventListener('visibilitychange', onStoreChange)
    window.removeEventListener('focus', onStoreChange)
    window.removeEventListener('blur', onStoreChange)
  }
}

function getSnapshot() {
  return document.visibilityState === 'visible' && document.hasFocus()
}

export function usePageVisibleAndFocused(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
