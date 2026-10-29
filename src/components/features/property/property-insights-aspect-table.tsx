import type { ReactNode } from 'react'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import {
  Change,
  PraiseAndComplaints,
  StarsWhenMentioned,
} from './property-insights-topic-cells'
import {
  reviewsText,
  topicChanges,
  topicRows,
  type PropertyInsightsEvidence,
  type TopicRow,
} from './property-insights-topic-rows'

const VISIBLE_TOPIC_COUNT = 10

/** What a cell is called while the rows are stacked and the header row is hidden. */
function StackedLabel({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="mb-1 block text-muted-foreground @3xl:hidden">{children}</span>
}

function Label({
  label,
  term,
  define,
}: Readonly<{
  label: string
  term: 'praise-and-complaints' | 'stars-when-mentioned' | 'likely-change'
  define: boolean
}>) {
  return define ? <GlossaryTerm term={term}>{label}</GlossaryTerm> : label
}

function TopicTable({
  propertyId,
  evidence,
  rows,
  showChange,
  defineTerms,
  label,
}: Readonly<{
  propertyId: string
  evidence: PropertyInsightsEvidence
  rows: readonly TopicRow[]
  /** Some topic moved: a column that says nothing in every row is not drawn. */
  showChange: boolean
  defineTerms: boolean
  label: string
}>) {
  // While stacked the header row is hidden, so a row's own labels carry the
  // definitions: the first row's, and the first that has a change for Change.
  const firstWithChange = rows.findIndex((row) => topicChanges(row).length > 0)
  return (
    <DataTable label={label} from="3xl">
      <DataTableHeader>
        <DataTableHead>Topic</DataTableHead>
        <DataTableHead>Reviews</DataTableHead>
        <DataTableHead className="min-w-60">
          <Label
            label="Praise and complaints"
            term="praise-and-complaints"
            define={defineTerms}
          />
        </DataTableHead>
        <DataTableHead>
          <Label
            label="Stars when mentioned"
            term="stars-when-mentioned"
            define={defineTerms}
          />
        </DataTableHead>
        {showChange ? (
          <DataTableHead>
            <Label label="Change" term="likely-change" define={defineTerms} />
          </DataTableHead>
        ) : null}
      </DataTableHeader>
      <DataTableBody>
        {rows.map((row, index) => {
          const define = defineTerms && index === 0
          const changes = topicChanges(row)
          return (
            <DataTableRow key={row.aspect} className="last:border-b-0">
              <DataTableCell className="col-span-2 font-medium whitespace-normal">
                {row.label}
              </DataTableCell>
              <DataTableCell className="col-span-2 min-h-11 tabular-nums">
                <StackedLabel>Reviews</StackedLabel>
                {reviewsText(row, evidence.basis.analyzedReviewCount)}
              </DataTableCell>
              <DataTableCell className="col-span-2 min-h-11">
                <StackedLabel>
                  <Label
                    label="Praise and complaints"
                    term="praise-and-complaints"
                    define={define}
                  />
                </StackedLabel>
                <PraiseAndComplaints
                  propertyId={propertyId}
                  evidence={evidence}
                  row={row}
                />
              </DataTableCell>
              <DataTableCell className="col-span-2 min-h-11 whitespace-normal">
                <StackedLabel>
                  <Label
                    label="Stars when mentioned"
                    term="stars-when-mentioned"
                    define={define}
                  />
                </StackedLabel>
                <StarsWhenMentioned row={row} />
              </DataTableCell>
              {showChange ? (
                <DataTableCell className="col-span-2 whitespace-normal">
                  {changes.length === 0 ? null : (
                    <StackedLabel>
                      <Label
                        label="Change"
                        term="likely-change"
                        define={defineTerms && index === firstWithChange}
                      />
                    </StackedLabel>
                  )}
                  <Change changes={changes} />
                </DataTableCell>
              ) : null}
            </DataTableRow>
          )
        })}
      </DataTableBody>
    </DataTable>
  )
}

export function PropertyInsightsTopicTable({
  propertyId,
  evidence,
}: Readonly<{ propertyId: string; evidence: PropertyInsightsEvidence }>) {
  if (evidence.aspectEvidenceState === 'predates_aspect_analysis') {
    return (
      <p className="text-sm text-muted-foreground">
        These reviews were not analysed for topics, so topics cannot be reported.
      </p>
    )
  }
  if (evidence.aspectEvidenceState === 'not_analyzed') {
    return (
      <p className="text-sm text-muted-foreground">
        There are no analysed reviews with text in this period, so topics cannot be
        reported.
      </p>
    )
  }
  if (evidence.aspectEvidenceState === 'no_mentions' || evidence.aspects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No topic mentions were identified among the analysed reviews in this period.
      </p>
    )
  }

  const rows = topicRows(evidence)
  const additional = rows.slice(VISIBLE_TOPIC_COUNT)
  // No period to compare with (All time, a window still being analysed) or no
  // topic that moved: no Change column.
  const comparisonAvailable = evidence.range !== 'all' && !evidence.provisional
  const showChange =
    comparisonAvailable && rows.some((row) => topicChanges(row).length > 0)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <TopicTable
        propertyId={propertyId}
        evidence={evidence}
        rows={rows.slice(0, VISIBLE_TOPIC_COUNT)}
        showChange={showChange}
        defineTerms
        label="Topics"
      />
      {additional.length > 0 ? (
        <details className="rounded-lg border px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-link focus-ring">
            Show all topics
          </summary>
          <div className="pb-3">
            <TopicTable
              propertyId={propertyId}
              evidence={evidence}
              rows={additional}
              showChange={showChange}
              defineTerms={false}
              label="More topics"
            />
          </div>
        </details>
      ) : null}
    </div>
  )
}
