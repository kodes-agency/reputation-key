import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { FieldGroup } from '#/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { AI_CATEGORY_OPTIONS } from '#/shared/ai-category-labels'
import { Filter, X } from 'lucide-react'
import { InboxFilterSelect } from './inbox-filter-select'
import {
  CLEARED_INBOX_LIST_FILTERS,
  countActiveInboxFilters,
  type InboxListFilterValues,
} from './inbox-filters'

const TITLE_ID = 'inbox-filter-popover-title'

type Props = Readonly<{
  value: InboxListFilterValues
  onChange: (patch: Partial<InboxListFilterValues>) => void
}>

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All items' },
  { value: 'review', label: 'Reviews' },
  { value: 'feedback', label: 'Feedback' },
] as const
const ATTENTION_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const
const RATING_OPTIONS = [
  { value: 'all', label: 'All ratings' },
  { value: '5', label: '5 stars' },
  { value: '4-plus', label: '4 stars and up' },
  { value: '3-minus', label: '3 stars and below' },
] as const

function ratingValue(value: InboxListFilterValues): string {
  if (value.ratingMin === 5) return '5'
  if (value.ratingMin === 4) return '4-plus'
  if (value.ratingMax === 3) return '3-minus'
  return 'all'
}

export function InboxFilterPopover({ value, onChange }: Props) {
  const activeCount = countActiveInboxFilters(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10">
          <Filter data-icon="inline-start" />
          Filters
          {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
        </Button>
      </PopoverTrigger>
      {/* role="dialog" with no accessible name fails axe (aria-dialog-name).
          PopoverTitle is not wired to the content the way DialogTitle is, so
          the association is made explicitly. */}
      <PopoverContent align="end" className="w-72" aria-labelledby={TITLE_ID}>
        <PopoverHeader className="mb-4 flex-row items-center justify-between">
          <PopoverTitle id={TITLE_ID}>Filters</PopoverTitle>
          <Button
            variant="ghost"
            size="xs"
            disabled={activeCount === 0}
            onClick={() => onChange(CLEARED_INBOX_LIST_FILTERS)}
          >
            <X data-icon="inline-start" />
            Clear
          </Button>
        </PopoverHeader>
        <FieldGroup className="gap-4">
          <InboxFilterSelect
            label="Source"
            value={value.sourceType ?? 'all'}
            options={SOURCE_OPTIONS}
            onChange={(sourceType) =>
              onChange({
                sourceType:
                  sourceType === 'all'
                    ? undefined
                    : (sourceType as 'review' | 'feedback'),
              })
            }
          />
          <InboxFilterSelect
            label="Priority"
            value={value.attention ?? 'all'}
            options={ATTENTION_OPTIONS}
            onChange={(attention) =>
              onChange({
                attention:
                  attention === 'all'
                    ? undefined
                    : (attention as InboxListFilterValues['attention']),
              })
            }
          />
          <InboxFilterSelect
            label="Topic"
            value={value.category ?? 'all'}
            options={[{ value: 'all', label: 'All topics' }, ...AI_CATEGORY_OPTIONS]}
            onChange={(category) =>
              onChange({
                category:
                  category === 'all'
                    ? undefined
                    : (category as InboxListFilterValues['category']),
              })
            }
          />
          <InboxFilterSelect
            label="Rating"
            value={ratingValue(value)}
            options={RATING_OPTIONS}
            onChange={(rating) =>
              onChange(
                rating === '5'
                  ? { ratingMin: 5, ratingMax: 5 }
                  : rating === '4-plus'
                    ? { ratingMin: 4, ratingMax: undefined }
                    : rating === '3-minus'
                      ? { ratingMin: undefined, ratingMax: 3 }
                      : { ratingMin: undefined, ratingMax: undefined },
              )
            }
          />
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}
