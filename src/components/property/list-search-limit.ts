// The longest search a list takes. The URL schemas drop a longer `q` outright,
// so the field has to stop typing here too, or the 101st character resets it.
//
// Its own module, not part of property-search.ts: the route search schemas
// import this constant, and property-search.ts carries top-level work (an
// Intl.Collator) that must not ride into the first-paint bundle with it.
export const MAX_LIST_SEARCH_LENGTH = 100
