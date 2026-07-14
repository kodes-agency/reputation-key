// Goal create form — guided, outcome-first layout (orchestrator).
// Composes four section components (What to track · Target · Timeframe ·
// Details). Domain knobs (metricKey, aggregation, goalType, scope) are derived
// from friendly choices inside each section. See goal-create-tiles.tsx for
// shared primitives and the section files for each step.
import { Button } from '#/components/ui/button'
import { TrackSection, TargetSection } from './goal-create-track-section'
import { TimeframeSection, DetailsSection } from './goal-create-schedule-section'
import type { PortalOption } from './goal-entity-types'
import type { FormState } from './go-create-form-state'

type Props = Readonly<{
  state: FormState
  setters: Record<string, (v: string) => void>
  portals: readonly PortalOption[]
  portalGroups: readonly PortalOption[]
  propertyId: string
  isPending: boolean
  onCancel: () => void
}>

export function GoalCreateFields({
  state,
  setters,
  portals,
  portalGroups,
  propertyId,
  isPending,
  onCancel,
}: Props) {
  return (
    <div className="space-y-4">
      <TrackSection
        state={state}
        setters={setters}
        portals={portals}
        portalGroups={portalGroups}
        propertyId={propertyId}
      />
      <TargetSection state={state} setters={setters} />
      <TimeframeSection state={state} setters={setters} />
      <DetailsSection state={state} setters={setters} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creating…' : 'Create goal'}
        </Button>
      </div>
    </div>
  )
}
