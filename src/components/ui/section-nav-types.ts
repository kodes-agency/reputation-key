import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** One destination in a section nav. */
export type SectionNavItem = Readonly<{
  /** Names the item: the React key, and what the nav's `current` matches. */
  key: string
  /** The route, with its `params` and `search`, exactly as a router link takes them. */
  to: string
  params?: Readonly<Record<string, string>>
  search?: Readonly<Record<string, string>>
  label: string
  icon?: LucideIcon
  /**
   * The line under the label: what is set there now, or what the section is for.
   * Drawn in a list, left out of a strip.
   */
  summary?: ReactNode
  /** A trailing figure. Nothing is drawn for 0 or null. */
  count?: number | null
  /** Items next to each other with the same group are drawn together, under its heading. */
  group?: string
}>
