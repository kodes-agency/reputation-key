import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import { FieldGroup } from '#/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { ASPECT_OPTIONS, ASPECT_POLARITY_OPTIONS } from '#/shared/aspect-labels'
import { ListFilter } from 'lucide-react'
import { InboxFilterSelect } from './inbox-filter-select'
import {
  ATTENTION_OPTIONS,
  ratingPatch,
  ratingValue,
  RATING_OPTIONS,
  SOURCE_OPTIONS,
} from './inbox-filter-options'
import {
  CLEARED_INBOX_LIST_FILTERS,
  countActiveInboxFilters,
  type InboxListFilterValues,
} from './inbox-filters'
import { IconButton } from '#/components/ui/icon-button'

const TITLE_ID = 'inbox-filter-popover-title'

type Props = Readonly<{
  value: InboxListFilterValues
  onChange: (patch: Partial<InboxListFilterValues>) => void
}>

export function InboxFilterPopover({ value, onChange }: Props) {
  const activeCount = countActiveInboxFilters(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          variant="outline"
          size="icon-sm"
          className="relative"
          label={activeCount > 0 ? `Filters, ${activeCount} active` : 'Filters'}
        >
          <ListFilter />
          {activeCount > 0 && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-foreground" />
          )}
        </IconButton>
      </PopoverTrigger>
      {/* role="dialog" with no accessible name fails axe (aria-dialog-name).
          PopoverTitle is not wired to the content the way DialogTitle is, so
          the association is made explicitly. */}
      <PopoverContent
        align="end"
        collisionPadding={8}
        data-density="compact"
        className="w-72"
        aria-labelledby={TITLE_ID}
      >
        <PopoverHeader className="mb-4 flex-row items-center justify-between">
          <PopoverTitle id={TITLE_ID}>Filters</PopoverTitle>
          {/* No search is in force here: the header shows the search instead of this control. */}
          <ClearFiltersButton
            size="xs"
            searching={false}
            disabled={activeCount === 0}
            onClear={() => onChange(CLEARED_INBOX_LIST_FILTERS)}
          />
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
            label="Aspect"
            value={value.aspect ?? 'all'}
            options={[{ value: 'all', label: 'All aspects' }, ...ASPECT_OPTIONS]}
            onChange={(aspect) =>
              onChange({
                aspect:
                  aspect === 'all'
                    ? undefined
                    : (aspect as InboxListFilterValues['aspect']),
              })
            }
          />
          <InboxFilterSelect
            label="Polarity"
            value={value.polarity ?? 'all'}
            options={[
              { value: 'all', label: 'All polarities' },
              ...ASPECT_POLARITY_OPTIONS,
            ]}
            onChange={(polarity) =>
              onChange({
                polarity:
                  polarity === 'all'
                    ? undefined
                    : (polarity as InboxListFilterValues['polarity']),
              })
            }
          />
          <InboxFilterSelect
            label="Rating"
            value={ratingValue(value)}
            options={RATING_OPTIONS}
            onChange={(rating) => onChange(ratingPatch(rating))}
          />
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}
