// Shared types for link-tree and portal-detail components.
// Single source of truth — import from here instead of redefining.

export type LinkTreeLink = Readonly<{
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}>
