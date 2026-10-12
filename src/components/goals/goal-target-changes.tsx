// "Target changes" on a goal's page: every change to its target on one rail,
// newest first. It is where a manager reads who changed a month's target, from
// what to what, what that did for the months after, and the note they left.
import { Pencil } from 'lucide-react'
import type { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from '#/components/ui/timeline'
import { buildGoalTargetChanges } from './goal-target-changes-view'
import type { GoalMarkerFrame } from './goal-target-marker'

type Props = Readonly<{
  /** The goal as its page read it, with the log of its month target changes. */
  goal: Parameters<typeof monthTargetPlan>[0]
  frame: GoalMarkerFrame
}>

export function GoalTargetChanges({ goal, frame }: Props) {
  const entries = buildGoalTargetChanges(goal, frame)
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Target changes</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This goal’s target has not been changed.
          </p>
        ) : (
          <Timeline>
            {entries.map((entry) => (
              <TimelineItem key={entry.id}>
                <TimelineIndicator size="sm">
                  <Pencil />
                </TimelineIndicator>
                <TimelineConnector />
                <TimelineContent className="pt-1 text-sm">
                  <p>
                    {entry.text} ·{' '}
                    <time dateTime={entry.occurredAt} className="text-muted-foreground">
                      {entry.dateLabel}
                    </time>
                  </p>
                  {entry.detail ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{entry.detail}</p>
                  ) : null}
                  {entry.note ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Note: {entry.note}
                    </p>
                  ) : null}
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        )}
      </CardContent>
    </Card>
  )
}
