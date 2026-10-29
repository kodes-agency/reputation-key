import type { ReactNode } from 'react'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import type { TopicRow } from '#/contexts/ai/application/public-api'
import {
  ChangeCell,
  PraiseAndComplaintsCell,
  ReviewsCell,
  StarsCell,
} from './guest-voice-topic-cells'
import { GuestVoiceNothingHere, GuestVoiceSection } from './guest-voice-section'
import { topicLabel } from './guest-voice-words'

/** What a cell is called while the rows are stacked and the header row is hidden. */
function StackedLabel({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="mr-2 text-muted-foreground @3xl:hidden">{children}</span>
}

/**
 * The same twelve topics for every kind of business, with what guests said of each.
 * Counts first; the stars and the change are the engine's, and a topic with too few
 * reviews says so rather than print an average of two.
 */
export function GuestVoiceEveryTopic({ rows }: Readonly<{ rows: readonly TopicRow[] }>) {
  return (
    <GuestVoiceSection
      title="Every topic"
      hint="The same 12 topics for every kind of business"
    >
      {rows.length === 0 ? (
        <GuestVoiceNothingHere>No topic was named in this period.</GuestVoiceNothingHere>
      ) : (
        <DataTable label="Every topic" from="3xl">
          <DataTableHeader>
            <DataTableHead>Topic</DataTableHead>
            <DataTableHead>Reviews</DataTableHead>
            <DataTableHead className="min-w-60">
              <GlossaryTerm term="praise-and-complaints" />
            </DataTableHead>
            <DataTableHead>
              <GlossaryTerm term="stars-when-mentioned" />
            </DataTableHead>
            <DataTableHead>
              <GlossaryTerm term="likely-change" />
            </DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {rows.map((row, index) => (
              <DataTableRow key={row.topic} className="last:border-b-0">
                <DataTableCell className="col-span-2 font-medium whitespace-normal">
                  {topicLabel(row.topic)}
                </DataTableCell>
                <DataTableCell className="col-span-2">
                  <StackedLabel>Reviews</StackedLabel>
                  <ReviewsCell row={row} />
                </DataTableCell>
                <DataTableCell className="col-span-2">
                  <StackedLabel>
                    {index === 0 ? (
                      <GlossaryTerm term="praise-and-complaints" />
                    ) : (
                      'Praise and complaints'
                    )}
                  </StackedLabel>
                  <PraiseAndComplaintsCell row={row} />
                </DataTableCell>
                <DataTableCell className="col-span-2 whitespace-normal">
                  <StackedLabel>
                    {index === 0 ? (
                      <GlossaryTerm term="stars-when-mentioned" />
                    ) : (
                      'Stars when mentioned'
                    )}
                  </StackedLabel>
                  <StarsCell row={row} />
                </DataTableCell>
                <DataTableCell className="col-span-2 whitespace-normal">
                  <StackedLabel>
                    {index === 0 ? <GlossaryTerm term="likely-change" /> : 'Change'}
                  </StackedLabel>
                  <ChangeCell row={row} />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </GuestVoiceSection>
  )
}
