// What a browser says when a dynamic import cannot fetch its file. After a
// deploy that is the sign of a tab whose code is older than the server: the
// release that replaced it no longer ships the old file names.
//
// One list for both readers: the tab acts on it (stale-tab.ts) and error
// monitoring tags it (observability/error-facts.ts). Kept free of imports
// because the tab's side of it is in first paint.

const CHUNK_LOAD_MESSAGES: readonly RegExp[] = [
  /^Failed to fetch dynamically imported module\b/u, // Chromium
  /^error loading dynamically imported module\b/u, // Firefox
  /^Importing a module script failed\.?$/u, // Safari
  /^Unable to preload CSS for\b/u, // Vite's stylesheet preload
]

export function isChunkLoadMessage(message: string): boolean {
  return CHUNK_LOAD_MESSAGES.some((shape) => shape.test(message))
}
