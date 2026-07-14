// Goal create — Section 3 (Timeframe) + Section 4 (Details).
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SectionCard, ChoiceTile, TIMEFRAME_ICONS, TIMEFRAMES } from './goal-create-tiles'
import { goalTypeLabel, goalTypeDescription } from '#/contexts/goal/ui/helpers'
import type { FormState } from './go-create-form-state'

type Setters = Record<string, (v: string) => void>

export function TimeframeSection({
  state: s,
  setters: $,
}: Readonly<{ state: FormState; setters: Setters }>) {
  // Selecting a timeframe delegates to the central goalType setter (which
  // handles seeding defaults + clearing illegal fields for the type).
  const pickTimeframe = (type: FormState['goalType']) => {
    $.goalType(type)
  }

  return (
    <SectionCard title="Choose a timeframe" description="How should progress reset?">
      <div className="grid gap-2 sm:grid-cols-2">
        {TIMEFRAMES.map((type) => (
          <ChoiceTile
            key={type}
            selected={s.goalType === type}
            onClick={() => pickTimeframe(type)}
            icon={TIMEFRAME_ICONS[type]}
            title={goalTypeLabel(type)}
            description={goalTypeDescription(type)}
          />
        ))}
      </div>

      {s.goalType === 'one_shot' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="period-start">Starts</FieldLabel>
            <Input
              id="period-start"
              type="datetime-local"
              value={s.periodStart}
              onChange={(e) => $.periodStart(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="period-end">Ends</FieldLabel>
            <Input
              id="period-end"
              type="datetime-local"
              value={s.periodEnd}
              onChange={(e) => $.periodEnd(e.target.value)}
            />
          </Field>
          {s.errors.periodEnd && <FieldError>{s.errors.periodEnd}</FieldError>}
        </div>
      )}

      {s.goalType === 'recurring' && (
        <Field>
          <FieldLabel>Resets</FieldLabel>
          <Select value={s.recurrenceFrequency} onValueChange={$.recurrenceFrequency}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Every week</SelectItem>
              <SelectItem value="monthly">Every month</SelectItem>
              <SelectItem value="quarterly">Every quarter</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {s.goalType === 'rolling' && (
        <Field>
          <FieldLabel htmlFor="rolling-days">Rolling window</FieldLabel>
          <div className="relative">
            <Input
              id="rolling-days"
              type="number"
              min={1}
              value={s.rollingWindowDays}
              onChange={(e) => $.rollingWindowDays(e.target.value)}
              className="pr-16"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              days
            </span>
          </div>
          {s.errors.rollingWindowDays && (
            <FieldError>{s.errors.rollingWindowDays}</FieldError>
          )}
        </Field>
      )}
    </SectionCard>
  )
}

export function DetailsSection({
  state: s,
  setters: $,
}: Readonly<{ state: FormState; setters: Setters }>) {
  return (
    <SectionCard title="Details" description="Name your goal so the team recognizes it.">
      <Field>
        <FieldLabel htmlFor="goal-name">Name</FieldLabel>
        <Input
          id="goal-name"
          value={s.name}
          onChange={(e) => $.name(e.target.value)}
          placeholder="e.g. 50 scans this month"
          aria-invalid={!!s.errors.name}
        />
        {s.errors.name && <FieldError>{s.errors.name}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
        <Textarea
          id="description"
          value={s.description}
          onChange={(e) => $.description(e.target.value)}
          placeholder="Add context for the team…"
          rows={3}
        />
      </Field>
    </SectionCard>
  )
}
