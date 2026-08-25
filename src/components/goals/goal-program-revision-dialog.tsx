import { useState, type FormEvent } from 'react'
import type { reviseGoalProgram } from '#/contexts/goal/server/goal-programs'
import type {
  GoalMetric,
  GoalSubjectAssignment,
} from '#/contexts/goal/application/public-api'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys } from '#/shared/queries/query-keys'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  GoalSubjectPicker,
  goalSubjectKey,
  goalSubjectsFromKeys,
  type GoalSubjectKey,
} from './goal-subject-picker'

type GoalProgramRevisionDialogProps = Readonly<{
  reviseGoalProgramFn: typeof reviseGoalProgram
  property: Readonly<{ id: string; name: string }>
  programId: string
  metric: GoalMetric
  targetValue: number
  assignments: readonly GoalSubjectAssignment[]
  groups: readonly Readonly<{
    id: string
    name: string
    portalIds: readonly string[]
  }>[]
  portals: readonly Readonly<{ id: string; name: string }>[]
}>

const METRICS: readonly Readonly<{ id: GoalMetric; label: string }>[] = [
  { id: 'qualified_scans', label: 'Qualified scans' },
  { id: 'portal_rating_count', label: 'Private rating count' },
  { id: 'portal_rating_average', label: 'Private rating average' },
]

export function GoalProgramRevisionDialog(props: GoalProgramRevisionDialogProps) {
  const initialSubjects = () =>
    props.assignments.map(({ subject }) => goalSubjectKey(subject))
  const [open, setOpen] = useState(false)
  const [metric, setMetric] = useState<GoalMetric>(props.metric)
  const [target, setTarget] = useState(String(props.targetValue))
  const [reason, setReason] = useState('')
  const [subjects, setSubjects] = useState<GoalSubjectKey[]>(initialSubjects)
  const mutation = useActionMutation(props.reviseGoalProgramFn, {
    successMessage: 'Goal revision scheduled for the next full month',
    invalidateKeys: [goalKeys.all],
    onSuccess: () => setOpen(false),
  })

  const onOpenChange = (next: boolean) => {
    if (next) {
      setMetric(props.metric)
      setTarget(String(props.targetValue))
      setReason('')
      setSubjects(initialSubjects())
    }
    setOpen(next)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const targetValue = Number(target)
    if (!Number.isFinite(targetValue) || !reason.trim() || subjects.length === 0) return
    mutation({
      data: {
        propertyId: props.property.id,
        programId: props.programId,
        metric,
        targetValue,
        subjects: goalSubjectsFromKeys(subjects),
        reason,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Revise</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form className="space-y-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Revise goal</DialogTitle>
            <DialogDescription>
              The current month remains unchanged. This version starts with the next
              complete month.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="revision-metric">Metric</Label>
              <select
                id="revision-metric"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={metric}
                onChange={(event) => setMetric(event.target.value as GoalMetric)}
              >
                {METRICS.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="revision-target">Monthly target</Label>
              <Input
                id="revision-target"
                type="number"
                min="1"
                max={metric === 'portal_rating_average' ? 5 : undefined}
                step={metric === 'portal_rating_average' ? 0.1 : 1}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="revision-reason">Reason for the change</Label>
            <Input
              id="revision-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              maxLength={500}
            />
          </div>
          <GoalSubjectPicker
            property={props.property}
            groups={props.groups}
            portals={props.portals}
            selected={subjects}
            onChange={setSubjects}
          />
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || subjects.length === 0}>
              {mutation.isPending ? 'Scheduling…' : 'Schedule revision'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
