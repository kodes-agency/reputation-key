import { useSyncExternalStore } from 'react'

/** What a shortcut's modifier key is printed as. */
export type ShortcutModifier = '⌘' | 'Ctrl'

/**
 * ⌘ on Apple platforms, Ctrl everywhere else. A handler that accepts either key
 * (`event.metaKey || event.ctrlKey`) prints the one this person would press, so
 * the hint is never a key their keyboard does not have.
 */
export function shortcutModifierFor(platform: string): ShortcutModifier {
  return /^(?:Mac|iPhone|iPad|iPod)/iu.test(platform) ? '⌘' : 'Ctrl'
}

const subscribe = () => () => undefined

/** The platform answers on the client only; the server and first paint print ⌘. */
export function useShortcutModifier(): ShortcutModifier {
  return useSyncExternalStore(
    subscribe,
    () => shortcutModifierFor(navigator.platform),
    () => '⌘',
  )
}
