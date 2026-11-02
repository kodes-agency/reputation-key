/** Surfaces with their own frame never inherit the public site's header/footer. */
export function showsPublicChrome(routeIds: readonly string[]): boolean {
  return !routeIds.some(
    (id) => id === '/_authenticated' || id === '/p/$token' || id === '/my',
  )
}
