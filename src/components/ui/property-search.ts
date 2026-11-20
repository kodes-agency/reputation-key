// How a list of properties is ordered, and when it is worth searching.
//
// Written for the Inbox's property select (#582) and shared from here, because
// every surface that asks "which property?" has the same portfolio problem: a
// manager with thirty of them cannot scan a plain list, and two surfaces that
// match names differently are two surfaces that disagree about what "cafe"
// finds.

export type PickerProperty = Readonly<{ id: string; name: string }>

/** A list this long is quicker to search than to scan; shorter ones get no field. */
const SEARCH_MIN_PROPERTIES = 8

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * By name, never by count: a list that reorders while you work moves the row
 * under your cursor.
 */
export function sortPropertiesByName<T extends PickerProperty>(
  properties: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return [...properties].sort((a, b) => byName.compare(a.name, b.name))
}

/**
 * Typing into a list you can read at a glance is noise, so short lists have no
 * search field.
 */
export function offersPropertySearch(propertyCount: number): boolean {
  return propertyCount >= SEARCH_MIN_PROPERTIES
}

/**
 * Text as a search sees it: case and accents gone, compatibility forms (full
 * width, ligatures) flattened. Both sides of every comparison go through this,
 * so "cafe" finds "Café", "СТАРА" finds "Стара" and "CAFÉ" finds "Cafe".
 */
export function foldSearchText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

/**
 * The one text matcher for every client-side list search (Properties, the
 * property picker, Portals, All properties, Google import candidates). Fold the
 * query once, then test as many strings as the row has. A blank query matches
 * everything.
 *
 * Deliberately not fuzzy: property ids are UUIDs, and a scorer that matched
 * letters in order would find almost every property for almost any word.
 */
export function searchMatcher(search: string): (text: string) => boolean {
  const query = foldSearchText(search.trim())
  return (text) => query === '' || foldSearchText(text).includes(query)
}

/** Whether `text` answers `search`: part of it, ignoring case and accents. */
export function matchesSearchText(text: string, search: string): boolean {
  return searchMatcher(search)(text)
}

/**
 * Whether a property name answers a search: "rila" finds "Rila Grand Hotel" and
 * "cafe" finds "Café Plaza".
 */
export function matchesPropertySearch(name: string, search: string): boolean {
  return matchesSearchText(name, search)
}
