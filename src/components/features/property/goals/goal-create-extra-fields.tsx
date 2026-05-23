// Goal create form — conditional extra fields (period, rolling, recurrence, description)
import { Button } from '#/components/ui/button'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'

interface GoalCreateExtraFieldsProps {
  showPeriodDates: boolean
  showRollingWindow: boolean
  showRecurrenceRule: boolean
  state: {
    periodStart: string
    periodEnd: string
    rollingWindowDays: string
    recurrenceFrequency: 'weekly' | 'monthly' | 'quarterly'
    description: string
  }
  setters: Record<string, (v: string) => void>
  isPending: boolean
  onCancel: () => void
}

export function GoalCreateExtraFields({
  showPeriodDates,
  showRollingWindow,
  showRecurrenceRule,
  state: s,
  setters: $,
  isPending,
  onCancel,
}: GoalCreateExtraFieldsProps) {
  return (
    <>
      {showPeriodDates && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="period-start">Start Date</FieldLabel>
            <Input
              id="period-start"
              type="datetime-local"
              value={s.periodStart}
              onChange={(e) => $.periodStart(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="period-end">End Date</FieldLabel>
            <Input
              id="period-end"
              type="datetime-local"
              value={s.periodEnd}
              onChange={(e) => $.periodEnd(e.target.value)}
            />
          </Field>
        </div>
      )}
      {showRollingWindow && (
        <Field>
          <FieldLabel htmlFor="rolling-days">Rolling Window (days)</FieldLabel>
          <Input
            id="rolling-days"
            type="number"
            min={1}
            value={s.rollingWindowDays}
            onChange={(e) => $.rollingWindowDays(e.target.value)}
            placeholder="e.g. 30"
          />
        </Field>
      )}
      {showRecurrenceRule && (
        <Field>
          <FieldLabel>Recurrence Frequency</FieldLabel>
          <Select value={s.recurrenceFrequency} onValueChange={$.recurrenceFrequency}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
        <Textarea
          id="description"
          value={s.description}
          onChange={(e) => $.description(e.target.value)}
          placeholder="Describe this goal..."
          rows={3}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creating...' : 'Create Goal'}
        </Button>
      </div>
    </>
  )
}
