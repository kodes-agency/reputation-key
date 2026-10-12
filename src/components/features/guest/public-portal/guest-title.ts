/**
 * Whether a portal titled `title` would print the property's own name twice.
 * Compared the way a person reads it: trimmed and without regard to case.
 */
export function titleRepeatsName(title: string, displayName: string): boolean {
  return title.trim().toLocaleLowerCase() === displayName.trim().toLocaleLowerCase()
}

/**
 * The title of a guest page in the browser tab and history: the portal's title
 * and the property's display name, joined once. A portal titled with the
 * property's own name, or with no title at all, reads as the name alone, the
 * same way the page's title block prints it.
 */
export function guestDocumentTitle(portalTitle: string, displayName: string): string {
  const title = portalTitle.trim()
  const name = displayName.trim()
  if (title === '') return name
  if (name === '' || titleRepeatsName(title, name)) return title
  return `${title} — ${name}`
}
