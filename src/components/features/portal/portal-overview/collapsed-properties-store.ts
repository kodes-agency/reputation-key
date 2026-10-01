// Which Properties the reader folded on the All properties page. It is the
// reader's own preference ("collapsed properties stay collapsed for you"), so it
// is remembered in the browser, never in the URL: a link someone shares opens
// every Property. Storage is the source of truth, so a fold made in another tab
// is what this one reads next. Storage can be absent or throw (private windows,
// blocked site data), so a fold it could not keep is held here for this page and
// used only when storage has nothing to say.
const listeners = new Set<() => void>()

export const COLLAPSED_PROPERTIES_STORAGE_KEY = 'portal-all-properties-collapsed'

const NONE: readonly string[] = []

/** A fold storage refused. Cleared by the next write storage accepts. */
let unsaved: readonly string[] | null = null

/** The last list parsed, so the same stored text gives the same array back. */
let parsed: Readonly<{ raw: string; ids: readonly string[] }> | null = null

export function subscribeCollapsedProperties(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function parseIds(raw: string): readonly string[] {
  if (parsed?.raw === raw) return parsed.ids
  let ids: readonly string[] = NONE
  try {
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value)) {
      ids = value.filter((entry): entry is string => typeof entry === 'string')
    }
  } catch {
    // Text nobody wrote: every Property stays open.
  }
  parsed = { raw, ids }
  return ids
}

export function readCollapsedProperties(): readonly string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_PROPERTIES_STORAGE_KEY)
    if (raw !== null) return parseIds(raw)
  } catch {
    // Fall through to the fold held for this page.
  }
  return unsaved ?? NONE
}

export function toggleCollapsedProperty(propertyId: string): void {
  const current = readCollapsedProperties()
  const next = current.includes(propertyId)
    ? current.filter((id) => id !== propertyId)
    : [...current, propertyId]
  try {
    localStorage.setItem(COLLAPSED_PROPERTIES_STORAGE_KEY, JSON.stringify(next))
    unsaved = null
  } catch {
    // A preference write must never take down the page.
    unsaved = next
  }
  for (const listener of listeners) listener()
}
