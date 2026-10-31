import { useRef } from 'react'
import type { GuestVoiceDetailTarget } from '#/contexts/ai/application/public-api'
import {
  detailTargetKey,
  detailTrailFor,
  type DetailStep,
} from './guest-voice-detail-navigation'

/** URL targets are authoritative; only transient scroll/focus and their ancestors live here. */
export function useGuestVoiceDetailNavigation(
  target: GuestVoiceDetailTarget | null,
  change: (target: GuestVoiceDetailTarget | null, options?: { replace: boolean }) => void,
) {
  const snapshots = useRef(new Map<string, DetailStep>())
  const parents = useRef(new Map<string, readonly DetailStep[]>())
  const currentTitle = useRef('Details')
  const scrollRef = useRef<HTMLDivElement>(null)
  const page = useRef<{
    opener: HTMLElement | null
    band: string | null
    scroll: number
  } | null>(null)
  const seen = useRef('closed')
  const capture = () => {
    if (!target) return null
    const active =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const step = {
      target,
      title: currentTitle.current,
      scroll: scrollRef.current?.scrollTop ?? 0,
      focus: active?.dataset.detailFocus ?? null,
    }
    snapshots.current.set(detailTargetKey(target), step)
    return step
  }
  const open = (next: GuestVoiceDetailTarget | null) => {
    if (!next) {
      change(null, { replace: true })
      return
    }
    const key = detailTargetKey(next)
    if (!target) {
      page.current = {
        opener:
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        band:
          document.activeElement
            ?.closest('section[aria-labelledby]')
            ?.getAttribute('aria-labelledby') ?? null,
        scroll: window.scrollY,
      }
      parents.current.set(key, [])
    } else if (detailTargetKey(target) !== key) {
      const step = capture()
      const path = parents.current.get(detailTargetKey(target)) ?? []
      // Following a cause back to an ancestor acts like Back, without a cyclic trail.
      const known = path.some((item) => detailTargetKey(item.target) === key)
      parents.current.set(
        key,
        known ? detailTrailFor(path, next) : [...path, ...(step ? [step] : [])],
      )
    }
    if (target) change(next, { replace: true })
    else change(next)
  }
  const restorePage = () => {
    const saved = page.current
    requestAnimationFrame(() => {
      window.scrollTo({ top: saved?.scroll ?? window.scrollY })
      if (saved?.opener?.isConnected) saved.opener.focus({ preventScroll: true })
      else
        (saved?.band
          ? document.getElementById(saved.band)
          : document.querySelector<HTMLElement>('[data-slot="section-title"]')
        )?.focus({ preventScroll: true })
    })
    page.current = null
    snapshots.current.clear()
    parents.current.clear()
    seen.current = 'closed'
  }
  const ready = (title: string) => {
    currentTitle.current = title
    const key = detailTargetKey(target)
    if (seen.current === key) return
    seen.current = key
    const saved = snapshots.current.get(key)
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved?.scroll ?? 0
      if (saved?.focus)
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-detail-focus="${CSS.escape(saved.focus)}"]`)
          ?.focus({ preventScroll: true })
    })
  }
  return {
    open,
    knownTitle: () =>
      snapshots.current.get(detailTargetKey(target))?.title ??
      page.current?.opener?.querySelector('[data-issue-title]')?.textContent ??
      null,
    scrollRef,
    ready,
    restorePage,
    backLabel: () => parents.current.get(detailTargetKey(target))?.at(-1)?.title ?? null,
    back: () => {
      const previous = parents.current.get(detailTargetKey(target))?.at(-1)
      capture()
      if (previous) change(previous.target, { replace: true })
    },
  }
}
export type GuestVoiceDetailNavigation = ReturnType<typeof useGuestVoiceDetailNavigation>
