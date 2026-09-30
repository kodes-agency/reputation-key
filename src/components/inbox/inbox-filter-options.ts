import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { ASPECT_OPTIONS, ASPECT_POLARITY_OPTIONS } from '#/shared/aspect-labels'
import type { InboxListFilterValues } from './inbox-filters'

/** One choice of a filter group: what the URL holds, and what the chip says. */
export type InboxFilterOption = Readonly<{ value: string; label: string }>

export const SOURCE_OPTIONS = [
  { value: 'all', label: 'All items' },
  { value: 'review', label: 'Reviews' },
  { value: 'feedback', label: 'Feedback' },
] as const

export const ATTENTION_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const

export const RATING_OPTIONS = [
  { value: 'all', label: 'All ratings' },
  { value: '5', label: '5 stars' },
  { value: '4-plus', label: '4 stars and up' },
  { value: '3-minus', label: '3 stars and below' },
] as const

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
] as const satisfies ReadonlyArray<Readonly<{ value: InboxSort; label: string }>>

export function ratingValue(value: InboxListFilterValues): string {
  if (value.ratingMin === 5) return '5'
  if (value.ratingMin === 4) return '4-plus'
  if (value.ratingMax === 3) return '3-minus'
  return 'all'
}

/** The min/max a rating choice filters by; 'all' clears both bounds. */
export function ratingPatch(rating: string): Partial<InboxListFilterValues> {
  if (rating === '5') return { ratingMin: 5, ratingMax: 5 }
  if (rating === '4-plus') return { ratingMin: 4, ratingMax: undefined }
  if (rating === '3-minus') return { ratingMin: undefined, ratingMax: 3 }
  return { ratingMin: undefined, ratingMax: undefined }
}

export type InboxFilterChip = Readonly<{
  key: string
  label: string
  clear: Readonly<{ filters?: Partial<InboxListFilterValues>; sort?: InboxSort }>
}>

function labelOf(options: ReadonlyArray<InboxFilterOption>, value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

/** One removable chip per narrowing choice, in the order the sheet lists them. */
export function activeInboxFilterChips(
  filters: InboxListFilterValues,
  sort: InboxSort,
): ReadonlyArray<InboxFilterChip> {
  const { sourceType, attention, ratingMin, ratingMax, polarity, aspect } = filters
  const chips: ReadonlyArray<InboxFilterChip | null> = [
    sourceType === undefined
      ? null
      : {
          key: 'source',
          label: labelOf(SOURCE_OPTIONS, sourceType),
          clear: { filters: { sourceType: undefined } },
        },
    attention === undefined
      ? null
      : {
          key: 'priority',
          label: labelOf(ATTENTION_OPTIONS, attention),
          clear: { filters: { attention: undefined } },
        },
    ratingMin === undefined && ratingMax === undefined
      ? null
      : {
          key: 'rating',
          label: labelOf(RATING_OPTIONS, ratingValue(filters)),
          clear: { filters: { ratingMin: undefined, ratingMax: undefined } },
        },
    polarity === undefined
      ? null
      : {
          key: 'polarity',
          label: labelOf(ASPECT_POLARITY_OPTIONS, polarity),
          clear: { filters: { polarity: undefined } },
        },
    aspect === undefined
      ? null
      : {
          key: 'aspect',
          label: labelOf(ASPECT_OPTIONS, aspect),
          clear: { filters: { aspect: undefined } },
        },
    sort === 'oldest'
      ? { key: 'sort', label: 'Oldest first', clear: { sort: 'newest' } }
      : null,
  ]
  return chips.filter((chip): chip is InboxFilterChip => chip !== null)
}
