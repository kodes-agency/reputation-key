import type {
  InboxSort,
  InboxStatus,
  ReviewAspect,
  ReviewAspectPolarity,
  SourceType,
} from '#/contexts/inbox/application/public-api'

export type InboxFilterValues = Readonly<{
  propertyId: string | undefined
  status: InboxStatus | ReadonlyArray<InboxStatus> | undefined
  isEscalated: boolean | undefined
  sourceType: SourceType | undefined
  platform: string | undefined
  ratingMin: number | undefined
  ratingMax: number | undefined
  attention: 'urgent' | 'high' | 'medium' | 'low' | undefined
  aspect: ReviewAspect | undefined
  polarity: ReviewAspectPolarity | undefined
  q: string | undefined
  sort: InboxSort | undefined
}>

export type InboxListFilterValues = Pick<
  InboxFilterValues,
  'sourceType' | 'ratingMin' | 'ratingMax' | 'attention' | 'aspect' | 'polarity'
>

export const CLEARED_INBOX_LIST_FILTERS: InboxListFilterValues = {
  sourceType: undefined,
  ratingMin: undefined,
  ratingMax: undefined,
  attention: undefined,
  aspect: undefined,
  polarity: undefined,
}

export function countActiveInboxFilters(value: InboxListFilterValues): number {
  return (
    Number(value.sourceType !== undefined) +
    Number(value.ratingMin !== undefined || value.ratingMax !== undefined) +
    Number(value.attention !== undefined) +
    Number(value.aspect !== undefined) +
    Number(value.polarity !== undefined)
  )
}
